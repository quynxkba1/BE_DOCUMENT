# ClickHouse — Deep Dive for Backend Interviews

---

## 1. What is ClickHouse?

ClickHouse is an **open-source column-oriented database** built by Yandex (2016) for real-time analytical queries over billions of rows.

Normal databases (PostgreSQL, MySQL) store data **row by row**:
```
row 1: [tx_hash, pool, price, amount, timestamp]
row 2: [tx_hash, pool, price, amount, timestamp]
row 3: [tx_hash, pool, price, amount, timestamp]
```

ClickHouse stores data **column by column**:
```
tx_hash column:   [tx1, tx2, tx3, ...]
pool column:      [0xAAA, 0xBBB, 0xCCC, ...]
price column:     [1842.50, 1843.10, 1841.90, ...]
amount column:    [100, 200, 150, ...]
timestamp column: [1720082400, 1720082401, 1720082402, ...]
```

**One-line definition:** ClickHouse is a database that answers "aggregate 1 billion rows" queries in milliseconds, by reading only the columns you ask for.

---

## 2. How Does It Work?

### Column Storage

When you query `SELECT avg(price) FROM swap_events WHERE timestamp > now() - interval 1 hour`:

```
PostgreSQL reads:
  [tx_hash, pool, price, amount, timestamp]  ← entire row × N rows
  [tx_hash, pool, price, amount, timestamp]
  ...
  Then filters by timestamp, then computes avg(price)
  → reads 100% of data even though you need 2 columns

ClickHouse reads:
  [price column]     ← only this
  [timestamp column] ← and this
  → reads 2/5 = 40% of data, skips the rest entirely
```

### Compression

Columns contain the same type of data, so they compress extremely well:

```
price column: [1842.50, 1842.51, 1842.49, 1843.00, ...]
→ values are similar → LZ4/ZSTD compresses 10:1 ratio
→ less disk I/O → faster queries
```

PostgreSQL stores mixed types per row → poor compression.

### MergeTree Engine

The primary table engine in ClickHouse. Data is:

1. Written in **parts** (batches of sorted rows) — never one row at a time
2. Parts are **merged** in the background into larger parts
3. Each part has a **sparse index** — min/max values per column per block

```
Write 1000 rows → part_1/
Write 1000 rows → part_2/    ← background merge combines them
Write 1000 rows → part_3/ ──→  part_1_3/ (merged, sorted)
```

This is why ClickHouse hates single-row inserts — merging tiny parts constantly is expensive.

### Vectorized Query Execution

ClickHouse processes data in **chunks of 65,536 rows at a time** using SIMD CPU instructions — modern CPUs can compute on 256-512 values in a single instruction. PostgreSQL processes one row at a time.

```
PostgreSQL:  price[0] → process → price[1] → process → ...  (1 at a time)
ClickHouse:  [price[0..255]] → process 256 at once via AVX2 instructions
```

---

## 3. Pros and Cons

### Pros

| Advantage | Detail |
|---|---|
| **Blazing fast reads** | Aggregates over billions of rows in milliseconds |
| **High ingest throughput** | 500K–1M+ rows/sec per server |
| **Excellent compression** | 5–10x compression ratio → cheap storage |
| **SQL interface** | Standard SQL, easy to learn |
| **No indexes needed** | Column storage + sparse index handles most queries |
| **Open source** | Free self-hosted, pay only for cloud |
| **Horizontal scaling** | Sharding + replication built-in |

### Cons

| Disadvantage | Detail |
|---|---|
| **No row updates** | Updating a single row is expensive (rewrites entire part) |
| **No transactions** | No ACID — not suitable for financial ledgers |
| **Bad at single-row lookups** | `SELECT * WHERE id = 123` is slow vs PostgreSQL |
| **Joins are limited** | Large table joins are painful; denormalize instead |
| **Eventual consistency** | Replicas can lag briefly |
| **Single-row inserts kill performance** | Must batch inserts (100+ rows minimum) |
| **Steep ops learning curve** | MergeTree tuning, part management, replication setup |

---

## 4. ClickHouse vs Normal Database — Detailed Comparison

### 4.1 How They Read Data Physically

Given a table with 5 columns and 100M rows:

```
PostgreSQL (row store) — disk layout:
┌────────────────────────────────────────────────────┐
│ [tx_hash][pool][price][amount][timestamp]  ← row 1 │
│ [tx_hash][pool][price][amount][timestamp]  ← row 2 │
│ [tx_hash][pool][price][amount][timestamp]  ← row 3 │
│ ...                                                 │
└────────────────────────────────────────────────────┘

ClickHouse (column store) — disk layout:
┌──────────────────────┐ ┌──────────────────────┐
│ tx_hash column file  │ │ pool column file      │
│ [tx1][tx2][tx3]...  │ │ [0xA][0xB][0xC]...   │
└──────────────────────┘ └──────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐
│ price column file    │ │ timestamp column file │
│ [1842][1843][1841]..│ │ [172..][172..][172..]│
└──────────────────────┘ └──────────────────────┘
```

Query: `SELECT avg(price) FROM swap_events WHERE timestamp > X`

```
PostgreSQL:
  → reads ALL column files for every row (tx_hash, pool, price, amount, timestamp)
  → keeps only price and timestamp, discards the rest
  → I/O = 100% of table size

ClickHouse:
  → reads ONLY price and timestamp column files
  → I/O = 2/5 = 40% of table size
  → + skips blocks where timestamp max < X (sparse index)
  → I/O can drop to 5–10% of table
```

---

### 4.2 Real Query Performance — Concrete Numbers

Same query on 1 billion swap events:

| Query | PostgreSQL | ClickHouse | Why |
|---|---|---|---|
| `SELECT avg(price) FROM swap_events` | ~120s | ~0.8s | Column scan + vectorized |
| `SELECT count() WHERE pool = 'X'` | ~30s | ~0.1s | Sparse index skips other pools |
| `SELECT * WHERE tx_hash = '0xABC'` | ~0.005s | ~2s | PG has B-tree index; CH scans column |
| `SELECT sum(amount) GROUP BY pool` | ~180s | ~1.2s | Columnar GROUP BY |
| `INSERT 1 row` | ~0.001s | ~0.5s | CH creates a new part each time |
| `INSERT 10,000 rows` | ~0.5s | ~0.05s | CH amortizes part creation |
| `UPDATE price WHERE tx_hash = 'X'` | ~0.01s | ~30s | CH rewrites entire part |

---

### 4.3 Feature Comparison

| Feature | PostgreSQL | ClickHouse | Notes |
|---|---|---|---|
| **Storage model** | Row-oriented | Column-oriented | Fundamental difference |
| **ACID transactions** | Full | None | PG wins for financial ops |
| **INSERT single row** | Fast (~1ms) | Slow (~500ms) | CH hates small inserts |
| **INSERT batch 10K rows** | Slower | Fast (50ms) | CH loves big batches |
| **SELECT aggregate** | Slow on billions | Milliseconds | CH core strength |
| **SELECT by ID** | Fast (B-tree) | Slow (column scan) | PG wins for lookups |
| **UPDATE** | Native, fast | Rewrites entire part | Avoid in CH |
| **DELETE** | Native, fast | Async, expensive | Avoid in CH |
| **Joins** | Excellent | Painful at scale | Denormalize in CH |
| **Indexes** | B-tree, GiST, GIN | Sparse index only | CH auto-indexes via ORDER BY |
| **Compression** | ~2x (optional) | ~10x (built-in) | CH stores 5x less data |
| **Replication** | Streaming replica | Built-in | Both support HA |
| **Max rows before slow** | ~100M | 100B+ | CH scales much further |
| **Schema changes** | Online (most ops) | `ADD COLUMN` is instant; others are slow | CH is more limited |
| **Data types** | Rich (UUID, JSONB, arrays) | Rich (FixedString, LowCardinality, Nested) | Both have strong types |

---

### 4.4 Internal Index Comparison

**PostgreSQL B-tree index:**
```
B-tree on (pool_address, timestamp):

          [0xBBB, 1720100000]
         /                   \
[0xAAA, 1720000000]    [0xCCC, 1720200000]
      /    \                  /     \
  [leaf]  [leaf]          [leaf]  [leaf]
     ↓                       ↓
  row ptr                 row ptr   → jump directly to row on heap
```
- Stores a pointer to every individual row
- Fast for `WHERE pool = 'X' AND timestamp = Y` (point lookup)
- Huge index size on billions of rows (~50GB for 1B rows)

