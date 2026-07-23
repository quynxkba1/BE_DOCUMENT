# Database Optimization for DEX Scanner

---

## The Problem Space

The DEX scanner has two very different performance problems:

```
PostgreSQL problem → low volume, but queries must be fast for API responses
ClickHouse problem → billions of rows, but already solved by columnar storage

This file focuses on PostgreSQL optimization and whether NoSQL replaces it.
```

PostgreSQL in this stack stores:
```sql
tokens  → ~10K rows    (one per ERC-20 token)
pools   → ~100K rows   (one per trading pair)
users   → ~1M rows max (wallets that have interacted)
```

These are small tables. The optimization goal is **query speed and connection efficiency**, not storage scale.

---

## 1. Index Optimization

### What PostgreSQL queries look like in a DEX scanner API

```sql
-- GET /pool/:address — single row lookup
SELECT * FROM pools WHERE address = '0xAAA111';

-- GET /pools?token=USDC — find all pools containing a token
SELECT * FROM pools WHERE token0 = '0xUSDC' OR token1 = '0xUSDC';

-- GET /token/:address — single row lookup
SELECT * FROM tokens WHERE address = '0xUSDC';

-- GET /pools/top — pools with highest activity (joined with ClickHouse result)
SELECT p.address, p.fee_tier, t0.symbol, t1.symbol
FROM pools p
JOIN tokens t0 ON p.token0 = t0.address
JOIN tokens t1 ON p.token1 = t1.address
WHERE p.address = ANY('{0xAAA, 0xBBB, 0xCCC}');
```

### Default indexes (what you get for free)

```sql
-- PostgreSQL auto-creates B-tree indexes on PRIMARY KEY and UNIQUE columns
CREATE TABLE pools (
  address VARCHAR(42) PRIMARY KEY,  ← auto-indexed
  token0  VARCHAR(42) REFERENCES tokens(address),  ← NOT indexed by default
  token1  VARCHAR(42) REFERENCES tokens(address),  ← NOT indexed by default
  fee_tier INT
);
```

`WHERE address = '0xAAA'` → fast (primary key index).
`WHERE token0 = '0xUSDC'` → **slow full table scan** without explicit index.

### Add the missing indexes

```sql
-- Find all pools containing a specific token
CREATE INDEX idx_pools_token0 ON pools(token0);
CREATE INDEX idx_pools_token1 ON pools(token1);

-- Combined: WHERE token0 = 'X' OR token1 = 'X'
-- PostgreSQL can bitmap-OR the two indexes — no extra index needed

-- If you filter pools by fee tier often
CREATE INDEX idx_pools_fee_tier ON pools(fee_tier);

-- Partial index: only active pools (if you soft-delete)
CREATE INDEX idx_pools_active ON pools(address) WHERE is_active = true;
-- → index is tiny, only covers rows you actually query
```

### How to check if your queries use indexes

```sql
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM pools WHERE token0 = '0xUSDC';

-- Look for:
-- "Index Scan" or "Index Only Scan" → good, using index
-- "Seq Scan"                        → bad, full table scan
-- "Rows Removed by Filter: 99000"   → index not selective enough

-- Buffers output:
-- "Buffers: shared hit=3"    → served from memory cache (fast)
-- "Buffers: shared read=500" → read from disk (slow, but first run only)
```

### Index size vs query speed trade-off

```
Table: pools (100K rows)
  No indexes on token0/token1
    → WHERE token0 = 'X': full scan, reads 100K rows, ~5ms
    → with B-tree index: reads ~10 rows, ~0.05ms

At 100K rows PostgreSQL is fast either way.
At 10M rows the difference is 10ms vs 0.05ms — use indexes.

Index cost:
  → Slightly slower INSERTs (index must be updated)
  → Extra disk space (small at these volumes)
  → Worth it for any column that appears in WHERE clauses
```

---

## 2. Connection Pooling

### The problem

Each NestJS request opens a PostgreSQL connection. PostgreSQL handles connections by forking a process per connection — expensive.

