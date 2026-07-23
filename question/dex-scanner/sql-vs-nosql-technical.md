# SQL vs NoSQL — Technical Deep Dive

---

## The Fundamental Difference

SQL and NoSQL differ at the storage engine level, not just the query language.

```
SQL (PostgreSQL, MySQL):
  → Data stored in rows on heap pages
  → Schema enforced at write time
  → ACID transactions built-in
  → Optimized for: relational queries, point lookups, updates

NoSQL (Redis, MongoDB, Cassandra, Elasticsearch):
  → Data stored in structures optimized per use case
  → Schema optional or enforced by application
  → Consistency is tunable (eventual → strong)
  → Optimized for: one specific access pattern at extreme scale
```

There is no single "NoSQL" — each database is a different storage engine solving a different problem. Comparing "SQL vs NoSQL" is like comparing "cars vs everything else" — a truck, a motorcycle, and a boat are all "not a car" but have nothing in common.

---

## 1. How SQL Stores Data Internally

### Heap + B-tree index (PostgreSQL)

```
Table: pools (3 rows)

Heap (actual data, stored on 8KB pages):
┌──────────────────────────────────────────────┐
│ Page 0                                        │
│  [address=0xAAA, token0=0xUSDC, fee=3000]    │
│  [address=0xBBB, token0=0xDAI,  fee=500 ]    │
│  [address=0xCCC, token0=0xUSDT, fee=100 ]    │
└──────────────────────────────────────────────┘

B-tree index on `address`:
         [0xBBB]
        /        \
   [0xAAA]     [0xCCC]
      ↓             ↓
  heap ptr      heap ptr   → points directly to row in heap
```

**Query: `SELECT * FROM pools WHERE address = '0xAAA'`**

```
1. Walk B-tree index → find heap pointer for 0xAAA
2. Jump directly to page+offset on heap
3. Return row

Cost: O(log N) for B-tree walk + 1 heap access
For 100K pools: ~17 comparisons in B-tree + 1 page read = ~0.1ms
```

**Query: `SELECT * FROM pools WHERE token0 = '0xUSDC'`** (no index)

```
1. Scan every page in the heap (sequential scan)
2. Filter rows where token0 = '0xUSDC'

Cost: O(N) — reads all 100K rows
For 100K rows: ~100ms (disk-bound)
Fix: CREATE INDEX idx_pools_token0 ON pools(token0)
```

### MVCC — how PostgreSQL handles concurrent reads/writes

```
PostgreSQL never overwrites a row in place. Every UPDATE creates a new version:

Before UPDATE:
  Row version 1: [address=0xAAA, fee=3000] xmin=100 xmax=NULL  ← visible

After UPDATE SET fee=500:
  Row version 1: [address=0xAAA, fee=3000] xmin=100 xmax=200   ← hidden (old)
  Row version 2: [address=0xAAA, fee=500 ] xmin=200 xmax=NULL  ← visible

Transaction at xid=150 still sees version 1 (snapshot isolation).
Transaction at xid=250 sees version 2.
```

This is why PostgreSQL needs `VACUUM` — to reclaim space from dead row versions (xmax != NULL).

---

## 2. How Each NoSQL Type Stores Data Internally

### 2.1 Key-Value Store — Redis

```
Storage engine: in-memory hash table + persistence via RDB/AOF

Hash table (simplified):
  bucket 0: [ "pair:0xAAA:price" → "1842.50" ]
  bucket 1: [ "pair:0xBBB:price" → "1843.10" ]
  bucket 7: [ "session:user123"  → "{...json}" ]

GET pair:0xAAA:price
  → hash("pair:0xAAA:price") → bucket 0 → return "1842.50"
  → O(1), sub-millisecond, always

No disk reads. Everything in RAM.
```

**Redis persistence options:**

```
RDB (snapshot): write full dataset to disk every N minutes
  → fast restarts, but lose last N minutes of writes on crash

AOF (append-only file): log every write command to disk
  → no data loss, but slower restarts (replay all commands)

AOF + RDB: both (production default)
```

### 2.2 Document Store — MongoDB

```
Storage engine: WiredTiger (B-tree variant, row-oriented)

Documents stored in BSON (Binary JSON) on disk:
  Collection: tokens
    doc1: { _id: "0xAAA", symbol: "PEPE", decimals: 18, meta: { twitter: "@pepe" } }
    doc2: { _id: "0xBBB", symbol: "DOGE", decimals: 8 }
    doc3: { _id: "0xCCC", symbol: "SHIB", decimals: 18, meta: { audit: "certik" } }

Index structure: B-tree on _id (default)
  → same concept as PostgreSQL B-tree

Query: db.tokens.find({ symbol: "PEPE" })
  → without index: full collection scan (like PostgreSQL Seq Scan)
  → with index:    B-tree walk → O(log N)
```

MongoDB's storage is architecturally similar to PostgreSQL but with:
- No schema enforcement (any document shape allowed)
- No joins (application must handle)
- No multi-document ACID until v4.0 (now supported but slower)

### 2.3 Wide-Column Store — Cassandra

```
Storage engine: LSM tree (Log-Structured Merge-tree)

Write path (very different from B-tree):
  1. Write to in-memory MemTable (fast, no disk seek)
  2. Write to commit log (sequential disk write for durability)
  3. When MemTable full → flush to SSTable on disk (immutable sorted file)
  4. Background compaction merges SSTables

                     MemTable (in memory)
                          │
                          │ flush
                          ▼
  SSTable 1: [key1→val, key3→val, key5→val]  (sorted, immutable)
  SSTable 2: [key2→val, key4→val, key6→val]  (sorted, immutable)
                          │
                          │ compaction
                          ▼
  SSTable merged: [key1, key2, key3, key4, key5, key6]
```