**ClickHouse sparse index:**
```
Sparse index on ORDER BY (pool_address, timestamp):

Block 0 (rows 0–8191):    min=0xAAA/1720000000  max=0xAAA/1720082000
Block 1 (rows 8192–16383): min=0xAAA/1720082001  max=0xBBB/1720100000
Block 2 (rows 16384–24575): min=0xBBB/1720100001  max=0xCCC/1720200000
```
- One index entry per 8,192 rows (not per row)
- Index is tiny (~1MB vs 50GB for 1B rows)
- Skips entire blocks that can't match — reads only relevant blocks
- Slower for point lookups, but fast for range scans on sorted data

---

### 4.5 When Each Wins

**PostgreSQL is better when:**
```
✓ You need to find/update a single row by ID
  SELECT * FROM pools WHERE address = '0xAAA'  ← B-tree index, instant

✓ You need transactions
  BEGIN;
    UPDATE wallet SET balance = balance - 100 WHERE id = 1;
    UPDATE wallet SET balance = balance + 100 WHERE id = 2;
  COMMIT;  ← atomically, or roll back entirely

✓ You need complex joins across normalized tables
  SELECT p.symbol, t.name FROM pools p JOIN tokens t ON p.token0 = t.address

✓ You need to update data frequently
  UPDATE swap_events SET finalized = true WHERE block_number < 22500000
```

**ClickHouse is better when:**
```
✓ You aggregate over millions of rows
  SELECT avg(price) FROM swap_events WHERE timestamp > now() - interval 24 hour
  → returns in 50ms on 500M rows

✓ You need time-series analytics
  SELECT toStartOfMinute(timestamp), avg(price)
  FROM swap_events GROUP BY 1 ORDER BY 1
  → OHLCV chart data in milliseconds

✓ You store append-only events that never change
  swap events, token transfers, block data → write once, never update

✓ You need cheap storage for massive data
  10x compression → 1TB of raw events = 100GB on disk
```

---

### 4.6 The Mental Model

```
Ask yourself: "What query do I run most often?"

Point lookup by ID?           → PostgreSQL
  SELECT * WHERE id = 123

Aggregate over time?          → ClickHouse
  SELECT sum(x) WHERE time > Y GROUP BY pool

Need to update this data?     → PostgreSQL
  UPDATE SET status = 'done' WHERE id = 123

Data is events that happened? → ClickHouse
  INSERT swap happened at block 22500000
  (you never update what happened in the past)
```

---

### 4.7 Summary Table

| | PostgreSQL | ClickHouse |
|---|---|---|
| **Storage model** | Row-oriented | Column-oriented |
| **Best for** | OLTP (write/read individual rows) | OLAP (aggregate millions of rows) |
| **INSERT speed** | Fast single rows | Needs batches (100+ rows) |
| **SELECT speed** | Slow on large aggregates | Milliseconds on billions of rows |
| **UPDATE/DELETE** | Native, fast | Expensive, avoid |
| **Transactions** | Full ACID | None |
| **Joins** | Excellent | Limited, prefer denormalized data |
| **Index** | B-tree per row | Sparse index per 8K rows |
| **Use case** | Users, orders, balances | Events, logs, metrics, time-series |
| **Compression** | ~2x | ~10x |
| **Max practical scale** | ~100M rows | 100B+ rows |

### When to use PostgreSQL:
- User accounts, wallet balances, pool metadata
- Anything that needs UPDATE or DELETE
- Anything that needs transactions
- Single-row lookups by ID

### When to use ClickHouse:
- Swap event history
- Price history over time
- Volume aggregations (24h, 7d, 30d)
- Any query starting with "give me the SUM/AVG/COUNT of events over time"

---

## 5. Best Practices

### 5.1 Schema Design

**Choose ORDER BY wisely — it is your primary index**

```sql
-- BAD: ORDER BY tx_hash alone
-- Query: WHERE pool_address = 'X' AND timestamp > Y
-- ClickHouse must scan ALL data — tx_hash order means pool data is scattered
ORDER BY (tx_hash)

-- GOOD: ORDER BY (pool_address, timestamp)
-- Query: WHERE pool_address = 'X' AND timestamp > Y
-- ClickHouse skips all blocks where pool_address != 'X', then ranges on timestamp
ORDER BY (pool_address, timestamp)
```

Rule: the leftmost column in ORDER BY should be what you filter on most. Second column should be time (for range scans).