```
NestJS API (100 concurrent requests)
  → 100 PostgreSQL connections
  → 100 forked processes on the DB server
  → memory pressure, context switching → slow

PostgreSQL default max_connections = 100
→ 101st request gets "too many connections" error
```

### Solution A: PgBouncer (production)

PgBouncer sits between your app and PostgreSQL, pooling connections:

```
100 NestJS requests
    ↓
PgBouncer (10 persistent connections to PostgreSQL)
    ↓
PostgreSQL (sees only 10 connections, not 100)
```

```yaml
# Add to docker-compose
pgbouncer:
  image: pgbouncer/pgbouncer:latest
  environment:
    DATABASES_HOST: postgres
    DATABASES_PORT: 5432
    DATABASES_DBNAME: dex_scanner
    PGBOUNCER_POOL_MODE: transaction   # one connection per transaction, not per session
    PGBOUNCER_MAX_CLIENT_CONN: 1000    # NestJS can open 1000 connections to PgBouncer
    PGBOUNCER_DEFAULT_POOL_SIZE: 20    # but PgBouncer only keeps 20 to PostgreSQL
  ports:
    - '6432:5432'
```

### Solution B: TypeORM / Prisma built-in pool (dev)

```typescript
// TypeORM connection pool
TypeOrmModule.forRoot({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'dex_scanner',
  extra: {
    max: 20,      // max 20 connections in pool
    min: 2,       // keep 2 warm
    idleTimeoutMillis: 30000,
  },
})

// Prisma connection pool
// Set in DATABASE_URL: postgres://user:pass@host:5432/db?connection_limit=20
```

### Pool size rule of thumb

```
optimal pool size ≈ (CPU cores × 2) + disk spindles

DEX scanner API server (4 core):
  → pool size = (4 × 2) + 1 = ~10 connections

More connections ≠ faster. Beyond this, they queue behind each other.
```

---

## 3. N+1 Query Problem

### What it is

The most common performance bug in APIs that join PostgreSQL + ClickHouse data.

```typescript
// BAD: N+1 queries
const topPools = await clickhouse.query('SELECT pool_address, volume FROM ohlcv_1m LIMIT 10')
// → returns 10 pool addresses

for (const row of topPools) {
  // This runs 10 separate PostgreSQL queries instead of 1
  const pool = await db.query('SELECT * FROM pools WHERE address = $1', [row.pool_address])
  results.push({ ...pool, volume: row.volume })
}
// Total: 11 queries (1 ClickHouse + 10 PostgreSQL)
```

```typescript
// GOOD: 1+1 queries
const topPools = await clickhouse.query('SELECT pool_address, volume FROM ohlcv_1m LIMIT 10')
const addresses = topPools.map(r => r.pool_address)

// One PostgreSQL query for all pools at once
const pools = await db.query(
  'SELECT * FROM pools WHERE address = ANY($1)',
  [addresses]
)
// Total: 2 queries (1 ClickHouse + 1 PostgreSQL)
```

### In a DEX scanner this matters because

Every chart page request likely does:
```
1. ClickHouse → get top 20 pools by volume
2. PostgreSQL → get token symbols for those 20 pools
3. Redis      → get current prices for those 20 pools

Step 2 is N+1 risk: 1 query vs 20 queries
```

---

## 4. Query Caching with Redis

PostgreSQL metadata (tokens, pool info) barely changes. Cache it in Redis.

```typescript
async getPool(address: string): Promise<Pool> {
  const cacheKey = `pool:${address}`

  // Check Redis first
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  // Miss → hit PostgreSQL
  const pool = await db.query('SELECT * FROM pools WHERE address = $1', [address])

  // Cache for 5 minutes (pool metadata rarely changes)
  await redis.setex(cacheKey, 300, JSON.stringify(pool))
  return pool
}
```

```
First request:  Redis miss → PostgreSQL → cache → return  (~5ms)
All subsequent: Redis hit  → return                       (~0.3ms)

Pool metadata changes maybe once per day (new fee tier, deactivated pool).
Cache it aggressively.
```

