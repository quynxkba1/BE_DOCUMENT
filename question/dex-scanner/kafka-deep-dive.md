# Kafka — Deep Dive for Backend Interviews

---

## 1. What is Kafka and Why Does It Exist?

Before Kafka, services talked to each other directly:

```
Scanner → writes directly → ClickHouse
Scanner → writes directly → Redis
Scanner → writes directly → PostgreSQL
```

**Problem:** If ClickHouse is slow or crashed, the scanner has to stop and wait. If you add a new service (e.g. alert system), you must modify the scanner code. Every service is tightly coupled.

**Kafka solves this** by putting a buffer in the middle:

```
Scanner → Kafka → ClickHouse consumer
                → Redis consumer
                → Alert consumer     ← add new consumer without touching scanner
```

The scanner writes once to Kafka and moves on. Each downstream service reads at its own pace. Nobody blocks anybody.

**One-line definition:** Kafka is a distributed, ordered, durable message log that decouples producers from consumers.

---

## 2. Core Concepts

### Topic

A **topic** is a named channel for a category of events. Like a YouTube channel — producers publish to it, consumers subscribe to it.

```
Topic: swap_events     ← all swap events go here
Topic: price_updates   ← computed prices go here
Topic: alerts          ← alert events go here
```

### Message / Event

A **message** is one unit of data published to a topic. In a DEX scanner:

```json
{
  "pair_address": "0xUSDC_ETH",
  "price": 1845.23,
  "amount_in": "500000000",
  "tx_hash": "0xabc123",
  "block_number": 22500000,
  "timestamp": 1749600000
}
```

Every message has:
- **Key** — used to determine which partition it goes to (e.g. `pair_address`)
- **Value** — the payload (JSON, Avro, Protobuf, etc.)
- **Timestamp** — when it was produced
- **Offset** — its position in the partition (auto-assigned, always increases)

### Partition

A **partition** is an ordered, immutable log of messages. A topic is split into N partitions for parallelism.

```
Topic: swap_events (3 partitions)

Partition 0: [msg0] [msg1] [msg2] [msg3] ...
Partition 1: [msg0] [msg1] [msg2] ...
Partition 2: [msg0] [msg1] ...
              ↑
           offset (position in this partition)
```

**Key rule:** Messages with the same key always go to the same partition. This guarantees ordering per key.

In DEX scanner:
```
Partition key = pair_address

USDC/ETH events → always Partition 0
SOL/USDC events → always Partition 1
BTC/ETH  events → always Partition 2
```

This means all price updates for `USDC/ETH` arrive in order — no race conditions when updating the latest price.

**How many partitions?** = number of consumers you want running in parallel. 6 partitions = up to 6 consumers processing simultaneously.

### Offset

An **offset** is the position of a message within a partition. It always increases, never resets.

```
Partition 0:
  offset 0 → {price: 1840}
  offset 1 → {price: 1843}
  offset 2 → {price: 1845}   ← consumer is here (committed offset = 2)
  offset 3 → {price: 1847}   ← next to read
```

Consumers track their offset independently. If a consumer crashes and restarts, it resumes from the last committed offset — no data loss, no duplicates (if handled correctly).

### Broker

A **broker** is one Kafka server (one machine/process). It stores partitions and serves producers/consumers.

```
Broker 1: stores Partition 0 and Partition 2
Broker 2: stores Partition 1 and Partition 0 replica
Broker 3: stores Partition 2 replica and Partition 1 replica
```

A **Kafka cluster** = multiple brokers. Typically 3+ in production.

### Replication

Each partition has one **leader** and N-1 **replicas** (followers).

- All reads and writes go to the **leader**
- Replicas silently copy from the leader
- If the leader broker crashes, Kafka elects a replica as the new leader automatically

```
Partition 0:
  Leader   → Broker 1  ← producers write here, consumers read here
  Replica  → Broker 2  ← copies from leader silently
  Replica  → Broker 3  ← copies from leader silently

Broker 1 crashes?
  → Kafka controller promotes Broker 2 as new leader in ~3 seconds
  → Zero data loss (messages were already replicated)
```