**Use the smallest column types possible**

```sql
-- BAD: stores 8 bytes per row for a value that's always 0 or 1
direction VARCHAR(10)   -- 'buy' or 'sell'

-- GOOD: stores 1 byte per row
direction Enum8('buy' = 1, 'sell' = 2)

-- BAD: UInt256 for chain_id (chain_id is always < 100)
chain_id UInt256

-- GOOD: 1 byte
chain_id UInt8

-- BAD: String for pool_address (repeated 1B times)
pool_address String

-- GOOD: tells ClickHouse this is low-cardinality, uses dictionary encoding
pool_address LowCardinality(String)
```

`LowCardinality(String)` is the most impactful optimization for DEX scanners — pool addresses repeat billions of times, so dictionary encoding reduces storage by 10–100x and speeds up GROUP BY dramatically.

**Partition by time, not by entity**

```sql
-- BAD: partition by pool_address
-- Thousands of pools = thousands of partitions = too many small files
PARTITION BY pool_address

-- GOOD: partition by month
PARTITION BY toYYYYMM(timestamp)
-- → 12 partitions per year, each can be dropped cheaply
-- → ALTER TABLE DROP PARTITION '202406' deletes June data in milliseconds
```

**Denormalize instead of joining**

```sql
-- BAD: join at query time (slow in ClickHouse)
SELECT s.price, t.symbol
FROM swap_events s
JOIN tokens t ON s.token0 = t.address  ← painful at billion-row scale

-- GOOD: store token symbol directly in the swap row
CREATE TABLE swap_events (
  pool_address LowCardinality(String),
  token0_symbol LowCardinality(String),  ← duplicated, but fast
  token1_symbol LowCardinality(String),
  price Float64,
  ...
)
```

Disk space is cheap. Join performance at billion-row scale is not.

---

### 5.2 Insert Best Practices

**Always batch — never insert single rows**

```ts
// BAD: called on every message from Kafka (2000x/sec)
async onMessage(event) {
  await clickhouse.insert({ table: 'swap_events', values: [event] })
  // → creates 2000 parts/sec → ClickHouse falls behind on merges → crash
}

// GOOD: buffer and flush in batches
private batch: SwapEvent[] = []

async onMessage(event) {
  this.batch.push(event)
  if (this.batch.length >= 1000) await this.flush()
}

async flush() {
  const rows = this.batch.splice(0)  // drain atomically
  await clickhouse.insert({ table: 'swap_events', values: rows, format: 'JSONEachRow' })
  // → 1 insert per second instead of 2000 → healthy part count
}
```

Minimum: 100 rows per insert. Ideal: 1,000–10,000 rows per insert.

**Use async inserts for bursty traffic (ClickHouse 22.8+)**

```sql
-- Server-side batching: ClickHouse buffers small inserts and merges them automatically
SET async_insert = 1;
SET wait_for_async_insert = 0;  -- fire and forget
```

This lets you send single rows and ClickHouse handles batching internally — useful when you can't buffer in the application.

---

### 5.3 Query Best Practices

**Always filter on the leftmost ORDER BY column first**

```sql
-- ORDER BY (pool_address, timestamp)

-- GOOD: uses sparse index efficiently
SELECT avg(price) FROM swap_events
WHERE pool_address = '0xAAA'        -- leftmost column, massive data skip
  AND timestamp > now() - interval 1 hour

-- BAD: cannot use sparse index for pool_address
SELECT avg(price) FROM swap_events
WHERE timestamp > now() - interval 1 hour  -- ClickHouse must scan all pools
  AND pool_address = '0xAAA'
```

**Use Materialized Views for pre-aggregation**

```sql
-- Without MV: every chart request aggregates millions of rows at query time
SELECT toStartOfMinute(timestamp) as m, avg(price), sum(amount_in)
FROM swap_events
WHERE pool_address = '0xAAA' AND timestamp > now() - interval 24 hour
GROUP BY m
-- → 10–50ms at 100M rows, slower at 1B+ rows

-- With MV: aggregation happens at insert time, query reads pre-computed result
CREATE MATERIALIZED VIEW ohlcv_1m
ENGINE = AggregatingMergeTree()
ORDER BY (pool_address, minute)
AS SELECT
  pool_address,
  toStartOfMinute(timestamp) AS minute,
  avgState(price) AS price_avg,
  sumState(amount_in) AS volume
FROM swap_events
GROUP BY pool_address, minute;

-- Chart query now reads tiny pre-aggregated table instead of raw events
SELECT pool_address, minute, avgMerge(price_avg), sumMerge(volume)
FROM ohlcv_1m
WHERE pool_address = '0xAAA' AND minute > now() - interval 24 hour
GROUP BY pool_address, minute
-- → < 5ms regardless of how many raw rows exist
```

