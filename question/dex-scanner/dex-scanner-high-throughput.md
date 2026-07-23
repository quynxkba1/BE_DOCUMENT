# DEX Scanner — High-Throughput Indexing with Low-Latency Reads

---

## Problem

A DEX (Decentralized Exchange) scanner listens to blockchain smart contract events in real time and allows traders to query prices, charts, and trade history with sub-100ms latency.

The core tension:

- **Write side**: millions of on-chain events per day — must ingest fast and without data loss
- **Read side**: traders need price tickers in < 1ms, OHLCV charts in < 20ms, trade history in < 50ms

A single database with plain indexes cannot serve both sides well at scale. The solution is a **three-layer architecture** where each layer handles a specific latency tier.

---

## The Three-Layer Architecture

```
Blockchain node (WebSocket / RPC)
        │
        ▼
   Kafka topic                    ← decouples scanner from write pressure
        │                            multiple consumers from one stream
        │
        ├──► Consumer A: ClickHouse / TimescaleDB
        │         INSERT swap tick row
        │         Materialized view auto-rolls 1m/5m/1h OHLCV
        │
        ├──► Consumer B: Redis
        │         SET pool:{address}:price {value}    ← hot path, sub-1ms
        │
        └──► Consumer C: checkpoint writer
                  SET scanner:{chainId}:lastBlock {n} ← resume after crash

API layer:
  latest price   → Redis        < 1ms   (never hits DB)
  OHLCV chart    → ClickHouse   5–20ms  (pre-aggregated materialized view)
  trade history  → ClickHouse   10–50ms (tick table, indexed on pair + time)
```

---

## Layer 1 — Redis: the hot path (< 1ms)

Every time a swap event arrives, the scanner writes the latest price to Redis.
The price ticker API reads Redis directly — the database is never touched for this query.

```
SET pool:0xUSDC_ETH:price  1845.23
SET pool:0xUSDC_ETH:time   1749600000

GET pool:0xUSDC_ETH:price  → 1845.23   (sub-millisecond)
```

A watchdog republishes the key if the scanner lags more than N seconds (TTL fallback).

---

## Layer 2 — ClickHouse: warm reads (5–50ms)

ClickHouse is a columnar database built for high-throughput inserts and fast analytical queries. It is the industry choice for DEX-scale data (Nansen, Birdeye, GeckoTerminal all use it).

### Why ClickHouse beats PostgreSQL at this scale

| | PostgreSQL | ClickHouse |
|---|---|---|
| Insert throughput | ~50K rows/sec | ~1M+ rows/sec |
| OHLCV aggregation | Manual materialized view + cron | Auto `MATERIALIZED VIEW` on every insert |
| Query on 100M rows | Seconds | Milliseconds (columnar scan) |
| Compression | Manual (TimescaleDB extension) | Built-in columnar compression |

### Table design

```sql
CREATE TABLE swap_events (
  tx_hash         String,
  block_number    UInt64,
  block_timestamp DateTime,
  pair_address    String,
  token_in        String,
  token_out       String,
  amount_in       UInt256,
  amount_out      UInt256,
  price           Float64,
  wallet          String,
  log_index       UInt32
)
ENGINE = ReplacingMergeTree()            -- dedup on (tx_hash, log_index)
PARTITION BY toYYYYMM(block_timestamp)  -- one partition per month
ORDER BY (pair_address, block_timestamp); -- sort key = index in ClickHouse
```

`ORDER BY (pair_address, block_timestamp)` is equivalent to a composite B-tree index.
Queries filtering on `pair_address` then ranging on `block_timestamp` are served from the sort key directly — no separate index definition needed.

### Auto-rolling OHLCV candles via Materialized View

```sql
CREATE MATERIALIZED VIEW ohlcv_1m
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(minute)
ORDER BY (pair_address, minute)
AS
SELECT
  pair_address,
  toStartOfMinute(block_timestamp)    AS minute,
  argMinState(price, block_timestamp) AS open,
  maxState(price)                     AS high,
  minState(price)                     AS low,
  argMaxState(price, block_timestamp) AS close,
  sumState(amount_in)                 AS volume
FROM swap_events
GROUP BY pair_address, minute;
```

The chart API reads `ohlcv_1m` directly — no aggregation at query time.

---

## Layer 3 — PostgreSQL: relational metadata

ClickHouse does not handle relational data well (no joins, no foreign keys).
PostgreSQL stores the relational side: token metadata, pool info, user records.

```sql
CREATE TABLE tokens (
  address  VARCHAR(42) PRIMARY KEY,
  symbol   VARCHAR(20),
  decimals INT
);

CREATE TABLE pools (
  address  VARCHAR(42) PRIMARY KEY,
  token0   VARCHAR(42) REFERENCES tokens(address),
  token1   VARCHAR(42) REFERENCES tokens(address),
  fee_tier INT
);
```

The API joins pool metadata from PostgreSQL with price data from ClickHouse (or Redis) in the application layer.

---

## Scanner Design: Deduplication and Crash Recovery

### Deduplication

Prevents re-inserting the same event if the scanner replays blocks after a crash.

```sql
-- PostgreSQL
CREATE UNIQUE INDEX idx_swap_dedup ON swap_events (tx_hash, log_index);

INSERT INTO swap_events (...) VALUES (...)
ON CONFLICT (tx_hash, log_index) DO NOTHING;
```

In ClickHouse, `ReplacingMergeTree` engine deduplicates rows with the same primary key during background merges.