**Why LSM tree is faster for writes than B-tree:**

```
B-tree (PostgreSQL, MongoDB):
  INSERT → find correct page → random disk write (expensive)
  → ~5,000 random writes/sec per disk

LSM tree (Cassandra):
  INSERT → append to MemTable → sequential disk write (cheap)
  → ~500,000 sequential writes/sec per disk

Trade-off: reads are slower (must check MemTable + multiple SSTables)
```

**Cassandra data model — wide rows:**

```
Partition key   │  Clustering key  │  Columns
────────────────┼──────────────────┼─────────────────────────────
pool_address    │  timestamp       │  price, amount, wallet
────────────────┼──────────────────┼─────────────────────────────
0xAAA111        │  1749600001      │  1842.50, 100M, 0xWALLET1
0xAAA111        │  1749600002      │  1843.10, 200M, 0xWALLET2
0xAAA111        │  1749600003      │  1841.90, 150M, 0xWALLET3
0xBBB222        │  1749600001      │  0.0023,  50M,  0xWALLET4

All rows with partition_key=0xAAA111 are stored together on the same node.
Range scan on clustering key (timestamp) within a partition is fast.
```

### 2.4 Search Engine — Elasticsearch

```
Storage engine: inverted index (Lucene)

Normal index (B-tree): value → document
  "PEPE" → [doc1]

Inverted index: term → list of document IDs
  "pepe"     → [doc1, doc45, doc78]
  "meme"     → [doc1, doc12, doc45]
  "ethereum" → [doc2, doc45, doc99]

Query: "pepe meme coin"
  → lookup "pepe"     → [1, 45, 78]
  → lookup "meme"     → [1, 12, 45]
  → lookup "coin"     → [1, 45, 67]
  → intersect         → [1, 45]    ← documents containing all terms
  → rank by relevance → doc1 (matches all 3 terms in title) wins

This is why full-text search is milliseconds even over billions of documents.
B-tree cannot do this — LIKE '%pepe%' does full table scan.
```

---

## 3. CAP Theorem

Every distributed database must choose 2 of 3:

```
        Consistency
            /\
           /  \
          /    \
         /      \
   Availability──Partition Tolerance

C = all nodes return the same data at the same time
A = system always responds (even if data might be stale)
P = system works even if network splits nodes apart

Network partitions ALWAYS happen in distributed systems.
So the real choice is: CP or AP.
```

| Database | Choice | Meaning |
|---|---|---|
| PostgreSQL (single node) | CA | Consistent + Available, not distributed |
| Redis (cluster) | AP | Available + Partition-tolerant, eventual consistency |
| MongoDB (default) | CP | Consistent + Partition-tolerant, primary may be unavailable during election |
| Cassandra | AP | Available + Partition-tolerant, tunable consistency per query |
| Elasticsearch | AP | Eventually consistent across shards |

**In the DEX scanner:**

```
Pool metadata (PostgreSQL) → CA
  Needs consistency: when you UPDATE a pool, all reads must see the new value.

Latest prices (Redis) → AP
  Stale price for 10ms is acceptable. Always available matters more.

Swap history (ClickHouse) → CP-ish
  Analytics can tolerate brief replica lag. Consistency on the write node.
```

---

## 4. ACID vs BASE

### SQL — ACID

```
Atomicity   → all operations in a transaction succeed or all fail (no partial writes)
Consistency → database is always in a valid state (constraints, foreign keys hold)
Isolation   → concurrent transactions don't see each other's in-progress changes
Durability  → committed data survives crashes (written to disk via WAL)
```

```sql
-- ACID example: transfer balance between wallets
BEGIN;
  UPDATE wallets SET balance = balance - 100 WHERE id = 1;  -- debit
  UPDATE wallets SET balance = balance + 100 WHERE id = 2;  -- credit
COMMIT;
-- If the server crashes between the two UPDATE statements:
-- ROLLBACK automatically — balance is never lost or doubled
```

### NoSQL — BASE

```
Basically Available  → system always responds
Soft state           → data may change over time even without new writes (replication)
Eventually consistent → all nodes will converge to the same value — eventually
```

```
Redis write to primary:
  SET pair:0xAAA:price 1842.50  → written to primary

Redis replica:
  reads pair:0xAAA:price → may still return 1841.90 for ~10ms
  → eventually gets the replication update → returns 1842.50

This is "eventually consistent". The replica will be correct, just not immediately.
```

---

## 5. SQL Best Practices

### 5.1 Index Strategy

```sql
-- Rule: index every column that appears in WHERE, JOIN ON, or ORDER BY

-- Foreign keys are NOT auto-indexed in PostgreSQL — add them manually
CREATE INDEX idx_pools_token0 ON pools(token0);
CREATE INDEX idx_pools_token1 ON pools(token1);

-- Composite index: column order matters
-- Query: WHERE pool = 'X' AND timestamp > Y
CREATE INDEX idx_swaps_pool_time ON swap_events(pool_address, timestamp);
-- ↑ This index works for:
--   WHERE pool_address = 'X'                          ✓
--   WHERE pool_address = 'X' AND timestamp > Y        ✓
--   WHERE timestamp > Y                               ✗ (leftmost rule)

-- Partial index: only index rows you actually query
CREATE INDEX idx_pools_active ON pools(address) WHERE is_active = true;
-- → much smaller index, faster queries, only covers active pools

-- Covering index: include extra columns to avoid heap fetch
CREATE INDEX idx_pools_covering ON pools(token0) INCLUDE (address, fee_tier);
-- Query: SELECT address, fee_tier WHERE token0 = 'X'
-- → Index contains all needed columns → no heap access needed (index-only scan)
```