**Replication factor = 3** is the production standard. Tolerates 2 broker failures before data loss.

### Producer

The **producer** publishes messages to a topic.

```
Producer (scanner) → sends message with key=pair_address → Kafka topic
```

Producer settings that matter:
- `acks=all` — wait for all replicas to confirm before acknowledging. Slowest but zero data loss.
- `acks=1` — only leader confirms. Fast but if leader crashes after ack, message lost.
- `acks=0` — fire and forget. Fastest, but data loss is possible. Never use in production.

### Consumer

The **consumer** reads messages from a topic.

```
Consumer (ClickHouse writer) → reads from swap_events topic → inserts into ClickHouse
```

Consumers track their position with **offsets** and **commit** them to Kafka after processing:

```
1. Read message at offset 5
2. Insert into ClickHouse
3. Commit offset 5 to Kafka  ← "I've processed everything up to offset 5"
4. Read message at offset 6
```

If consumer crashes between step 1 and step 3, it re-reads offset 5 on restart — **at-least-once delivery**. You may process the same message twice, so your storage layer must handle deduplication (hence `ReplacingMergeTree` in ClickHouse).

### Consumer Group

A **consumer group** is a set of consumers that together read a topic, each handling different partitions.

```
Topic: swap_events (6 partitions)
Consumer Group: clickhouse-writers (3 consumers)

Consumer 1 → reads Partition 0 + Partition 1
Consumer 2 → reads Partition 2 + Partition 3
Consumer 3 → reads Partition 4 + Partition 5
```

**Rules:**
- One partition is assigned to at most one consumer in a group at a time
- If a consumer crashes, Kafka rebalances — its partitions are reassigned to surviving consumers
- If you add a consumer, Kafka rebalances again — new consumer takes some partitions

**Maximum parallelism = number of partitions.** If you have 6 partitions and 8 consumers in a group, 2 consumers sit idle.

Different consumer groups are fully independent — they each maintain their own offsets:

```
Topic: swap_events
  Consumer group: clickhouse-writers → at offset 1000
  Consumer group: redis-writers      → at offset 1005 (processes faster)
  Consumer group: alert-system       → at offset 800  (processes slower)
```

Each group reads the full topic independently. One slow group never blocks another.

---

## 3. Full Flow in DEX Scanner

### The Real Problem: Pools Are Not Fixed

The original simple diagram assumes a fixed set of pairs (USDC/ETH, SOL/USDC, BTC/ETH). This is wrong.

In a real DEX scanner:
- **New tokens** are created constantly via bonding curve contracts (e.g. pump.fun on Solana)
- **New DEX pools** are created when someone adds liquidity for a token pair
- The scanner cannot hardcode which contracts to listen to — it must discover them dynamically

This introduces **two different event types** from **two different contract sources**:

```
Bonding Curve Contract           DEX Pool Contract (Uniswap/Raydium)
  │                                │
  │ emits TokenCreated event       │ emits Swap event
  │ (new token launched)           │ (trade happened)
  ▼                                ▼
  Scanner listens here             Scanner listens here
```

### Two Kafka Topics (Not One)

Because event types are different and consumed differently, they go to separate topics:

```
Topic: token_created   ← new token/pool was created (low volume, ~thousands/day)
Topic: swap_events     ← trade happened in a pool   (high volume, ~millions/day)
```

Mixing them in one topic would force the high-throughput swap consumer to parse low-volume
creation events, and vice versa. Separation keeps each consumer simple and independently scalable.

### The Dynamic Pool Discovery Problem

The scanner starts with zero known pools. How does it know what to listen to?

```
Step 1: Scanner always listens to FACTORY contracts
        (Uniswap Factory, pump.fun program — these addresses never change)

Step 2: Factory emits TokenCreated / PairCreated event
        → Scanner publishes to topic: token_created
        → Pool Registry Consumer reads it → saves new pool address to PostgreSQL

Step 3: Scanner reads the pool registry on startup (and polls periodically)
        → Builds a live subscription list of all known pool addresses
        → Now listens for Swap events from these addresses

Step 4: New pool created at runtime?
        → Detected via factory event → added to registry
        → Scanner hot-reloads subscription list without restart
```