**Use `FINAL` only when you must**

```sql
-- ReplacingMergeTree deduplicates during background merges (async)
-- Duplicates may briefly appear between merges

-- Without FINAL (fast, may have duplicates):
SELECT count() FROM swap_events WHERE pool_address = '0xAAA'

-- With FINAL (slow, guaranteed no duplicates):
SELECT count() FROM swap_events FINAL WHERE pool_address = '0xAAA'
-- FINAL forces a merge at query time → 2–10x slower

-- Better approach: deduplicate at insert time using tx_hash check
-- and accept that FINAL is only needed for audit-critical queries
```

**Avoid SELECT \***

```sql
-- BAD: reads all column files from disk
SELECT * FROM swap_events WHERE pool_address = '0xAAA'

-- GOOD: reads only the 2 columns you need
SELECT price, timestamp FROM swap_events WHERE pool_address = '0xAAA'
```

In ClickHouse, `SELECT *` on a 20-column table reads 10x more data than needed.

---

### 5.4 Data Retention Best Practices

```sql
-- Drop old data cheaply by partition (milliseconds, not hours)
ALTER TABLE swap_events DROP PARTITION '202401';  -- deletes all of January 2024

-- Set TTL on the table to auto-expire data
ALTER TABLE swap_events MODIFY TTL timestamp + INTERVAL 6 MONTH;
-- → ClickHouse automatically drops rows older than 6 months during merges

-- Keep aggregated data forever, drop raw ticks after 90 days
-- Raw: PARTITION BY toYYYYMM(timestamp), TTL 90 days
-- OHLCV MV: no TTL — aggregated data is tiny, keep forever
```

---

## 6. Best Practices in the DEX Scanner Project

### 6.1 Table Schema for This Project

```sql
CREATE TABLE dex_scanner.swap_events (
  -- Use LowCardinality for repeated string columns — massive compression gain
  pool_address    LowCardinality(String),
  source          LowCardinality(String),  -- 'dex_pool' | 'bonding_curve'

  -- Use smallest numeric types
  chain_id        UInt8,          -- values 1, 56, 137 — fits in 1 byte
  block_number    UInt64,
  direction       Enum8('buy' = 1, 'sell' = 2),

  -- Keep full precision for prices and amounts
  price           Float64,
  amount_in       UInt256,
  amount_out      UInt256,

  -- Deduplication key
  tx_hash         String,

  wallet          String,
  timestamp       DateTime
)
ENGINE = ReplacingMergeTree()         -- dedup by tx_hash if Kafka re-delivers
PARTITION BY toYYYYMM(timestamp)      -- drop old months cheaply
ORDER BY (pool_address, timestamp)    -- optimize for "pool + time range" queries
TTL timestamp + INTERVAL 6 MONTH;    -- auto-expire raw ticks after 6 months
```

### 6.2 Kafka → ClickHouse Insert Pattern

Current code in `clickhouse-writer.consumer.ts` already follows best practices:

```ts
// Buffer in memory
this.batch.push(event)

// Flush when batch is large enough OR time has passed
if (this.batch.length >= 1000) await this.flushBatch()
setInterval(() => this.flushBatch(), 1000)

// Insert all at once
await clickhouse.insert({
  table: 'swap_events',
  values: toInsert,       // 1000 rows in one call
  format: 'JSONEachRow',
})
```

At 2000 TPS: batch fills in 0.5s → one insert every 0.5s → 2 inserts/sec (not 2000). ClickHouse handles this easily.

### 6.3 Materialized View for Price Charts

Add this after creating the `swap_events` table:

```sql
CREATE MATERIALIZED VIEW dex_scanner.ohlcv_1m
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(minute)
ORDER BY (pool_address, minute)
AS SELECT
  pool_address,
  toStartOfMinute(timestamp)    AS minute,
  argMinState(price, timestamp) AS open,
  maxState(price)               AS high,
  minState(price)               AS low,
  argMaxState(price, timestamp) AS close,
  sumState(toUInt64(amount_in)) AS volume,
  countState()                  AS trades
FROM dex_scanner.swap_events
GROUP BY pool_address, minute;
```

Every batch insert into `swap_events` automatically updates `ohlcv_1m`. The chart API reads the MV directly — no aggregation at query time.

```ts
// Chart API query — returns in < 5ms even at 5B raw rows
const rows = await clickhouse.query({
  query: `
    SELECT
      minute,
      argMinMerge(open)  as open,
      maxMerge(high)     as high,
      minMerge(low)      as low,
      argMaxMerge(close) as close,
      sumMerge(volume)   as volume
    FROM dex_scanner.ohlcv_1m
    WHERE pool_address = {pool: String}
      AND minute >= now() - INTERVAL 24 HOUR
    GROUP BY minute
    ORDER BY minute
  `,
  query_params: { pool: '0xAAA111' },
  format: 'JSONEachRow',
})
```

### 6.4 What Each Service Queries

```
RedisWriterConsumer writes:
  → pair:0xAAA:price = 1842.50       (latest price, sub-1ms reads)
  → never queries ClickHouse

ClickhouseWriterConsumer writes:
  → swap_events table (raw ticks)
  → ohlcv_1m MV auto-updates on insert

API routes:
  GET /price/:pool          → Redis (< 1ms)
  GET /chart/:pool?period=1h → ClickHouse ohlcv_1m (< 5ms)
  GET /trades/:pool         → ClickHouse swap_events (< 50ms)
  GET /volume/top           → ClickHouse swap_events GROUP BY pool (< 100ms)
```

### 6.5 What NOT to Do in This Project

```ts
// ❌ Never query ClickHouse for the latest price — use Redis
const price = await clickhouse.query('SELECT price FROM swap_events ORDER BY timestamp DESC LIMIT 1')
// → slow, hits disk, wastes ClickHouse resources

// ✅ Use Redis for latest price
const price = await redis.get(`pair:${pool}:price`)

// ❌ Never update a swap event in ClickHouse
await clickhouse.query(`UPDATE swap_events SET finalized = 1 WHERE tx_hash = '0xABC'`)
// → rewrites an entire part, extremely slow

// ✅ Store finalization state in PostgreSQL
await db.query(`UPDATE swap_events SET finalized = true WHERE tx_hash = $1`, [txHash])

// ❌ Never join swap_events with the tokens table in ClickHouse
SELECT s.price, t.symbol FROM swap_events s JOIN tokens t ON s.token0 = t.address
// → tokens is in PostgreSQL, cross-DB joins don't exist

// ✅ Denormalize token symbol into swap_events at insert time
// OR join in application layer (query PG for token info, CH for analytics)
```

In the DEX scanner, `swap_events` arrive at 1000–2000/sec. You need to answer:

```sql
-- What is the 24h trading volume for pool 0xAAA?
SELECT sum(amount_in) FROM swap_events
WHERE pool_address = '0xAAA' AND timestamp > now() - interval 24 hour

-- What is the price trend for the last 1 hour?
SELECT toStartOfMinute(timestamp) as minute, avg(price)
FROM swap_events
WHERE pool_address = '0xAAA'
GROUP BY minute ORDER BY minute

-- Which pools had the most activity in the last 10 minutes?
SELECT pool_address, count() as swaps, sum(amount_in) as volume
FROM swap_events
WHERE timestamp > now() - interval 10 minute
GROUP BY pool_address ORDER BY swaps DESC LIMIT 10
```

PostgreSQL would take seconds on billions of rows. ClickHouse answers in milliseconds.

### Data volume estimate:

```
2000 swaps/sec × 60s × 60min × 24h = 172,800,000 rows/day
                                    = ~173M rows/day
                                    = ~5B rows/month

PostgreSQL on 5B rows → queries take minutes
ClickHouse on 5B rows → queries take milliseconds
```

### Architecture fit:

```
Kafka (swap_events topic)
    ↓
ClickhouseWriterConsumer
    ↓ batch 1000 rows every 1s
ClickHouse table: swap_events
    ↓
API: GET /analytics/volume, /analytics/price-history
```