### 5.2 Query Optimization

```sql
-- Always EXPLAIN ANALYZE before optimizing
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.address, t.symbol
FROM pools p JOIN tokens t ON p.token0 = t.address
WHERE t.symbol = 'PEPE';

-- Watch for:
-- Seq Scan on large table  → missing index
-- Hash Join on large sets  → may need index on join column
-- Rows=1000 (estimated) vs actual=50000 → stale statistics, run ANALYZE

-- Fix stale statistics
ANALYZE pools;
-- Or set auto_vacuum more aggressively in postgresql.conf
```

```sql
-- Avoid SELECT * — fetch only what you need
-- BAD:
SELECT * FROM pools WHERE token0 = '0xUSDC';

-- GOOD:
SELECT address, fee_tier FROM pools WHERE token0 = '0xUSDC';
-- → less data transferred, can use covering index

-- Avoid N+1 — use IN or JOIN instead of looping
-- BAD (in application):
for (const pool of pools) {
  const token = await db.query('SELECT * FROM tokens WHERE address = $1', [pool.token0])
}

-- GOOD:
SELECT t.* FROM tokens t
WHERE t.address = ANY($1::varchar[])  -- one query for all tokens
```

### 5.3 Connection and Transaction Best Practices

```sql
-- Keep transactions short — long transactions hold locks
-- BAD:
BEGIN;
  -- some processing that takes 5 seconds
  UPDATE pools SET ...;
COMMIT;
-- → holds row lock for 5s, blocks other writers

-- GOOD:
-- Do processing outside the transaction
-- Only open transaction for the actual writes:
BEGIN;
  UPDATE pools SET ...;
COMMIT;  -- lock held for microseconds

-- Use RETURNING to avoid a second query
-- BAD:
INSERT INTO pools (address, token0, fee_tier) VALUES ('0xAAA', '0xUSDC', 3000);
SELECT * FROM pools WHERE address = '0xAAA';  -- second round trip

-- GOOD:
INSERT INTO pools (address, token0, fee_tier) VALUES ('0xAAA', '0xUSDC', 3000)
RETURNING *;  -- returns inserted row in one round trip
```

### 5.4 Schema Design Best Practices

```sql
-- Use appropriate types — don't over-allocate
-- BAD: VARCHAR(255) for everything
address VARCHAR(255)  -- Ethereum address is always 42 chars

-- GOOD: exact size
address CHAR(42)      -- or VARCHAR(42)
chain_id SMALLINT     -- values 1, 56, 137 fit in 2 bytes, not 8

-- Use ENUM for fixed value sets
direction VARCHAR(10)    -- BAD: 'buy', 'sell', or typo 'buuy'
direction direction_enum -- GOOD: CREATE TYPE direction_enum AS ENUM ('buy', 'sell')

-- Timestamps: always use TIMESTAMPTZ (with timezone), not TIMESTAMP
-- TIMESTAMP stores local time — ambiguous during DST changes
-- TIMESTAMPTZ stores UTC — unambiguous everywhere
created_at TIMESTAMPTZ DEFAULT NOW()

-- Use JSONB for flexible attributes instead of many nullable columns
-- BAD:
ALTER TABLE tokens ADD COLUMN twitter VARCHAR(100);     -- NULL for 99% of rows
ALTER TABLE tokens ADD COLUMN telegram VARCHAR(100);    -- NULL for 99% of rows

-- GOOD:
metadata JSONB DEFAULT '{}'
-- → flexible, compressed, queryable with GIN index
```

---

## 6. NoSQL Best Practices

### 6.1 Redis Best Practices

```
Key design: namespace:entity:id:field

Good keys:
  pair:0xAAA111:price          → latest price for pool
  pair:0xAAA111:volume:24h     → 24h volume (updated by cron)
  session:user123              → user session
  scanner:1:lastBlock          → scanner checkpoint

Bad keys:
  price                        → no namespace, collides with anything else
  pool_0xAAA111_price_latest   → inconsistent separator

Always set TTL:
  SET pair:0xAAA111:price 1842.50 EX 60   → expires in 60s
  → prevents unbounded memory growth
  → forces fresh data; stale price auto-expires

Use the right data structure:
  String  → single value (price, count, session token)
  Hash    → object with fields (user profile: name, email, role)
  List    → ordered queue (job queue, recent activity feed)
  Set     → unique membership (pool watchlist: add/remove/check)
  Sorted Set → leaderboard (top pools by volume, score = volume)
  Stream  → append-only log (audit trail, event sourcing)
```

```javascript
// WRONG: storing related data as separate keys (N round trips)
await redis.set('pool:0xAAA:price', 1842.50)
await redis.set('pool:0xAAA:volume', 100000)
await redis.set('pool:0xAAA:trades', 523)

// RIGHT: use Hash for object with multiple fields (1 round trip)
await redis.hSet('pool:0xAAA', {
  price: 1842.50,
  volume: 100000,
  trades: 523,
})
const data = await redis.hGetAll('pool:0xAAA')  // one command
```

### 6.2 MongoDB Best Practices