### Full Flow With Dynamic Pools

```
Factory contracts (fixed addresses, always watched)
  │
  │ emits PairCreated / TokenCreated
  ▼
Scanner (producer)
  │ publishes to topic: token_created
  │ key = factory_address
  │ value = { pool_address, token0, token1, curve_type, chain_id, timestamp }
  ▼
Kafka: topic = token_created (3 partitions, low volume)
  │
  └── Consumer Group: pool-registry-writers
        → INSERT INTO pools (address, token0, token1, ...) in PostgreSQL
        → SET registry:{chain}:pools:updated = timestamp  (signals scanner to reload)


Pool contracts (dynamic, grows over time — currently N pools, tomorrow N+1000)
  │
  │ emits Swap / Buy / Sell
  ▼
Scanner (producer) — subscription list hot-reloaded from pool registry
  │ publishes to topic: swap_events
  │ key = pool_address          ← partition key: same pool always → same partition
  │ value = {
  │   pool_address, price, amount_in, amount_out,
  │   tx_hash, block_number, timestamp,
  │   source: "bonding_curve" | "dex_pool"   ← normalized, consumers don't care about source
  │ }
  ▼
Kafka cluster (3 brokers, replication = 3)
  Topic: swap_events (12 partitions)

  Partition 0  ← pool 0xAAA events (hash("0xAAA") % 12 = 0)
  Partition 1  ← pool 0xBBB events (hash("0xBBB") % 12 = 1)
  ...
  Partition 11 ← pool 0xZZZ events

  New pool 0xNEW created? → hash("0xNEW") % 12 = 7
  → automatically lands in Partition 7
  → no Kafka config changes needed, no partition added
  │
  ├── Consumer Group A: redis-writers
  │     Consumer reads partition → SET pair:{pool_address}:price {value}
  │     Works for any pool, old or new — no code change needed
  │
  ├── Consumer Group B: clickhouse-writers
  │     Consumer reads partition → INSERT INTO swap_events
  │     Works for any pool, old or new — no code change needed
  │
  └── Consumer Group C: checkpoint-writers
        SET scanner:{chain}:lastBlock {n}
```

### Why Partition Key = `pool_address` Still Works For Dynamic Pools

This is the elegant part. When a new pool is created:

```
New pool address: 0xNEW_POOL_XYZ

hash("0xNEW_POOL_XYZ") % 12 = Partition 4   ← Kafka computes this automatically

All future swap events from this pool → always land in Partition 4
Consumer assigned to Partition 4 → processes them in order
```

No partition changes. No consumer reassignment. No config updates.
The system absorbs new pools automatically because the hash function distributes
any new address into the existing partition space.

### Normalization: Bonding Curve vs DEX Swap

Bonding curve and DEX pool emit different raw event formats. The scanner normalizes
them into one unified schema before publishing to Kafka:

```
Bonding Curve raw event:          DEX Pool raw event:
  type: "Buy"                       type: "Swap"
  tokenAmount: 1000000              amount0In: 500000000
  solAmount: 5000000000             amount1Out: 1845230000
  trader: "0x..."                   sender: "0x..."

              ↓ scanner normalizes both ↓

Unified swap_events message:
  {
    pool_address:  "0x...",
    price:         1845.23,          ← computed by scanner from raw amounts
    amount_in:     "500000000",
    amount_out:    "1845230000",
    direction:     "buy" | "sell",
    wallet:        "0x...",
    tx_hash:       "0xabc",
    block_number:  22500000,
    timestamp:     1749600000,
    source:        "bonding_curve",  ← metadata only, consumers ignore for price logic
    chain_id:      1
  }
```

Consumers (Redis writer, ClickHouse writer) work with the unified format.
They never need to know whether a swap came from a bonding curve or a DEX pool.

---

## 4. Retention — Kafka Is Not a Queue

A traditional message queue **deletes** a message after it's consumed. Kafka keeps messages for a configured retention period (default: 7 days), regardless of whether anyone has consumed them.

