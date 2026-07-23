# Database Optimization Techniques

---

## 1. Indexing

| Technique | Real problem it solves |
|---|---|
| B-tree index on `WHERE` column | Full table scan on large table |
| Composite index `(a, b)` | Queries filtering on `a` and sorting/ranging on `b` |
| Partial index `WHERE status = 'pending'` | 95% of rows are irrelevant — index only the hot subset |
| Covering index `INCLUDE (col1, col2)` | Heap fetch after index lookup — eliminates second disk read |
| Expression index `LOWER(email)` | Case-insensitive lookups not using index |
| BRIN index on `block_number` | Sequential monotonic columns — tiny index, fast range scan |

---

## 2. Query Optimization

| Technique | Real problem it solves |
|---|---|
| `EXPLAIN ANALYZE` | Blind optimization — find Seq Scans, bad row estimates |
| Avoid `SELECT *` | Fetching unused columns, blocking covering index usage |
| `EXISTS` instead of `COUNT > 0` | Counting all rows just to check existence |
| Avoid functions on indexed columns in `WHERE` | `WHERE YEAR(created_at) = 2025` kills the index |
| Keyset pagination `WHERE id > last` | `OFFSET 10000` scans and discards 10K rows every page |
| Batch `INSERT` / `COPY` | Inserting one row at a time — 100x slower than bulk |
| `UPDATE` only changed columns | Unnecessary index rebuilds on unchanged indexed columns |

---

## 3. N+1 Query Problem

```
Bad:  1 query to get 100 orders + 100 queries for each user = 101 queries
Good: 1 query with JOIN or IN clause                        = 1 query
```

Fix with eager loading (`include` in Prisma/TypeORM) or `WHERE id IN (...)`.

---

## 4. Connection Management

| Technique | Real problem it solves |
|---|---|
| Connection pooling (PgBouncer) | Each request opens a new DB connection — expensive handshake |
| Limit pool size | Too many connections starve PostgreSQL (~5–10MB RAM per connection) |
| Persistent connections in NestJS | Recreating connection on every request |

---

## 5. Caching

| Technique | Real problem it solves |
|---|---|
| Redis for hot reads | Same expensive query run thousands of times per second |
| Materialized view | Expensive aggregation computed on every request |
| `REFRESH MATERIALIZED VIEW CONCURRENTLY` | Non-concurrent refresh blocks reads |
| In-memory cache | Redis round trip still too slow for ultra-hot data |

---

## 6. Schema Design

| Technique | Real problem it solves |
|---|---|
| Use `INT`/`BIGINT` for IDs, not `VARCHAR` | String comparison for IDs — slower index, larger storage |
| `TIMESTAMPTZ` for dates, not `VARCHAR` | Cannot do range queries or sort on string dates |
| Avoid `NULL` on indexed columns | Increases index size, complicates queries |
| Denormalize for read-heavy paths | Too many JOINs on hot read path |
| `JSONB` for variable attributes | Hundreds of sparse columns, mostly NULL |

---

## 7. Partitioning

See `database-partitioning.md` for full coverage of both types.

| Type | Technique | Real problem it solves |
|---|---|---|
| Horizontal | Range partition by time | Querying old data forces scan of entire table |
| Horizontal | Drop old partition (`DROP TABLE`) | `DELETE` on millions of rows — partition drop is instant |
| Vertical | Split wide table by access pattern | Every query loads unused columns — wasted I/O and cache |
| Vertical | Normalize to 3NF | Redundant data causes update anomalies |

---

## 8. Write Optimization

| Technique | Real problem it solves |
|---|---|
| Async / fire-and-forget writes | Non-critical writes (logs) blocking the request |
| Write to Kafka, consume to DB | DB cannot keep up with ingest rate |
| `ON CONFLICT DO NOTHING` (upsert) | Check-then-insert race condition |
| Disable indexes during bulk load, rebuild after | Index maintenance cost per row during large imports |
| `UNLOGGED TABLE` for temp data | WAL overhead on data that doesn't need durability |

---

## 9. Read Scaling

| Technique | Real problem it solves |
|---|---|
| Read replicas | All reads hitting the primary — write and read compete for I/O |
| CQRS (separate read/write models) | Same schema can't serve fast writes and complex reads |
| ClickHouse for analytics | PostgreSQL too slow for aggregations on 100M+ rows |
| TimescaleDB for time-series | PostgreSQL index degrades on large time-series tables |

---

## 10. Maintenance (PostgreSQL)

| Technique | Real problem it solves |
|---|---|
| `VACUUM` / `AUTOVACUUM` | Dead tuples from `UPDATE`/`DELETE` bloating tables and indexes |
| `ANALYZE` | Stale statistics causing planner to pick wrong index |
| `REINDEX CONCURRENTLY` | Index bloat after heavy writes |
| `pg_stat_user_indexes` — find unused indexes | Indexes with `idx_scan = 0` cost write performance with zero read benefit |

---

## Decision flowchart for a slow query

```
Query is slow
    │
    ├── EXPLAIN ANALYZE → Seq Scan on large table?
    │       └── Add index on WHERE / JOIN / ORDER BY column
    │
    ├── Index exists but not used?
    │       ├── Low cardinality? → Consider partial index
    │       ├── Function on column? → Add expression index
    │       └── Stale stats? → Run ANALYZE
    │
    ├── Query is fast but called 100x per request?
    │       └── N+1 problem → eager load / batch query
    │
    ├── Same query runs thousands of times/sec?
    │       └── Cache in Redis or materialized view
    │
    └── Table has 100M+ rows?
            ├── Add partitioning by time range
            └── Consider ClickHouse for analytics workload
```