```javascript
// Schema design: embed vs reference

// EMBED when data is accessed together and is bounded in size
{
  _id: "0xAAA111",
  symbol: "PEPE-USDC",
  tokens: [                         // embedded — always read together
    { address: "0xPEPE", symbol: "PEPE", decimals: 18 },
    { address: "0xUSDC", symbol: "USDC", decimals: 6 }
  ],
  fee_tier: 3000
}

// REFERENCE when data is large, shared, or accessed independently
{
  _id: "0xAAA111",
  token0_id: "0xPEPE",   // reference to tokens collection
  token1_id: "0xUSDC",   // reference to tokens collection
  fee_tier: 3000
}
// → avoids duplicating token data across 10K pool documents
// → requires $lookup (join equivalent) to fetch token info
```

```javascript
// Always index fields you query
db.pools.createIndex({ "token0": 1 })
db.pools.createIndex({ "token1": 1 })
db.pools.createIndex({ "token0": 1, "token1": 1 })  // compound

// Partial index (only active documents)
db.pools.createIndex(
  { token0: 1 },
  { partialFilterExpression: { is_active: true } }
)

// Avoid unbounded arrays — they cause document growth issues
// BAD:
{ pool: "0xAAA", swap_history: [ ... 1M events ... ] }
// → document grows unboundedly, hits 16MB BSON limit

// GOOD:
// Swap history goes in a separate swaps collection
// Pool document contains only stable metadata
```

### 6.3 Cassandra Best Practices

```sql
-- Design tables around queries, NOT around entities
-- In SQL you normalize first, then query
-- In Cassandra you decide the query first, then design the table

-- Query: "get all swaps for pool 0xAAA in the last 1 hour"
CREATE TABLE swaps_by_pool (
  pool_address TEXT,
  timestamp    TIMESTAMP,
  price        DOUBLE,
  wallet       TEXT,
  tx_hash      TEXT,
  PRIMARY KEY (pool_address, timestamp)   -- partition=pool, cluster=time
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Query: "get all swaps by wallet 0xWALLET in the last 24h"
-- You need a SEPARATE table for this query pattern:
CREATE TABLE swaps_by_wallet (
  wallet       TEXT,
  timestamp    TIMESTAMP,
  pool_address TEXT,
  price        DOUBLE,
  tx_hash      TEXT,
  PRIMARY KEY (wallet, timestamp)         -- partition=wallet, cluster=time
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Write to both tables on every swap event (denormalization)
-- This is intentional in Cassandra — storage is cheap, joins are not
```

```
Partition key rules:
  ✓ Choose keys with high cardinality (many distinct values)
  ✓ Partition should hold 10MB–100MB of data (not 1KB, not 10GB)
  ✗ Avoid hot partitions: if 90% of queries hit one partition, one node is overloaded
  ✗ Avoid unbounded partitions: don't use pool_address alone if one pool has 1B rows
     → use (pool_address, year_month) to bucket by time
```

### 6.4 Elasticsearch Best Practices

```json
// Define mappings explicitly — don't rely on auto-detection
PUT /tokens
{
  "mappings": {
    "properties": {
      "address":     { "type": "keyword" },      // exact match, not analyzed
      "symbol":      { "type": "keyword" },      // exact match
      "description": { "type": "text",           // full-text search, tokenized
                       "analyzer": "english" },
      "decimals":    { "type": "integer" },
      "created_at":  { "type": "date" }
    }
  }
}
```

```
keyword vs text:
  keyword → exact match (WHERE symbol = 'PEPE')
  text    → full-text search (WHERE description CONTAINS 'meme coin')

keyword is stored as-is.
text is tokenized: "Pepe meme coin" → ["pepe", "meme", "coin"]
  → enables partial, fuzzy, and relevance-ranked search

Use keyword for: addresses, symbols, IDs, enum values
Use text for:    descriptions, names, user-generated content
```

---

## 7. Comparison Tables

### When to Use Each

| Scenario | Best Choice | Why |
|---|---|---|
| User accounts with login, roles | PostgreSQL | Relations, transactions, updates |
| Pool metadata with token joins | PostgreSQL | Foreign keys, JOIN, low volume |
| Latest price per pool | Redis | Sub-1ms, key-value, volatile |
| Session tokens | Redis | TTL, key-value, fast expiry |
| Rate limiting | Redis | Atomic INCR, TTL |
| Job queue | Redis Streams or BullMQ | FIFO, atomic pop |
| Swap event history (5B rows) | ClickHouse | Columnar, aggregation speed |
| Token catalog with flexible schema | PostgreSQL + JSONB | Joins + flexibility |
| Full-text search on token descriptions | Elasticsearch | Inverted index |
| Write 1M events/sec across clusters | Cassandra | LSM tree, linear horizontal scale |
| Chat messages, social feed | MongoDB | Document shape varies per type |

### Performance Characteristics

| Operation | PostgreSQL | Redis | MongoDB | Cassandra |
|---|---|---|---|---|
| Single read by key | ~1ms | ~0.1ms | ~1ms | ~2ms |
| Range query (1K rows) | ~5ms | ~1ms (sorted set) | ~5ms | ~3ms |
| Write single row | ~2ms | ~0.1ms | ~2ms | ~0.5ms |
| Write 10K rows/sec | ~50ms batch | ~10K/sec | ~10K/sec | ~100K/sec |
| JOIN two tables | ~5ms (indexed) | Not supported | $lookup (slow) | Not supported |
| Aggregate 1M rows | ~500ms | N/A | ~200ms | ~100ms |
| Full-text search | slow (LIKE %) | Not supported | Basic | Not supported |
| Max practical scale | ~100M rows | RAM-limited | ~100M docs | 100B+ rows |