This means:
- You can add a new consumer group and it can read from the beginning of the topic
- If a consumer has a bug, fix it and replay all events from the start
- Event sourcing: Kafka IS the source of truth

```
Delete after consume:    Producer → [msg] → Consumer → [msg gone]

Kafka retention:         Producer → [msg0][msg1][msg2][msg3]...
                                         ↑           ↑
                                  clickhouse     redis
                                  (at offset 1)  (at offset 3)
                                  (behind)       (ahead)
```

---

## 5. When to Use Kafka

| Use Kafka when | Don't use Kafka when |
|----------------|---------------------|
| Multiple consumers from one stream | One producer, one consumer |
| Consumer speeds differ | All consumers process at same rate |
| Data loss is unacceptable | Simple task queue (use RabbitMQ/SQS) |
| You need event replay | You need request/reply (use gRPC/REST) |
| Throughput > 100K msg/sec | Low throughput (< 10K msg/sec) |
| Decoupling producers from consumers | Direct service-to-service calls are fine |

---

## 6. Kafka vs RabbitMQ (Common Interview Comparison)

| | Kafka | RabbitMQ |
|---|---|---|
| Model | Log (messages persist after consume) | Queue (messages deleted after consume) |
| Throughput | Millions/sec | Hundreds of thousands/sec |
| Ordering | Per partition | Per queue |
| Replay | Yes (rewind offset) | No |
| Consumer model | Pull (consumers poll) | Push (broker pushes) |
| Best for | Event streaming, audit log, data pipeline | Task queues, job scheduling, RPC |
| DEX scanner | ✅ Correct choice | ❌ Wrong — no replay, lower throughput |

---

## 7. Interview Q&A

**Q: Why does DEX scanner use Kafka instead of writing directly to ClickHouse?**

Kafka decouples the scanner's write speed from ClickHouse's insert speed. If ClickHouse is slow or restarting, events buffer in Kafka — the scanner keeps running at chain speed without falling behind. Without Kafka, a slow DB write blocks the scanner. Also, multiple consumers (Redis, ClickHouse, checkpoint) can read the same event stream independently without the scanner needing to know about each one.

**Q: What happens if a Kafka broker crashes?**

Kafka elects a new leader for the partitions that were on the crashed broker from among the replicas. With replication factor=3, Kafka tolerates 2 broker failures. In-flight messages are not lost because they were already replicated before the producer received an `ack` (assuming `acks=all`). Consumers seamlessly reconnect to the new leader.

**Q: What is a consumer group and why does it matter?**

A consumer group allows horizontal scaling of consumers. Each partition is assigned to exactly one consumer in a group, so messages are processed in parallel without duplication. Different consumer groups are fully independent — the Redis writer and the ClickHouse writer can read the same topic at their own pace without interfering with each other.

**Q: What does "at-least-once delivery" mean and how do you handle it?**

If a consumer reads a message, processes it, but crashes before committing the offset, it will re-read and re-process that message on restart. This means the same message can be processed more than once. To handle this, the storage layer must be idempotent: ClickHouse uses `ReplacingMergeTree` to deduplicate rows with the same primary key, and PostgreSQL uses `ON CONFLICT DO NOTHING`.

**Q: How do you choose partition count?**

Partition count = maximum consumer parallelism you'll ever need. More partitions = more parallelism, but also more overhead (file handles, rebalance time). A common rule: start with `expected_peak_throughput / single_consumer_throughput`, then round up to a power of 2. For DEX scanner with 1M events/day and a consumer handling 100K events/day, 10–12 partitions is reasonable.

**Q: What is the difference between `acks=1` and `acks=all`?**

`acks=1` means the producer considers the message sent once the partition leader writes it. If the leader crashes before replicating, the message is lost. `acks=all` means the producer waits until all in-sync replicas have written the message — true durability guarantee. `acks=all` has slightly higher latency (one extra network round trip) but zero data loss. For financial data like swap events, always use `acks=all`.

**Q: How does Kafka guarantee ordering?**

