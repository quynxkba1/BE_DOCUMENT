# ClickHouse vs NoSQL Databases

---

## Overview

NoSQL is not one thing — it is four different storage models, each built for a different problem. ClickHouse competes with some of them and complements others.

```
NoSQL umbrella:
  ┌─────────────────┬──────────────────┬─────────────────┬──────────────────┐
  │  Key-Value      │  Document        │  Wide-Column     │  Search Engine   │
  │  Redis          │  MongoDB         │  Cassandra       │  Elasticsearch   │
  │  (in-memory)    │  (JSON docs)     │  (time-series)   │  (inverted index)│
  └─────────────────┴──────────────────┴─────────────────┴──────────────────┘
```

---

## 1. ClickHouse vs MongoDB (Document Store)

### How MongoDB Stores Data

```
MongoDB (BSON document, row-oriented):
Collection: swap_events
  { tx_hash: "0xABC", pool: "0xAAA", price: 1842.50, amount: 1000, timestamp: ... }
  { tx_hash: "0xDEF", pool: "0xBBB", price: 1843.10, amount: 2000, timestamp: ... }
  { tx_hash: "0xGHI", pool: "0xAAA", price: 1841.90, amount: 500,  timestamp: ... }

Each document is stored whole on disk — same as PostgreSQL rows.
Reading any field requires reading the entire document.
```

### Query Comparison on 100M Swap Events

```
Query: average price per pool over last 24h

MongoDB:
  db.swap_events.aggregate([
    { $match: { timestamp: { $gt: yesterday } } },
    { $group: { _id: "$pool", avg_price: { $avg: "$price" } } }
  ])
  → reads EVERY field of EVERY document (tx_hash, amount, wallet...)
  → even though you only need pool + price + timestamp
  → time: 45–120 seconds on 100M docs

ClickHouse:
  SELECT pool_address, avg(price)
  FROM swap_events
  WHERE timestamp > now() - INTERVAL 24 HOUR
  GROUP BY pool_address
  → reads ONLY price, pool_address, timestamp columns
  → skips irrelevant blocks via sparse index
  → time: 50–200ms on 100M rows
```

### Feature Comparison

| | MongoDB | ClickHouse |
|---|---|---|
| **Storage model** | Document (BSON, row-oriented) | Columnar |
| **Schema** | Flexible (schemaless) | Fixed schema required |
| **INSERT single doc** | Fast, native | Slow (creates tiny part) |
| **INSERT batch** | Good | Excellent |
| **Aggregation speed** | Slow on billions of docs | Milliseconds |
| **Full-text search** | Built-in ($text, Atlas Search) | None |
| **Nested/array fields** | Native | Limited (Nested type) |
| **Transactions** | Multi-doc ACID (v4.0+) | None |
| **UPDATE/DELETE** | Native, fast | Expensive, avoid |
| **Joins** | `$lookup` (slow at scale) | Limited |
| **Horizontal scaling** | Sharding built-in | Sharding built-in |
| **Compression** | ~3x (WiredTiger) | ~10x |
| **Max practical scale** | ~100M docs | 100B+ rows |

### When MongoDB Wins

```
✓ You need flexible/dynamic schemas (fields vary per document)
✓ You need full-text search on document content
✓ You have nested arrays/objects that you query into
✓ You need to UPDATE individual documents frequently
  db.swap_events.updateOne({ tx_hash: '0xABC' }, { $set: { finalized: true } })
✓ Data volume is < 50M documents (aggregations are tolerable)
```

### When ClickHouse Wins

```
✓ You do analytical queries over hundreds of millions of rows
✓ Your data is append-only (events, logs — never updated)
✓ You need time-series aggregations (OHLCV, volume charts)
✓ Storage cost matters (ClickHouse stores 3x less data than MongoDB)
✓ Query speed is critical (200ms vs 120s on 1B rows)
```

### In the DEX Scanner

```
MongoDB could work for:  pool metadata, token info (flexible schema, low volume)
MongoDB would fail for:  swap_events analytics (too slow at 5B rows)
ClickHouse is used for:  swap_events (append-only, aggregate-heavy, 5B rows)
```

---

## 2. ClickHouse vs Redis (Key-Value / In-Memory)

### How Redis Stores Data

```
Redis (in-memory key-value):
  pair:0xAAA:price  → "1842.50"    (String)
  pair:0xAAA:time   → "1720082400" (String)
  pair:0xBBB:price  → "0.00043"    (String)

Data lives entirely in RAM.
No disk I/O. Sub-millisecond reads.
No aggregation. No query language. Just GET/SET.
```

### These Two Are NOT Competitors

They solve completely different problems:

| | Redis | ClickHouse |
|---|---|---|
| **Storage** | In-memory (RAM) | On-disk (SSD) |
| **Read speed** | < 0.1ms | 5–50ms |
| **Data capacity** | Limited by RAM (GBs) | Limited by disk (TBs+) |
| **Aggregation** | None | Core strength |
| **Query language** | GET/SET commands | Full SQL |
| **Data persistence** | Optional (AOF/RDB) | Always |
| **TTL / expiry** | Built-in per key | Via TTL clause |
| **Use case** | Cache, sessions, pub/sub | Analytics, time-series |
| **Cost per GB** | High (RAM is expensive) | Low (disk is cheap) |

### How They Work Together in the DEX Scanner

```
swap event arrives from blockchain
    │
    ├──→ RedisWriterConsumer
    │      SET pair:0xAAA:price 1842.50   ← latest price only, < 0.1ms reads
    │                                        trader checks this 1000x/sec
    │
    └──→ ClickhouseWriterConsumer
           INSERT INTO swap_events ...    ← full history + analytics
                                            chart loads this once per page view
```

Redis holds the **hot path** (what is the price RIGHT NOW).
ClickHouse holds the **cold path** (what happened OVER TIME).

```
GET /price/:pool       → Redis      < 0.1ms  (never hits ClickHouse)
GET /chart/:pool?1h    → ClickHouse  5–20ms  (aggregated OHLCV)
GET /trades/:pool      → ClickHouse 10–50ms  (raw tick history)
```

**Rule:** Redis = cache layer. ClickHouse = analytics layer. Never replace one with the other.

---

## 3. ClickHouse vs Cassandra (Wide-Column Store)

### How Cassandra Stores Data

```
Cassandra (wide-column, distributed):
  Partition key:  pool_address
  Clustering key: timestamp (DESC)

  Partition 0xAAA:
    [ts: 1720000002, price: 1841.90, amount: 500]
    [ts: 1720000001, price: 1842.51, amount: 200]
    [ts: 1720000000, price: 1842.50, amount: 1000]

  Partition 0xBBB:
    [ts: 1720000001, price: 0.00044, amount: 9000]
    [ts: 1720000000, price: 0.00043, amount: 5000]
```

Cassandra looks like a column store but is NOT the same as ClickHouse.
It groups rows by partition key — rows within a partition are still stored together.
It is optimised for: **write throughput + reads by a single known partition key**.

### The Critical Difference

```
Cassandra excels at:

  SELECT * FROM swap_events
  WHERE pool_address = '0xAAA'
  ORDER BY timestamp DESC LIMIT 100
  → reads one partition → fast (< 5ms)

Cassandra fails at:

  SELECT avg(price) FROM swap_events
  WHERE timestamp > now() - INTERVAL 24 HOUR
  → must read ALL partitions across ALL nodes
  → no aggregation pushdown
  → time: minutes on 1B rows

ClickHouse handles both:

  -- Point read (OK):
  SELECT * FROM swap_events
  WHERE pool_address = '0xAAA'
  ORDER BY timestamp DESC LIMIT 100
  → sparse index finds the block → fast enough (10–50ms)

  -- Aggregate (excellent):
  SELECT avg(price) FROM swap_events
  WHERE timestamp > now() - INTERVAL 24 HOUR
  → columnar scan + vectorized execution → 50–200ms on 1B rows
```

### Feature Comparison

| | Cassandra | ClickHouse |
|---|---|---|
| **Write throughput** | 1M+ writes/sec (distributed) | 500K–1M/sec (single node) |
| **Read by partition key** | Sub-ms | 10–50ms |
| **Aggregation queries** | Very slow (no pushdown) | Milliseconds |
| **Horizontal scale writes** | Masterless, elastic | Master + shards |
| **Consistency** | Tunable (eventual → strong) | Eventual |
| **Schema changes** | ALTER TABLE is online | ADD COLUMN instant; others slow |
| **SQL support** | CQL (limited, no aggregations) | Full SQL + extensions |
| **OHLCV chart query** | Impossible natively | 5ms with Materialized View |
| **Cross-partition analytics** | Extremely slow | Core strength |
| **Operational complexity** | High (tuning, compaction) | Medium |

### When Cassandra Wins

```
✓ You need millions of writes/sec across many nodes
  (Cassandra scales writes linearly — add nodes, get more throughput)
✓ You need masterless architecture — no single point of failure on writes
✓ Your reads are ALWAYS by a known partition key
  "get all swaps for pool 0xAAA" — you always know the pool upfront
✓ You need strong geo-distributed multi-region replication
✓ Your analytics are handled by a separate system (Spark, ClickHouse)
```

### When ClickHouse Wins