### Feature Matrix

| Feature | PostgreSQL | Redis | MongoDB | Cassandra | Elasticsearch |
|---|---|---|---|---|---|
| ACID transactions | Full | Single-key atomic | Multi-doc (v4+, slow) | Lightweight transactions | None |
| Schema enforcement | Strict | None | Optional | Column-level | Mapping-level |
| Joins | Excellent | None | $lookup (limited) | None | None |
| Indexes | B-tree, GiST, GIN, BRIN | Sorted Set | B-tree + text | Partition only | Inverted |
| Replication | Streaming | Primary-replica | Replica set | Peer-to-peer | Shard replicas |
| Horizontal write scale | Manual sharding | Cluster (hash slots) | Sharding | Built-in (consistent hash) | Built-in |
| TTL on data | Manual (cron) | Native (EXPIRE) | TTL index | Native (default_time_to_live) | ILM policies |
| Query language | SQL | Commands | MQL (JS-like) | CQL (SQL-like) | Query DSL (JSON) |

---

## 8. Should I Use SQL or NoSQL in the DEX Scanner?

This section walks through every piece of data in the DEX scanner and explains the exact reason for each database choice — including what breaks if you choose the wrong one.

---

### The Data Inventory

The DEX scanner produces and consumes four distinct types of data:

```
1. Pool metadata       → who exists (pools, tokens)         → rarely changes
2. Swap events         → what happened (price, amount, tx)  → append-only, massive volume
3. Latest price        → what is now (current price/time)   → replaced every 500ms
4. Scanner checkpoint  → where we are (lastBlock)           → updated per batch
```

Each type has a different access pattern. That is what drives the database choice — not preference, not familiarity.

---

### Entity 1: Pool and Token Metadata → PostgreSQL (SQL)

```sql
CREATE TABLE tokens (
  address  VARCHAR(42) PRIMARY KEY,
  symbol   VARCHAR(20),
  decimals INT
);

CREATE TABLE pools (
  address  VARCHAR(42) PRIMARY KEY,
  token0   VARCHAR(42) REFERENCES tokens(address),  ← FK
  token1   VARCHAR(42) REFERENCES tokens(address),  ← FK
  fee_tier INT
);
```

**Why SQL:**

```
Question 1: Does this data have relationships?
  A pool IS DEFINED by its two tokens.
  pool.token0 → tokens.address (foreign key constraint)
  pool.token1 → tokens.address (foreign key constraint)
  → YES. Use SQL.

Question 2: Does it need UPDATE or DELETE?
  Pool discovered → INSERT pool
  Pool deactivated → UPDATE pools SET is_active = false WHERE address = '0xAAA'
  Token metadata changes → UPDATE tokens SET symbol = 'NEWNAME' WHERE address = '0xAAA'
  → YES. Use SQL.

Question 3: Does it need JOIN?
  API: "give me all pools and their token symbols"
  SELECT p.address, t0.symbol, t1.symbol
  FROM pools p
  JOIN tokens t0 ON p.token0 = t0.address
  JOIN tokens t1 ON p.token1 = t1.address
  → YES. Use SQL.

Question 4: Does scale matter?
  Ethereum has ~200K unique pools.
  PostgreSQL handles 100M rows with indexes.
  200K rows = trivial. PostgreSQL responds in < 1ms.
  → NO. Scale is not a concern here.
```

**What breaks if you use MongoDB instead:**

```javascript
// MongoDB: no joins, no FK → application must do the joining
const pool = await pools.findOne({ address: '0xAAA' })
// → { token0: '0xPEPE', token1: '0xUSDC', fee_tier: 3000 }

// Must do two more round trips to get token symbols
const token0 = await tokens.findOne({ address: pool.token0 })
const token1 = await tokens.findOne({ address: pool.token1 })

// Total: 3 round trips instead of 1 JOIN
// No FK enforcement: pool.token0 can reference a non-existent token
// No transaction: pool insert succeeds but token insert fails → orphaned pool
```

**What breaks if you use Cassandra instead:**

```
Cassandra has no joins, no FK, no UPDATE in place.
To "update" a pool's fee_tier, you write a new row (LSM tree — never overwrites).
Old row coexists until compaction. Which value is "current"?
→ Cassandra requires a versioned data model for mutable data.
→ Pool metadata is mutable (status changes) — wrong fit.
```

---

### Entity 2: Swap Events → ClickHouse (NoSQL-adjacent, columnar)

```sql
CREATE TABLE swap_events (
  pool_address  LowCardinality(String),
  price         Float64,
  amount_in     String,
  tx_hash       String,
  timestamp     DateTime,
  ...
)
ENGINE = ReplacingMergeTree()
ORDER BY (pool_address, timestamp);
```

**Why ClickHouse (not PostgreSQL, not Cassandra):**