Kafka → ClickHouse is the standard production pattern for high-throughput event analytics.

---

## 7. Setup Guide

### Option A: Docker (local dev)

Add to your `docker-compose.kafka.yml`:

```yaml
clickhouse:
  image: clickhouse/clickhouse-server:latest
  container_name: clickhouse-dev
  ports:
    - '8123:8123'   # HTTP interface (queries via curl/UI)
    - '9000:9000'   # Native TCP interface (used by Node.js client)
  environment:
    CLICKHOUSE_DB: dex_scanner
    CLICKHOUSE_USER: default
    CLICKHOUSE_PASSWORD: ''
    CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
  volumes:
    - clickhouse_data:/var/lib/clickhouse

volumes:
  clickhouse_data:
```

Start it:
```bash
docker-compose -f docker-compose.kafka.yml up -d
```

### Create the table

Connect via HTTP:
```bash
curl http://localhost:8123 --data "
CREATE TABLE IF NOT EXISTS dex_scanner.swap_events (
  pool_address   String,
  price          Float64,
  amount_in      UInt256,
  amount_out     UInt256,
  direction      Enum8('buy' = 1, 'sell' = 2),
  wallet         String,
  tx_hash        String,
  block_number   UInt64,
  timestamp      DateTime,
  source         Enum8('dex_pool' = 1, 'bonding_curve' = 2),
  chain_id       UInt32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (pool_address, timestamp)
"
```

- `ENGINE = MergeTree()` — standard engine for time-series data
- `PARTITION BY toYYYYMM(timestamp)` — splits data by month, old partitions can be dropped cheaply
- `ORDER BY (pool_address, timestamp)` — sorts data so queries filtering by pool + time are fast

### Install Node.js client

```bash
pnpm add @clickhouse/client
```

### Replace mock in ClickhouseWriterConsumer

```ts
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: 'http://localhost:8123',
  database: 'dex_scanner',
})

private async flushBatch(): Promise<void> {
  if (this.batch.length === 0) return
  const toInsert = this.batch.splice(0)

  await clickhouse.insert({
    table: 'swap_events',
    values: toInsert,
    format: 'JSONEachRow',
  })
}
```

---

## 8. Pricing

### Self-hosted (Free)

ClickHouse is open source — run it yourself on any cloud:

| Cloud | Instance | Cost | Capacity |
|---|---|---|---|
| AWS EC2 | r6i.2xlarge (8 vCPU, 64GB RAM) | ~$400/mo | ~500M rows/day |
| AWS EC2 | r6i.8xlarge (32 vCPU, 256GB RAM) | ~$1,600/mo | ~5B rows/day |
| Hetzner (EU) | AX102 (24 core, 128GB RAM) | ~$200/mo | ~2B rows/day |

Storage: ~$0.023/GB/mo on AWS S3 or EBS. With 10x compression, 5B rows/day ≈ 50GB raw → 5GB compressed.

### ClickHouse Cloud (Managed)

Official managed service at clickhouse.cloud:

| Tier | Price | Notes |
|---|---|---|
| **Development** | ~$50–100/mo | 1 replica, limited compute |
| **Production** | ~$300–800/mo | 3 replicas, auto-scaling |
| **Enterprise** | Custom | Dedicated, SLA, HIPAA/SOC2 |

Pricing model: **compute ($/hr) + storage ($/GB)**. You pay only when queries run — idle clusters scale to zero.

### Alternatives comparison

| Service | Price | Notes |
|---|---|---|
| ClickHouse (self-hosted) | $200–1600/mo infra | Full control, ops overhead |
| ClickHouse Cloud | $300–800/mo | Managed, easiest |
| AWS Redshift | $300–1000/mo | Slower, better AWS integration |
| BigQuery | Pay per query ($5/TB scanned) | Good for infrequent queries |
| Snowflake | $400–1200/mo | Enterprise, expensive |

For a DEX scanner startup: **ClickHouse Cloud Development** ($50-100/mo) to start, scale to Production when you hit 100M+ rows/day.

---

## 9. Interview Questions

### Basic

**Q: What is ClickHouse and when would you use it?**

> ClickHouse is a column-oriented database optimised for analytical queries (OLAP). Use it when you need to aggregate millions or billions of rows — event logs, time-series, metrics. Don't use it when you need row-level updates, transactions, or complex joins.