---

## 5. Read Replicas

At scale, separate read traffic from write traffic:

```
Writes (new pool, update pool status) → Primary PostgreSQL
Reads  (API queries)                  → Read Replica

                  ┌─────────────────┐
NestJS API ──────►│  Read Replica   │← streaming replication from primary
                  └─────────────────┘
                          ↑ async replication (lag ~10ms)
                  ┌─────────────────┐
Scanner ─────────►│ Primary         │
                  └─────────────────┘
```

In TypeORM:
```typescript
TypeOrmModule.forRoot({
  replication: {
    master: { host: 'primary-db', port: 5432 },
    slaves: [{ host: 'replica-db', port: 5432 }],
  },
})
// Reads automatically route to replica, writes go to primary
```

When to add replicas: when primary CPU is > 70% from read queries. For the DEX scanner metadata tables (10K–100K rows), you likely never need this.

---

## 6. JSONB for Flexible Token Metadata

Some tokens have extra metadata that doesn't fit a fixed schema (social links, audit status, creator info):

```sql
-- BAD: adding columns for every possible attribute
ALTER TABLE tokens ADD COLUMN twitter VARCHAR(100);
ALTER TABLE tokens ADD COLUMN telegram VARCHAR(100);
ALTER TABLE tokens ADD COLUMN audit_score INT;
-- → schema changes for every new attribute, most rows have NULLs

-- GOOD: JSONB column for flexible extra data
CREATE TABLE tokens (
  address   VARCHAR(42) PRIMARY KEY,
  symbol    VARCHAR(20),
  decimals  INT,
  metadata  JSONB DEFAULT '{}'   -- flexible attributes here
);

INSERT INTO tokens VALUES (
  '0xAAA', 'PEPE', 18,
  '{"twitter": "@pepecoin", "audit": "certik", "score": 85}'
);

-- Query inside JSONB (uses GIN index):
SELECT * FROM tokens WHERE metadata->>'audit' = 'certik';
SELECT * FROM tokens WHERE (metadata->>'score')::int > 80;

-- GIN index on JSONB for fast queries:
CREATE INDEX idx_tokens_metadata ON tokens USING GIN(metadata);
```

This gives you MongoDB-like flexibility without leaving PostgreSQL.

---

## 7. Should You Migrate PostgreSQL to NoSQL?

### Short answer: No.

The DEX scanner already uses NoSQL where it matters:

```
Redis    → key-value store for latest prices     ← already NoSQL
ClickHouse → column store for event analytics    ← already NoSQL-adjacent

PostgreSQL holds: tokens (10K rows), pools (100K rows)
These are tiny. PostgreSQL handles them trivially.
```

### When teams actually migrate PostgreSQL → NoSQL

| Scenario | Migrates to | Reason |
|---|---|---|
| User profiles with wildly different shapes | MongoDB | Schema-less documents |
| Session store for millions of active users | Redis | Sub-ms key-value |
| Full-text search on descriptions | Elasticsearch | Inverted index |
| Time-series sensor data (IoT) | InfluxDB | Optimized for metrics |
| Billions of pool/token rows with no joins | Cassandra | Horizontal write scale |

None of these scenarios apply to pool metadata in a DEX scanner.

### What the real problems are (and their actual fixes)

| Symptom | Wrong fix | Right fix |
|---|---|---|
| Pool lookup is slow | Migrate to MongoDB | Add B-tree index on `address` |
| Too many connections | Migrate to NoSQL | Add PgBouncer or use connection pool |
| Joins are slow | Migrate to NoSQL | Fix N+1 queries, add indexes |
| Schema keeps changing | Migrate to MongoDB | Use JSONB column in PostgreSQL |
| 100M+ pool rows (hypothetical) | Migrate to Cassandra | This won't happen — pools are bounded |

### What you would lose by migrating to MongoDB