### Checkpoint / resume

```
Redis key:  scanner:1:lastBlock = 22500000

On startup:           read lastBlock, resume from lastBlock + 1
On each batch commit: SET scanner:1:lastBlock {n}
```

### Reorg handling (chain reorganizations)

Blocks can be replaced up to N confirmations deep on-chain.

- Only mark events as finalized after 12 confirmations (Ethereum mainnet)
- Store a `finalized` flag; API filters `WHERE finalized = true`
- On reorg: soft-delete rows with `block_number > reorg_start`, re-index

---

## How The Graph Solves the Same Problem (Open Source Reference)

The Graph is the most studied open-source blockchain indexer. Key patterns:

- **PostgreSQL** as the primary store — no Kafka, no ClickHouse, simpler pipeline
- **BRIN index** on `block_number` — tiny index, very efficient for sequential time-series data
- **Block-range versioning**: every row has `(lower_block, upper_block)` columns — on reorg, rows are reverted, not deleted
- **Resume**: block pointer stored in PostgreSQL, replays from it on startup
- Works well up to ~100M rows per entity — beyond that, teams migrate to ClickHouse

---

## When to Use Which Stack

| Scale | Architecture |
|---|---|
| < 10M rows | PostgreSQL + B-tree indexes on `(pair_address, block_timestamp)` |
| 10M–100M rows | PostgreSQL + TimescaleDB hypertable + continuous aggregates for OHLCV |
| 100M+ rows | ClickHouse (ticks + MV for OHLCV) + PostgreSQL (metadata) + Redis (hot path) + Kafka (ingest buffer) |

The indexing patterns are the same at every scale — `pair + timestamp` composite, `wallet + timestamp`, dedup unique. Only the engine changes.

---

## Follow-up Q&A

**Q: Why Kafka between scanner and database?**

Kafka decouples ingestion speed from write-back pressure. The scanner publishes events at chain speed; consumers write to ClickHouse, Redis, and checkpoint store independently. If ClickHouse is slow or restarting, events buffer in Kafka — nothing is lost. Without Kafka, a slow DB write causes the scanner to fall behind the chain.

**Q: What is a BRIN index and when does it outperform B-tree?**

BRIN (Block Range Index) stores the min/max value of a column per physical disk page range, not per row. For sequential data like `block_number` (values always increase), BRIN is tiny (a few KB vs hundreds of MB for B-tree) and nearly as fast for range scans. Drawback: useless for random data — only works when physical row order correlates with column value order.

**Q: How do you handle the open (current) candle in the OHLCV chart?**

Pre-aggregated materialized views only cover completed time buckets. The current open bucket must be computed on-read from the raw tick table for the last N seconds, then merged with the materialized history in the application layer. This is a small range scan so it is fast even without pre-aggregation.

**Q: Why not just use PostgreSQL with good indexes for everything?**

PostgreSQL works well up to ~50–100M rows. Beyond that, row-based storage is fundamentally slower than columnar storage for aggregation queries. Reading 100M rows to compute OHLCV requires touching every row in a heap-based database. ClickHouse stores each column separately and reads only the `price` column to compute `MAX(price)` — 10–100x less I/O.

---

## When to Use PostgreSQL vs ClickHouse

### The Mental Model

```
PostgreSQL → "what IS the state right now?"
ClickHouse → "what HAPPENED over time?"
```

### Decision Table

| Use Case | Database | Why |
|---|---|---|
| User accounts | PostgreSQL | Identity, needs UPDATE |
| Wallet current balance | PostgreSQL | Point-in-time state, must be accurate |
| Pool metadata (address, token0, token1) | PostgreSQL | Master record, looked up by ID |
| Pool TVL right now | PostgreSQL | Single value, updated on each swap |
| Swap event history | ClickHouse | Append-only, aggregate over billions of rows |
| Price history over time | ClickHouse | Time-series, queried as chart data |
| Volume aggregations (24h, 7d, 30d) | ClickHouse | SUM/COUNT over millions of rows |
| Wallet balance change history | ClickHouse | Audit trail, time-series |
| Pool TVL history | ClickHouse | Chart data, aggregate by time bucket |

### The Same Entity Can Split Across Both

A **pool** is a good example — part of its data belongs in each database:

```
PostgreSQL: pools table
  address    VARCHAR(42) PRIMARY KEY   ← pool exists, master record
  token0     VARCHAR(42)               ← relational join to tokens table
  token1     VARCHAR(42)
  created_at TIMESTAMP

ClickHouse: swap_events table
  pool_address  String                 ← which pool this swap happened on
  price         Float64                ← price at time of swap
  timestamp     DateTime               ← when it happened
  amount_in     UInt256

API layer joins them:
  pool info    ← PostgreSQL (fast single-row lookup)
  24h volume   ← ClickHouse (fast aggregate over millions of rows)
```

A **wallet** follows the same pattern:

```
PostgreSQL → current balance (what the wallet holds right now)
ClickHouse → balance history (how the wallet balance changed over 30 days)
```

### Quick Rules

- Needs `UPDATE` or `DELETE` → PostgreSQL
- Needs foreign keys or joins → PostgreSQL
- Needs transactions → PostgreSQL
- Query is `SUM / AVG / COUNT / MAX / MIN` over time → ClickHouse
- Data is append-only (events, logs, ticks) → ClickHouse
- Data grows unboundedly (millions of rows per day) → ClickHouse
- Single row lookup by ID → PostgreSQL