**Q: What is the difference between row-oriented and column-oriented storage?**

> Row-oriented stores all columns of a row together — great for reading/writing individual rows. Column-oriented stores each column separately — great for aggregating a single column across millions of rows because you skip reading irrelevant columns entirely.

**Q: Why must you batch inserts in ClickHouse?**

> ClickHouse writes data in parts and merges them in the background. Single-row inserts create thousands of tiny parts that must be merged constantly, which degrades performance. You should insert at minimum 100–1000 rows per batch, ideally 10,000+.

---

### Intermediate

**Q: What is the MergeTree engine and how does it work?**

> MergeTree is the primary storage engine. Data is written in sorted batches called parts. Background merges combine parts into larger sorted parts. Each part has a sparse primary index (min/max per block) that allows skipping blocks during queries. The ORDER BY clause defines the sort key, which determines which queries are fastest.

**Q: What is PARTITION BY and why does it matter?**

> PARTITION BY splits data into separate directories by a value (e.g., month). You can DROP PARTITION to delete a whole month of data instantly — without scanning rows. Queries that filter by the partition key only scan relevant partitions. In the DEX scanner, `PARTITION BY toYYYYMM(timestamp)` lets you drop data older than 6 months in one operation.

**Q: How would you handle deduplication in ClickHouse?**

> Use `ReplacingMergeTree` engine — it deduplicates rows with the same ORDER BY key during merges. But merges are async so duplicates may appear briefly. For guaranteed deduplication at query time, use `FINAL` modifier: `SELECT ... FROM table FINAL`. For the DEX scanner, `tx_hash` should be unique — use `ReplacingMergeTree` with `tx_hash` in the ORDER BY.

---

### Advanced

**Q: How does ClickHouse achieve millisecond query times on billions of rows?**

> Three things: (1) Column storage — only reads relevant columns. (2) Vectorized execution — processes 65,536 rows per CPU instruction cycle using SIMD. (3) Sparse index — skips entire blocks of rows that can't satisfy WHERE conditions. Combined, it can scan and aggregate 1B rows/sec per core.

**Q: How would you design a schema for swap events with fast price history queries?**

> ```sql
> CREATE TABLE swap_events (
>   pool_address String,
>   timestamp DateTime,
>   price Float64,
>   ...
> )
> ENGINE = MergeTree()
> PARTITION BY toYYYYMM(timestamp)
> ORDER BY (pool_address, timestamp)
> ```
> `ORDER BY (pool_address, timestamp)` means rows for the same pool are stored together and sorted by time — so `WHERE pool_address = 'X' AND timestamp > Y` skips all other pools entirely without scanning them.

**Q: In our DEX scanner, Kafka consumers batch-insert into ClickHouse. What happens if the consumer crashes mid-batch?**

> With at-least-once delivery from Kafka, the batch may be re-inserted on restart. Use `ReplacingMergeTree` with `tx_hash` as part of the ORDER BY to deduplicate. Or use Kafka's `EXACTLY_ONCE` semantics with Kafka transactions, but that adds latency. For trading analytics where a duplicate row slightly skews a volume number, `ReplacingMergeTree` is the pragmatic choice.

**Q: How would you scale ClickHouse if one node isn't enough?**

> Use a **Distributed table** over a **cluster** of shards. Each shard holds a subset of data (e.g., shard by `pool_address`). A Distributed table acts as a router — queries fan out to all shards and results are merged. Add replicas per shard for redundancy. In ClickHouse Cloud this is managed automatically.

---

## 10. Quick Reference

```bash
# Connect via HTTP
curl 'http://localhost:8123/?query=SELECT+count()+FROM+dex_scanner.swap_events'

# Connect via CLI (inside Docker)
docker exec -it clickhouse-dev clickhouse-client

# Check row count
SELECT count() FROM swap_events;

# Check table size on disk
SELECT
  formatReadableSize(sum(bytes_on_disk)) as size,
  count() as parts
FROM system.parts
WHERE table = 'swap_events' AND active;

# Check compression ratio
SELECT
  formatReadableSize(sum(data_uncompressed_bytes)) as uncompressed,
  formatReadableSize(sum(data_compressed_bytes)) as compressed,
  round(sum(data_uncompressed_bytes) / sum(data_compressed_bytes), 2) as ratio
FROM system.columns
WHERE table = 'swap_events';
```
