# Backend API Latency Optimization — Real Production Case Study

> Notes from a real-world case: an API serving ~1.5 million customers over a
> ~2 billion row MariaDB table went from slow to fast. Source:
> [viblo.asia](https://viblo.asia/p/toi-uu-hoa-hieu-suat-backend-bien-api-cham-thanh-sieu-toc-PAoJeOGNV1j)

---

## The problem

An API needed to serve daily aggregated customer data with month-over-month
comparisons. The backing table held roughly **2 billion rows**. Queries
were slow even with indexes already in place.

Server context: 64GB RAM (only ~41GB in use), 2TB disk (600GB used),
MariaDB 10.4.

## Root cause: storing more data than the business needs

The table held **4 years of history**, but the actual queries only ever
needed **2 years** (~1 billion rows). Half of everything being scanned was
dead weight the queries never touched. This is the single biggest lesson
of the whole case: before tuning indexes or hardware, check whether you're
scanning data you don't actually need to keep hot.

---

## Fix 1 — Partition the table by month/year

Same technique as `database-partitioning.md`: split one giant table into
monthly partitions (~41.7M rows each). A query filtering by date range now
only touches the relevant partition(s) instead of scanning billions of
rows.

`OPTIMIZE TABLE` was deliberately avoided on the live table — a full
InnoDB rebuild would hold a lock too long on a hot table. Same "don't take
a long lock on a live table" principle covered in
`database-migration-cicd-workflow.md`.

---

## Fix 2 — Choosing the fastest way to migrate/restructure the data

This is the real-world version of "retrofitting an existing table into
partitions" from `shared-example/src/database-partitioning/examples.sql`.
Three migration approaches were benchmarked on ~1 billion rows:

| Method | Time (≈1B rows) | Verdict |
|---|---|---|
| Stored procedure (batched) | ~30 hours | Flexible, but slower |
| `mysqldump` | ~42 hours | Slowest |
| CSV export + `LOAD DATA INFILE` | ~25.5 hours | **Fastest — chosen** |

The CSV route won because bulk file-based loading bypasses a lot of
per-row SQL parsing/planning overhead — the same "bulk `COPY`/batch
`INSERT` beats row-by-row inserts" principle from
`database-optimization-techniques.md` §8.

---

## Fix 3 — Tune MySQL to actually use the available hardware

With 23GB of RAM sitting idle:

| Setting | Change | Why |
|---|---|---|
| `innodb_buffer_pool_size` | raised to 20GB | Caches far more of the working set in RAM instead of hitting disk — MySQL's equivalent of Postgres's `shared_buffers` |
| `innodb_io_capacity` / `_max` | raised (2000 / 4000) | Matches modern SSD throughput; MySQL's defaults are conservative for older spinning disks |
| Key checks | disabled during bulk import, re-enabled after | Trades temporary integrity checking for import speed, since the source data is already validated |

---

## Fix 4 — Selective Redis caching, not a blanket cache

Rather than caching all 1.5M customers, the team identified the **top
~150,000 "priority" customers** (roughly the 10% queried more than 5 times
in 30 days) and cached only those:

- Cache footprint: ~200MB of Redis memory (a fraction of what caching
  everyone would cost).
- 24-hour TTL with daily invalidation.
- LRU eviction policy so infrequently-used keys get pushed out
  automatically.
- App checks Redis first; falls back to MariaDB on a miss or if Redis is
  unavailable.

This mirrors the "partial index — only index the hot subset" idea from
`indexes-types.md`: cache/index the 10% that's actually accessed
frequently, not the whole dataset.

---

## Supporting technique — finding fragmented tables

Before deciding what needs maintenance, this kind of query flags tables
with significant unused, allocated space (InnoDB doesn't reclaim space
from deleted/updated rows immediately):

```sql
SELECT
  table_schema,
  table_name,
  data_length/1024/1024 AS data_MB,
  index_length/1024/1024 AS index_MB,
  data_free/1024/1024 AS free_MB
FROM information_schema.TABLES
WHERE table_schema = 'schema'
  AND engine = 'InnoDB'
  AND data_free/data_length > 0.2;   -- free space > 20% of data size
```

Flags tables worth running `OPTIMIZE TABLE` on (or an online alternative
like `pt-online-schema-change`, since a full InnoDB rebuild locks a large
table for a long time).

---

## Overall takeaways

1. **Check what data you actually need before tuning anything else.**
   Trimming the working set from 4 years to 2 years was bigger leverage
   than any single query or index change.
2. **Benchmark migration methods for large one-time data moves.**
   Bulk file-based loading (CSV/`COPY`/`LOAD DATA INFILE`) tends to beat
   both ORMs/stored procedures and generic dump tools by a wide margin.
3. **Cache selectively based on real access patterns**, not uniformly —
   the same "hot subset" principle that applies to indexing also applies
   to caching.
4. **Never run heavy maintenance (`OPTIMIZE TABLE`, full rebuilds) directly
   against a live, high-traffic table** — schedule it, or use an online
   alternative.

## See also

- `database-partitioning.md` — partitioning concepts and Postgres examples
- `database-optimization-techniques.md` — the broader technique catalog this case study draws from
- `database-migration-cicd-workflow.md` — safe migration/deploy process
- `connection-pooling-sql-redis.md` — reducing connection overhead for MariaDB/Redis