```
Data volume:
  2000 swaps/sec × 86400 sec/day = 172,800,000 rows/day
  × 30 days = 5,180,000,000 rows/month (5 billion)

Question 1: Does this data need UPDATE or DELETE?
  Swap events are facts. They happened. You never change them.
  → NO. Append-only. ClickHouse excels here.

Question 2: Does it need joins?
  The swap event carries pool_address, wallet, price inline.
  No join needed to answer "what was the price history of pool X?"
  → NO. Denormalized. ClickHouse excels here.

Question 3: What are the main queries?
  SELECT avg(price) WHERE pool = 'X' AND timestamp > now() - 24h  ← aggregation
  SELECT sum(amount_in) GROUP BY pool ORDER BY sum DESC LIMIT 10   ← aggregation
  SELECT toStartOfMinute(timestamp), max(price) GROUP BY 1         ← OHLCV
  → ALL aggregations over time. Columnar storage wins.

Question 4: What happens in PostgreSQL at 5B rows?
  SELECT avg(price) FROM swap_events WHERE pool = 'X'
  → PostgreSQL: reads every row in the price column for pool X
     row-store: reads [tx_hash, pool, price, amount, wallet, ...] for each row
     then extracts just price
  → ClickHouse: reads ONLY the price column file for pool X
     10x less I/O → 100x faster query
```

**Concrete benchmark at 1 billion rows:**

```
Query: SELECT avg(price) WHERE pool = '0xAAA' AND timestamp > now() - 24h

PostgreSQL:  ~120 seconds   (row scan, B-tree index helps only on pool filter)
ClickHouse:  ~0.8 seconds   (columnar scan, sparse index skips non-AAA blocks)

At 5B rows, PostgreSQL takes ~600 seconds. ClickHouse still ~4 seconds.
```

**Why not Cassandra for swap events?**

```
Cassandra writes faster than ClickHouse (LSM tree vs MergeTree).
But Cassandra is designed for point reads (give me wallet X's swaps),
not aggregations (give me avg price over 1M rows).

Cassandra reads 1M rows to compute AVG: must deserialize each row individually.
ClickHouse reads 1M price values as a raw float array from a column file → SIMD AVG.

The DEX scanner's read pattern is 100% aggregation.
Cassandra would be the wrong engine.
```

---

### Entity 3: Latest Price per Pool → Redis (NoSQL, key-value)

```
Redis keys written by RedisWriterConsumer:
  pair:0xAAA111:price = "1842.50"
  pair:0xAAA111:time  = "1749600123"
  pair:0xBBB222:price = "0.0023"
  ...
```

**Why Redis:**

```
Access pattern: GET pair:0xAAA111:price
  → called by price ticker API, potentially 1000x/sec
  → must return in < 1ms

Question 1: Does this data need history?
  No. "Latest price" means only the current value matters.
  When a new swap arrives, the old price is replaced.
  → SET overwrites. No history needed. Key-value is perfect.

Question 2: Does it need aggregation?
  No. Single key lookup: GET pair:0xAAA:price → "1842.50"
  → O(1) hash table lookup. Cannot be faster.

Question 3: What about durability?
  If Redis restarts, prices are re-published by Kafka consumers
  within milliseconds (consumers replay from latest Kafka offset).
  Losing 1 second of price data on crash is acceptable.
  → In-memory is fine. Persistence is optional.

Question 4: Why not PostgreSQL for this?
  PostgreSQL: SELECT price FROM pools WHERE address = '0xAAA'
  → Even with perfect index: disk I/O + buffer pool + query planning = ~1ms
  → Under 1000 concurrent requests: connection pool pressure, lock contention

  Redis: GET pair:0xAAA:price
  → In-memory hash table lookup = 0.05ms
  → Lock-free. 100K requests/sec with no contention.
  → 20x faster, scales linearly.
```

**What Redis gives you that no SQL can:**

```javascript
// Atomic increment — no transaction needed
await redis.incr('pool:0xAAA:trade_count')      // always atomic, never races

// Expiry — no cron job needed
await redis.setex('pair:0xAAA:price', 60, '1842.50')  // auto-expires in 60s
// → if the scanner stops publishing, the stale price disappears automatically

// Pub/Sub — broadcast price updates to WebSocket clients
await redis.publish('price-updates', JSON.stringify({ pool: '0xAAA', price: 1842.50 }))
// WebSocket server subscribes and pushes to all connected traders in real-time
```

---

### Entity 4: Scanner Checkpoint → Redis (NoSQL, key-value)

```
Redis key: scanner:1:lastBlock = "22500099"

On scanner startup: read this key → resume from block 22500099 + 1
On each batch commit: SET scanner:1:lastBlock "22500150"
```

**Why Redis (not PostgreSQL):**

```
This is a single integer that gets overwritten on every batch (every ~500ms).
PostgreSQL UPDATE would work, but:
  → opens a transaction, acquires a row lock, writes WAL, releases lock
  → ~2ms per update × 2 updates/sec = measurable overhead for one integer

Redis SET:
  → in-memory write, AOF append = ~0.1ms
  → no locks, no transactions needed for a single key

Also: checkpoints and prices belong in the same Redis instance.
Less infrastructure, simpler operations.
```

---

### The Full Decision Map

```
For every new piece of data, ask these questions in order:

1. Does it have relationships to other entities (FK, JOIN)?
      YES → PostgreSQL

2. Does it need UPDATE or DELETE?
      YES → PostgreSQL (or Redis for single-value overwrite)

3. Does it need ACID transactions?
      YES → PostgreSQL

4. Is it a single value looked up by key with < 1ms requirement?
      YES → Redis

5. Is it append-only, time-series, queried by aggregation (SUM/AVG/COUNT)?
   AND volume > 10M rows?
      YES → ClickHouse

6. Does it need full-text search (LIKE '%keyword%' at scale)?
      YES → Elasticsearch

7. Does it have unpredictable, varying schema AND no joins needed?
      YES → MongoDB

8. Does it need to sustain 1M+ writes/sec across many nodes?
      YES → Cassandra
```

