# Database Partitioning

Partitioning splits one large table into smaller physical tables. The application still
queries a single logical table name — the database quietly reads only the relevant
piece. This is called **partition pruning**.

We use the `swap_events` table from `dex-scanner` as the real example, because its own
schema comment already says why it needs this:

```prisma
// Stores every swap event emitted by DEX smart contracts (Uniswap, PancakeSwap, etc.)
// This table is the core of the DEX scanner — it grows by millions of rows per day.
model SwapEvent { ... }
```

A table growing by millions of rows per day will eventually be too large for any index
or cache to help much, and old rows (say, older than a year) are rarely queried but
still cost disk space and slow down `VACUUM`. Partitioning by time fixes both problems.

---

## Simple Mental Model

Without partitioning, `swap_events` is one giant table:

```text
swap_events  (2 billion rows, all time)
```

Every query — even one that only wants "today's swaps for this pair" — has to contend
with an index covering 2 billion rows.

With partitioning, the same logical table is really many smaller tables underneath:

```text
swap_events (logical name, PARTITION BY RANGE (block_timestamp))
├── swap_events_2026_07   (~40M rows)
├── swap_events_2026_08   (~42M rows)
└── swap_events_2026_09   (~38M rows, current month)
```

A query for September only touches `swap_events_2026_09` — the other partitions (and
their indexes) are never opened.

---

## Why Prisma Can't Declare This

Prisma's schema language has no `PARTITION BY` syntax — partitioning is applied with raw
SQL, either as a hand-written migration or executed at runtime with `$executeRawUnsafe`.
The Prisma model (`SwapEvent`) still maps to the partitioned table by name; Prisma Client
doesn't need to know the table is partitioned to `SELECT`/`INSERT` against it — Postgres
routes rows to the correct partition transparently.

See `examples.sql` for the exact SQL, and `partitioning.service.ts` for the same
operations driven from NestJS.

---

## The Retrofit Problem (partitioning a table that already has data)

You can't `ALTER TABLE ... PARTITION BY` an existing table in Postgres — partitioning
must be set up when the table is created. Retrofitting a live table means:

```text
1. Create a new partitioned table with the same columns (swap_events_new).
2. Create partitions for the date ranges the old data covers, plus future months.
3. Copy data across in batches (INSERT INTO ... SELECT ... WHERE block_timestamp BETWEEN ...).
4. Recreate indexes/constraints on each partition.
5. Swap names: ALTER TABLE swap_events RENAME TO swap_events_old;
              ALTER TABLE swap_events_new RENAME TO swap_events;
6. Verify, then drop swap_events_old once confident.
```

This is why partitioning strategy should ideally be decided **before** a table gets
large — retrofitting is a real (if mechanical) migration project, not a single DDL
statement.

---

## What Partitioning Is Good For

- Tables with a natural time axis and queries that almost always filter by time
  (`WHERE block_timestamp >= ...`) — exactly the DEX scanner's access pattern.
- Instant bulk deletes: `DROP TABLE swap_events_2024_01` instead of
  `DELETE FROM swap_events WHERE block_timestamp < '2024-02-01'`, which would scan
  millions of rows and bloat every index.
- Keeping each partition's working set small enough to stay resident in cache/memory,
  instead of one huge table constantly evicting itself from `shared_buffers`.

## When It Doesn't Help

- Queries that don't filter on the partition key — they still have to scan every
  partition (worse than one well-indexed table, due to per-partition planning overhead).
- Small tables. Partitioning has planner overhead; a 100k-row table gains nothing.
- Too many tiny partitions (e.g. hourly for years) — the planner has to evaluate
  thousands of partitions even to prune them.

---

## Interview Answer

> Partitioning splits a large table into smaller physical tables sharing one logical
> name, so a query filtering on the partition key only scans the relevant partition
> (partition pruning) instead of the whole table. It's most useful for time-series data
> with natural retention needs, where old partitions can be dropped instantly instead of
> deleted row by row. Postgres can't add partitioning to an existing table in place — you
> create a new partitioned table, backfill data, and swap it in.