```
✓ You need aggregations (SUM, AVG, GROUP BY, OHLCV)
  — Cassandra fundamentally cannot do this efficiently
✓ You need ad-hoc analytics — Cassandra forces you to model queries upfront
✓ You need SQL — Cassandra's CQL is very limited
✓ You need Materialized Views that auto-aggregate on insert
✓ Write throughput at 2000 TPS is well within ClickHouse capacity
```

### In the DEX Scanner

```
Cassandra could work for:  raw event storage (high write throughput, lookup by pool)
Cassandra would fail for:  OHLCV charts, volume rankings, cross-pool analytics

ClickHouse handles both:
  write throughput at 2000 TPS → trivial for ClickHouse
  + full SQL analytics → no need for a second system
```

At 2000 TPS (2000 rows/sec), ClickHouse easily handles both ingest and analytics on a single node. Cassandra is overkill for write throughput here — it shines at 100,000+ writes/sec where you need to scale writes across 10+ nodes.

---

## 4. ClickHouse vs Elasticsearch (Search Engine)

### How Elasticsearch Stores Data

```
Elasticsearch (inverted index):
  Document: { tx_hash: "0xABC", pool: "0xAAA", price: 1842.50, wallet: "0xWALLET1" }

  Inverted index built on every field:
    "0xAAA"     → [doc1, doc3, doc7, ...]
    "0xWALLET1" → [doc1, doc9, ...]
    "1842"      → [doc1, doc4, ...]

  Great for: "find all documents containing 0xAAA"
  Bad for:   "average price across all documents"
```

Elasticsearch is built for **search** (find documents matching a query), not for **aggregation** (compute statistics over many documents). Both look like analytics from the outside but use completely different internal machinery.

### Feature Comparison

| | Elasticsearch | ClickHouse |
|---|---|---|
| **Storage model** | Inverted index (row-based) | Columnar |
| **Full-text search** | Excellent (core strength) | None |
| **Fuzzy / wildcard search** | Native | None |
| **Aggregation speed** | Slow on billions (10–30s) | Milliseconds |
| **INSERT throughput** | ~100K docs/sec | 500K–1M rows/sec |
| **Storage cost** | High (~5x raw data) | Low (~0.1x with compression) |
| **SQL** | Query DSL (JSON) | Full SQL |
| **Time-series analytics** | Kibana/TSVB (slow at scale) | Native, milliseconds |
| **Ecosystem** | ELK Stack (Logstash, Kibana) | Grafana, ClickHouse Cloud |
| **Operational complexity** | High (JVM heap, shard tuning) | Medium |
| **Cost at 1B rows** | ~$2000+/mo (storage alone) | ~$200–400/mo |

### Query Comparison on 1B Swap Events

```
Query: 24h OHLCV candles for pool 0xAAA

Elasticsearch:
  POST /swap_events/_search
  {
    "query": { "term": { "pool": "0xAAA" } },
    "aggs": {
      "by_minute": {
        "date_histogram": { "field": "timestamp", "fixed_interval": "1m" },
        "aggs": {
          "avg_price": { "avg": { "field": "price" } },
          "volume": { "sum": { "field": "amount_in" } }
        }
      }
    }
  }
  → reads documents row by row, aggregates in memory
  → time: 10–30s on 1B docs
  → memory: requires large JVM heap

ClickHouse:
  SELECT toStartOfMinute(timestamp) AS minute,
         avg(price), sum(amount_in)
  FROM swap_events
  WHERE pool_address = '0xAAA'
    AND timestamp > now() - INTERVAL 24 HOUR
  GROUP BY minute ORDER BY minute
  → columnar scan, vectorized aggregation
  → time: 5–20ms on 1B rows
  → memory: minimal (streams data from disk)
```

### When Elasticsearch Wins

```
✓ Full-text search: "find all pools where token description contains 'meme'"
✓ Fuzzy matching: "find wallet address similar to 0xABCD..."
✓ Relevance scoring: rank results by how well they match a search query
✓ Log analysis with unstructured text fields
✓ You're already in the ELK stack (Logstash → Elasticsearch → Kibana)
```

### When ClickHouse Wins

```
✓ Numeric aggregations (avg, sum, count, quantile) at scale
✓ Storage cost matters — ES stores 5x raw data, ClickHouse stores 0.1x
✓ Time-series OHLCV charts — ClickHouse is 100–1000x faster
✓ SQL-native access — ES query DSL is verbose and hard to write
✓ High ingest rate — ClickHouse ingests 5–10x more rows/sec than ES
```

### In the DEX Scanner

```
Elasticsearch could work for: searching pool names, token metadata, wallet labels
Elasticsearch would fail for: swap event analytics (too slow, too expensive to store)

In production, teams often run BOTH:
  Elasticsearch → "find pools with PEPE in the name" (search / discovery)
  ClickHouse    → "show me OHLCV for the top 10 PEPE pools" (analytics)
```