**Applied to the DEX scanner:**

```
tokens table
  → Has FK (referenced by pools) → PostgreSQL ✓

pools table
  → Has FK to tokens → needs JOIN → needs UPDATE (deactivate) → PostgreSQL ✓

swap_events
  → Append-only → 5B rows → aggregation queries → ClickHouse ✓

latest price
  → Single key-value → < 1ms → overwritten not appended → Redis ✓

scanner checkpoint
  → Single key-value → overwritten constantly → Redis ✓

token search by name/description (future feature)
  → Full-text → Elasticsearch (add when needed)
```

---

### What Happens When You Get This Wrong

```
WRONG: Store swap events in PostgreSQL
  → At 5B rows, OHLCV chart query takes 10 minutes
  → You add indexes, they help briefly, then the table outgrows B-tree efficiency
  → You migrate to ClickHouse anyway, but now with 5B rows of migration pain

WRONG: Store latest prices in PostgreSQL
  → 1000 traders hitting GET /price/0xAAA simultaneously
  → 1000 PostgreSQL connections (hits max_connections limit)
  → Price responses take 5–10ms instead of 0.1ms
  → Traders see stale or erroring price feed

WRONG: Store pool metadata in Redis
  → No joins: GET pool returns token0=0xPEPE but you need the symbol
  → Two extra round trips for token0 and token1 symbols
  → No FK: a pool can reference a token that doesn't exist
  → UPDATE fee_tier: Redis has no partial update for a structured record
     (hSet works, but you lose FK enforcement and join capability)

WRONG: Store pool metadata in MongoDB
  → $lookup (join) is 10x slower than PostgreSQL JOIN at scale
  → No FK constraint: data integrity must be enforced in application code
  → Same schema stability as PostgreSQL anyway (pool schema never changes)
  → Zero benefit, extra complexity
```

---

## 9. Interview Q&A

**Q: What is the fundamental difference between SQL and NoSQL?**

> SQL databases store data in normalized tables with enforced schemas and support joins, foreign keys, and ACID transactions. NoSQL is not one thing — it is a category of databases each optimized for a specific data model: Redis for key-value, MongoDB for documents, Cassandra for wide-column writes, Elasticsearch for full-text search. The key trade-off is that NoSQL gives up one or more of joins, transactions, or consistency in exchange for scale or access-pattern speed.

**Q: Explain the CAP theorem and how it affects your database choice.**