Kafka guarantees ordering **within a partition**. Messages in the same partition are always read in the order they were written. Messages across different partitions have no ordering guarantee. This is why the partition key matters: all events for the same `pair_address` go to the same partition, so the price history for a pair is always in chronological order.

---

## 8. Key Numbers to Remember

| Metric | Value |
|--------|-------|
| Throughput | Millions of messages/sec per cluster |
| Latency | 2–5ms end-to-end (producer → consumer) |
| Retention default | 7 days |
| Replication factor (production) | 3 |
| Min brokers (production) | 3 |
| Max message size (default) | 1MB |
| Partition count (rule of thumb) | Start with 3–12, scale up as needed |

---

## 9. Terms Cheat Sheet

| Term | One-line definition |
|------|-------------------|
| Topic | Named channel for a category of events |
| Partition | Ordered sub-log within a topic; unit of parallelism |
| Offset | Position of a message within a partition; always increases |
| Broker | One Kafka server; stores partitions |
| Cluster | Multiple brokers working together |
| Leader | The broker handling reads/writes for a partition |
| Replica | Backup copy of a partition on another broker |
| Producer | Service that writes messages to a topic |
| Consumer | Service that reads messages from a topic |
| Consumer group | Set of consumers sharing work on a topic |
| Rebalance | Reassigning partitions when consumers join/leave |
| Commit | Consumer saving its current offset position |
| At-least-once | Message processed ≥1 time; duplicates possible |
| Exactly-once | Message processed exactly 1 time; requires transactions |
| Retention | How long Kafka keeps messages before deleting |

---

## 10. Kafka Setup Guide

### Dev — Single Broker with Docker (KRaft mode, no ZooKeeper)

KRaft is the modern Kafka mode. No ZooKeeper process needed.

**File:** `docker-compose.kafka.yml` (already in shared-example root)

```bash
# Start Kafka + optional UI
docker compose -f docker-compose.kafka.yml up -d

# Verify broker is up
docker exec kafka-dev kafka-topics.sh --list --bootstrap-server localhost:9092

# View Kafka UI in browser
open http://localhost:8080
```

**What the UI shows:**
- Topics and their partitions
- Messages inside each partition (with key, value, offset, timestamp)
- Consumer groups and their lag (how far behind each group is)

**Create topics manually (if needed):**
```bash
docker exec kafka-dev kafka-topics.sh \
  --create \
  --topic swap_events \
  --partitions 12 \
  --replication-factor 1 \
  --bootstrap-server localhost:9092

docker exec kafka-dev kafka-topics.sh \
  --create \
  --topic token_created \
  --partitions 3 \
  --replication-factor 1 \
  --bootstrap-server localhost:9092
```

**Watch messages in real time:**
```bash
# Watch swap_events as they arrive
docker exec kafka-dev kafka-console-consumer.sh \
  --topic swap_events \
  --bootstrap-server localhost:9092 \
  --from-beginning

# Watch a specific partition only
docker exec kafka-dev kafka-console-consumer.sh \
  --topic swap_events \
  --partition 0 \
  --bootstrap-server localhost:9092
```

**Check consumer group lag:**
```bash
docker exec kafka-dev kafka-consumer-groups.sh \
  --describe \
  --group redis-writers \
  --bootstrap-server localhost:9092
# Shows: partition, current-offset, log-end-offset, lag
```

**Environment variable for the app:**
```bash
# .env
KAFKA_BROKERS=localhost:9092
```

---

### Run the DEX Scanner Example

```bash
cd shared-example

# 1. Start Kafka
docker compose -f docker-compose.kafka.yml up -d

# 2. Start the NestJS app
pnpm start:dev

# 3. Start the mock scanner (emits swap events every 500ms)
curl -X POST http://localhost:3000/dex-scanner/start

# 4. Watch latest prices being written to mock Redis
curl http://localhost:3000/dex-scanner/redis-state

# 5. Watch ClickHouse insert count grow
curl http://localhost:3000/dex-scanner/clickhouse-stats

# 6. Watch new pools being discovered (every 10s a new pool spawns)
curl http://localhost:3000/dex-scanner/pool-registry

# 7. Stop scanner
curl -X POST http://localhost:3000/dex-scanner/stop
```