```sql
-- This query is trivial in PostgreSQL:
SELECT p.address, t0.symbol AS base, t1.symbol AS quote, p.fee_tier
FROM pools p
JOIN tokens t0 ON p.token0 = t0.address
JOIN tokens t1 ON p.token1 = t1.address
WHERE t0.symbol = 'PEPE'

-- In MongoDB you must:
-- 1. Query pools collection where token0 = 'PEPE address'
-- 2. For each result, separately query tokens collection for t0.symbol and t1.symbol
-- 3. Join in application code
-- = N+1 problem built into the database design
```

Foreign keys, joins, and transactions are exactly what PostgreSQL was built for. MongoDB would make this harder with zero benefit at 100K rows.

### The only valid argument for NoSQL here

If the DEX scanner becomes a multi-chain product indexing **every token on every chain**:

```
Ethereum:  500K tokens
BSC:       2M tokens
Solana:    10M tokens
Total:     ~15M tokens

At 15M rows with high write throughput (new tokens every second):
→ Still fine in PostgreSQL with proper indexes
→ Only consider Cassandra if write throughput exceeds ~50K/sec sustained
```

Even at 15M rows, PostgreSQL with proper indexes and PgBouncer handles this comfortably.

### Decision rule

```
"Should I replace PostgreSQL with NoSQL for this entity?"

Ask:
  Does it need joins?        Yes → stay in PostgreSQL
  Does it need transactions? Yes → stay in PostgreSQL
  Does it need UPDATE?       Yes → stay in PostgreSQL
  Is it < 100M rows?         Yes → stay in PostgreSQL
  All answers are No?        → Maybe consider NoSQL, but verify first
```

---

## 8. Full Optimization Checklist for This Project

```
PostgreSQL (tokens, pools):
  ☐ Add index on pools(token0), pools(token1)
  ☐ Add index on pools(fee_tier) if filtered often
  ☐ Use JSONB for flexible token metadata instead of ALTER TABLE
  ☐ Fix N+1: batch PostgreSQL lookups after ClickHouse queries
  ☐ Cache pool metadata in Redis (TTL 5min)
  ☐ Set connection pool size = (CPU cores × 2) + 1

ClickHouse (swap_events):
  ☐ Always batch inserts (1000 rows minimum)
  ☐ Use LowCardinality(String) for pool_address and source
  ☐ Add Materialized View for OHLCV (see clickhouse-deep-dive.md)
  ☐ Filter on leftmost ORDER BY column (pool_address) first
  ☐ Never query ClickHouse for latest price — use Redis

Redis:
  ☐ Store latest price per pool (sub-1ms reads)
  ☐ Store pool metadata cache (TTL 5min)
  ☐ Store scanner checkpoint (lastBlock per chainId)
  ☐ Set TTL on all keys to prevent unbounded memory growth
```

---

## Interview Q&A

**Q: How would you optimize PostgreSQL for a DEX scanner API?**

> Index the columns that appear in WHERE clauses — `token0`, `token1` on the pools table. Cache pool metadata in Redis since it rarely changes. Fix N+1 queries by batching PostgreSQL lookups. Use a connection pool (PgBouncer or TypeORM pool) so 1000 concurrent API requests don't exhaust the 100-connection limit. At these data volumes (10K–100K rows), proper indexes and caching solve every performance problem.

**Q: Would you migrate the PostgreSQL metadata store to MongoDB for flexibility?**

> No. PostgreSQL with a JSONB column gives you the same schema flexibility as MongoDB while keeping joins, foreign keys, and transactions. MongoDB's document model would make the `pools → tokens` join significantly harder for zero benefit at 100K rows. The DEX scanner already uses Redis and ClickHouse for the parts of the stack where NoSQL properties (key-value speed, columnar analytics) actually matter.

**Q: When would you actually choose NoSQL over PostgreSQL?**

> When the data has no relationships (pure key-value or documents with no joins), when you need sub-millisecond writes at millions per second (Cassandra), or when full-text search is the primary access pattern (Elasticsearch). In the DEX scanner, pool and token data is relational by nature — a pool is defined by its relationship to two tokens. Relational data belongs in a relational database.