> CAP says a distributed system can guarantee only two of: Consistency (all nodes return the same data), Availability (system always responds), and Partition Tolerance (system works when nodes can't communicate). Since network partitions always happen, the real choice is CP vs AP. PostgreSQL is CA (not designed for network partitions — use a single primary). Redis and Cassandra are AP — they stay available during a partition but replicas may briefly lag. For pool metadata that must be accurate, I use PostgreSQL (CP). For latest prices where a 10ms lag is acceptable, I use Redis (AP).

**Q: Why does Cassandra handle more writes per second than PostgreSQL?**

> PostgreSQL uses a B-tree index: every write must find the correct position in the tree and do a random disk seek to update the page. SSDs do ~10K random writes/sec. Cassandra uses an LSM tree: every write goes to an in-memory buffer (MemTable) and is flushed sequentially to disk. Sequential writes are 100x faster than random writes. The trade-off is that reads may need to check multiple SSTables (partially fixed by Bloom filters).

**Q: When would you choose MongoDB over PostgreSQL?**

> When documents in a collection genuinely have different shapes that change unpredictably — like user-generated content, event logs with varying fields, or product catalogs where each category has different attributes. MongoDB's strength is schema flexibility. If the schema is stable and you need joins or transactions, PostgreSQL is better. In practice, PostgreSQL's JSONB column gives you most of MongoDB's flexibility while keeping relational features — I reach for MongoDB only when the document model is the primary access pattern.

**Q: In the DEX scanner, a new developer suggests replacing Redis with PostgreSQL for storing latest prices. How do you respond?**

> Redis returns a value in ~0.1ms because everything is in RAM and the access is O(1). PostgreSQL would require a disk read (even with cache, ~1ms) and query planning overhead. For a price feed that traders query hundreds of times per second, that 10x latency difference matters. More importantly, Redis `SET key value` is atomic and lock-free at any throughput. PostgreSQL would require connection pooling and row-level locking under high concurrency. Redis is the right tool for this exact use case — it is not a workaround, it is the standard architecture for real-time price feeds.

**Q: How does Redis persistence work, and what are the trade-offs?**

> Redis has two persistence modes. RDB takes periodic snapshots of the full dataset to disk — fast restart, but you lose writes since the last snapshot. AOF logs every write command sequentially — no data loss (or max 1 second with `appendfsync everysec`), but restart is slower because all commands must be replayed. Production setups use both: AOF for durability, RDB for fast restarts. For a price feed where losing 1 second of prices is acceptable (prices are republished from Kafka on restart), RDB-only is fine.

---

## 10. MongoDB `$lookup` vs PostgreSQL `JOIN` — The Real Difference

MongoDB **can** join collections via `$lookup`. The distinction is not "can join" vs "cannot join" — it is "joins are a first-class citizen" vs "joins are possible but not what the database is designed for."

### Syntax comparison

```javascript
// MongoDB $lookup
db.pools.aggregate([
  {
    $lookup: {
      from: 'tokens',
      localField: 'token0',
      foreignField: 'address',
      as: 'token0_info'        // result is an ARRAY nested inside the document
    }
  },
  { $unwind: '$token0_info' }  // must unwrap the array to get a flat result
])
// result: { address: '0xAAA', token0_info: { symbol: 'PEPE', decimals: 18 } }
```

```sql
-- PostgreSQL JOIN
SELECT p.address, t.symbol, t.decimals
FROM pools p
JOIN tokens t ON p.token0 = t.address
-- result: flat row — { address: '0xAAA', symbol: 'PEPE', decimals: 18 }
-- no unwrapping, no pipeline, direct result
```

---

### Difference 1: No Foreign Key Enforcement in MongoDB

```javascript
// MongoDB: no error — inserts a pool referencing a token that does not exist
db.pools.insertOne({ address: '0xAAA', token0: '0xFAKE' })
// $lookup later returns an empty array — silent data corruption

// PostgreSQL: FK constraint blocks this at the database level
INSERT INTO pools (address, token0) VALUES ('0xAAA', '0xFAKE');
-- ERROR: insert or update on table "pools" violates foreign key constraint
-- "fk_pools_token0" DETAIL: Key (token0)=(0xFAKE) is not present in table "tokens"
```

PostgreSQL enforces data integrity at the storage layer. MongoDB trusts the application to be correct — when it is not, the database has no guard rail.

---

### Difference 2: Transactions Require Extra Setup in MongoDB

```javascript
// MongoDB without session — non-atomic
await pools.insertOne({ address: '0xAAA', token0: '0xPEPE' })
// server crashes here → pool exists, token does not → orphaned record
await tokens.insertOne({ address: '0xPEPE', symbol: 'PEPE' })

// MongoDB WITH session (v4.0+) — atomic, but requires explicit setup
const session = client.startSession()
await session.withTransaction(async () => {
  await pools.insertOne({ address: '0xAAA', token0: '0xPEPE' }, { session })
  await tokens.insertOne({ address: '0xPEPE', symbol: 'PEPE' }, { session })
})
await session.endSession()
```

```sql
-- PostgreSQL — transactions are on by default, no extra setup
BEGIN;
  INSERT INTO pools (address, token0) VALUES ('0xAAA', '0xPEPE');
  INSERT INTO tokens (address, symbol) VALUES ('0xPEPE', 'PEPE');
COMMIT;
-- if crash between the two inserts → full rollback automatically
```

---

### Difference 3: Join Performance and Query Planning

```
MongoDB $lookup execution:
  For each document in pools → scan tokens collection for matching address
  Strategy: nested loop (always, unless indexed)
  With index on tokens.address: O(N log M)
  Without index: O(N × M) — full collection scan per pool document

PostgreSQL JOIN execution strategies (chosen automatically by query planner):
  Hash Join   → builds in-memory hash table of smaller table, probes with larger
                best for large unsorted datasets
  Index Scan  → uses B-tree index on join column
                best for small result sets
  Merge Join  → both sides sorted on join key, single pass through both
                best for large sorted datasets

PostgreSQL's query planner picks the optimal strategy per query.
MongoDB's aggregation pipeline always uses nested loop unless manually hinted.
```

At small scale (< 10K documents) the difference is invisible. At 100K+ rows, PostgreSQL's join optimizer is measurably faster for multi-table queries.

---

### Difference 4: Multi-level Joins

```javascript
// MongoDB: join pools → token0 → token0 price history
// Requires two $lookup stages — verbose and hard to optimize
db.pools.aggregate([
  { $lookup: { from: 'tokens', localField: 'token0', foreignField: 'address', as: 't0' } },
  { $unwind: '$t0' },
  { $lookup: { from: 'price_history', localField: 't0.address', foreignField: 'token', as: 'prices' } },
  { $unwind: '$prices' }
])
```

```sql
-- PostgreSQL: clean multi-table join in one statement
SELECT p.address, t.symbol, ph.price, ph.timestamp
FROM pools p
JOIN tokens t        ON p.token0     = t.address
JOIN price_history ph ON t.address   = ph.token
WHERE p.address = '0xAAA'
ORDER BY ph.timestamp DESC
LIMIT 100
```

---

### Summary: MongoDB Join vs PostgreSQL Join

| | PostgreSQL JOIN | MongoDB $lookup |
|---|---|---|
| Syntax | Clean, flat result | Aggregation pipeline, nested array |
| FK enforcement | Yes — database blocks invalid references | No — application must enforce |
| Transactions | Default, zero setup | Requires explicit session (v4+) |
| Join strategy | Auto-optimized (hash/merge/index) | Nested loop (manual optimization needed) |
| Multi-level joins | Natural SQL chain | Multiple pipeline stages, verbose |
| Performance at scale | Optimized, mature planner | Slower without careful indexing |

### When to still choose MongoDB despite needing joins

```
Use MongoDB if ALL of these are true:
  ✓ Joins are rare (< 10% of queries)
  ✓ Most data is read as a single document
  ✓ Schema varies significantly between documents
  ✓ You embed related data inside the document (avoiding $lookup entirely)

Use PostgreSQL if:
  ✓ Joins are common
  ✓ Data integrity matters (FK constraints)
  ✓ Multiple services write to the same data (transactions needed)
  ✓ Schema is stable
```

In the DEX scanner, pools reference tokens by address — that is a join by definition. PostgreSQL is the correct choice. If you used MongoDB, you would either embed the full token data inside every pool document (duplication) or use `$lookup` on every API request (slower than a JOIN with no FK safety net).