---

## 5. Full Comparison Summary

| | Redis | MongoDB | Cassandra | Elasticsearch | ClickHouse |
|---|---|---|---|---|---|
| **Storage model** | In-memory KV | Document | Wide-column | Inverted index | Columnar |
| **Write speed** | Fastest | Good | Excellent | Medium | Good (batch) |
| **Point read speed** | < 0.1ms | ~1ms | ~1ms | ~5ms | ~50ms |
| **Aggregate query** | None | Slow (45–120s) | Very slow | Slow (10–30s) | Fastest (50ms) |
| **Full-text search** | None | Basic | None | Best | None |
| **SQL** | No | No | CQL (limited) | Query DSL | Full SQL |
| **Transactions** | Lua scripts | ACID (v4+) | Lightweight | None | None |
| **UPDATE/DELETE** | Native | Native | Native | Native | Expensive |
| **Horizontal scale** | Cluster | Sharding | Masterless | Sharding | Sharding |
| **Storage efficiency** | Low (RAM) | ~3x | ~2x | ~5x | ~10x |
| **Best for** | Cache / pub-sub | Flexible docs | High-write TS | Search | Analytics |
| **Worst for** | Analytics | Aggregations | Cross-partition | High-vol ingest | Point reads |

---

## 6. In the DEX Scanner — Who Does What

```
Layer 1 — Redis (hot path)
  → latest price per pool
  → SET pair:0xAAA:price 1842.50
  → read latency: < 0.1ms
  → used by: price ticker API (1000 req/sec)

Layer 2 — ClickHouse (analytics)
  → full swap event history
  → OHLCV charts, volume rankings, wallet analytics
  → read latency: 5–100ms
  → used by: chart API, analytics dashboard

Layer 3 — PostgreSQL (relational)
  → pool metadata, token info, user accounts
  → data that needs UPDATE, JOIN, transactions
  → read latency: 1–10ms
  → used by: pool detail page, user profiles

Optional — Elasticsearch
  → search pools/tokens by name
  → label and tag wallets
  → used by: search bar, explorer UI
```

**The key insight:** these databases are not alternatives — they are layers. Each handles the queries it was designed for. A production DEX scanner uses Redis + PostgreSQL + ClickHouse together.

```
Never use ClickHouse for:    current price (use Redis)
Never use Redis for:         historical charts (use ClickHouse)
Never use PostgreSQL for:    5B row aggregations (use ClickHouse)
Never use ClickHouse for:    single-row UPDATE (use PostgreSQL)
Never use Elasticsearch for: numeric analytics (use ClickHouse)
Never use ClickHouse for:    full-text search (use Elasticsearch)
```

---

## 7. Interview Questions

**Q: What is the difference between Cassandra and ClickHouse — aren't they both column stores?**

> Cassandra is a wide-column store, meaning it groups columns by partition key but rows within a partition are still stored together. ClickHouse is a true columnar store where each column is stored in a separate file. The difference is critical: Cassandra excels at reading all columns for a specific partition key (one pool's swaps), while ClickHouse excels at reading one column across all partitions (average price across all pools). Cassandra cannot efficiently aggregate across partition boundaries — ClickHouse is built for exactly that.

**Q: Why not just use MongoDB instead of ClickHouse for swap events?**

> MongoDB stores documents row by row. For a query like `avg(price) over 100M rows`, MongoDB must read every field of every document — tx_hash, wallet, amount, etc. — even though you only need price. ClickHouse stores price in its own column file and reads only that. At 100M rows, MongoDB takes 45–120 seconds; ClickHouse takes 50–200ms. MongoDB also stores 3x more data than ClickHouse due to worse compression on mixed-type rows.

**Q: If Redis is already in the project for latest prices, why do we still need ClickHouse?**

> Redis and ClickHouse serve completely different purposes. Redis holds the current state — what the price is right now — in RAM for sub-millisecond reads. ClickHouse holds the history — every swap that ever happened — on disk for analytical queries. You cannot ask Redis "what was the average price last Tuesday between 2pm and 4pm?" — it has no query language and no persistent history. You cannot use ClickHouse for current price — it's too slow (50ms vs 0.1ms) and designed for batch reads, not single-key lookups.

**Q: When would you choose Elasticsearch over ClickHouse for a DEX project?**

> If you need full-text search — finding pools by token name, labelling wallets, or building a search bar for the explorer UI. Elasticsearch maintains an inverted index optimised for finding documents that match text queries. ClickHouse has no text search capability. In practice, production DEX scanners often run both: Elasticsearch for search and discovery, ClickHouse for analytics and charting.