**What you will see in logs:**
```
[MockScannerService] Mock scanner started — emitting swap events every 500ms
[MockScannerService] [SCANNER] Emitted swap: pool=0xAAA111 price=1847.23 dir=buy
[RedisWriterConsumer] [redis-writers] partition=0 SET pair:0xAAA111:price = 1847.23 (source: dex_pool)
[ClickhouseWriterConsumer] [clickhouse-writers] buffered tx=0xTX_... (batch size: 3)
[ClickhouseWriterConsumer] [clickhouse-writers] MOCK INSERT INTO swap_events — 100 rows (total: 100)
[MockScannerService] [SCANNER] New pool discovered: 0xNEWPOOL_1749600000 (total known: 4)
[PoolRegistryConsumer] [pool-registry] partition=1 MOCK INSERT pools: 0xNEWPOOL_1749600000
```

---

### Production — 3-Broker Cluster

**Option A: Self-hosted on VMs / Kubernetes**

Minimum 3 VMs. Each runs one Kafka broker. All point to the same KRaft quorum.

Key `server.properties` settings per broker:

```properties
# Unique per broker
node.id=1

# All 3 brokers listed here
controller.quorum.voters=1@broker1:9093,2@broker2:9093,3@broker3:9093

# Data durability
default.replication.factor=3
min.insync.replicas=2          # producer acks=all requires 2 replicas to confirm (tolerates 1 down)
unclean.leader.election.enable=false   # never elect an out-of-sync replica (prevents data loss)

# Performance
num.partitions=12              # default partitions for new topics
log.retention.hours=168        # keep messages 7 days
log.segment.bytes=1073741824   # 1GB per segment file
log.retention.bytes=107374182400   # 100GB max per partition before deletion

# Network
num.network.threads=8
num.io.threads=16
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
```

**Option B: AWS MSK (Managed Streaming for Kafka)** — recommended

AWS manages broker provisioning, replication, upgrades, and monitoring. You pay per broker-hour.

```bash
# Create via AWS CLI
aws kafka create-cluster \
  --cluster-name dex-scanner-prod \
  --kafka-version 3.7.0 \
  --number-of-broker-nodes 3 \
  --broker-node-group-info '{
    "InstanceType": "kafka.m5.large",
    "ClientSubnets": ["subnet-aaa", "subnet-bbb", "subnet-ccc"],
    "StorageInfo": { "EbsStorageInfo": { "VolumeSize": 1000 } }
  }' \
  --encryption-info '{ "EncryptionInTransit": { "ClientBroker": "TLS" } }'
```

**Option C: Confluent Cloud** — fully managed, pay per message

No infra to manage. Scales automatically. Add to NestJS app:

```bash
KAFKA_BROKERS=pkc-xxxxx.us-east-1.aws.confluent.cloud:9092
KAFKA_SASL_USERNAME=your-api-key
KAFKA_SASL_PASSWORD=your-api-secret
```

```typescript
// kafka.service.ts — production config
this.kafka = new Kafka({
  clientId: 'dex-scanner',
  brokers: process.env.KAFKA_BROKERS!.split(','),
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: process.env.KAFKA_SASL_USERNAME!,
    password: process.env.KAFKA_SASL_PASSWORD!,
  },
});
```

---

### Production Checklist

| Setting | Dev | Production |
|---------|-----|-----------|
| Brokers | 1 | 3 minimum |
| Replication factor | 1 | 3 |
| `min.insync.replicas` | 1 | 2 |
| `acks` on producer | default (1) | `all` (-1) |
| `unclean.leader.election` | true | **false** |
| SSL/SASL | none | required |
| Auto-create topics | optional | **disabled** |
| Retention | 1 hour (dev) | 7 days |
| Monitoring | none | Kafka consumer lag alerts |

**Most important production rule:** Set `unclean.leader.election.enable=false`. Without it, Kafka may elect an out-of-sync replica as leader when the real leader crashes — and you lose all messages that replica hadn't received yet. For financial data like swap events, this is unacceptable.
