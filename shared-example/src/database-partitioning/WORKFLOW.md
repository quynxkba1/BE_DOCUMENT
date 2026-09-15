# Query Workflow With And Without Partitioning

Example query — the DEX scanner's most common read, "swaps for one pair in a time
window":

```sql
SELECT *
FROM swap_events
WHERE pair_address = '0xabc...'
  AND block_timestamp >= '2026-09-01'
  AND block_timestamp <  '2026-10-01';
```

---

## Without Partitioning

`swap_events` is one table with 2 billion rows and an index on
`(pair_address, block_timestamp)`.

```text
Client sends query
  -> database parses SQL
  -> database plans execution
  -> uses idx_swap_pair_time
  -> walks the index for pair_address = '0xabc...'
  -> filters by block_timestamp range
  -> returns matching rows
```

The index helps, but it's an index over the *entire* 2 billion rows. Its size means:

- More of the B-tree has to be read from disk if it doesn't fit in `shared_buffers`.
- `VACUUM` and `ANALYZE` on this table take longer because they scan/maintain the whole
  thing, even though only the current month is actively being written.
- Deleting old rows (`DELETE FROM swap_events WHERE block_timestamp < ...`) has to walk
  and mark dead millions of rows, generating WAL and index churn.

---

## With Partitioning

```sql
CREATE TABLE swap_events (
  ...
) PARTITION BY RANGE (block_timestamp);

CREATE TABLE swap_events_2026_09 PARTITION OF swap_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

Same query, new workflow:

```text
Client sends query
  -> database parses SQL
  -> database plans execution
  -> partition pruning: block_timestamp range matches only swap_events_2026_09
  -> other partitions (2026_08, 2026_07, ...) are skipped entirely
  -> uses idx_swap_pair_time on swap_events_2026_09 only
  -> walks the much smaller per-partition index
  -> returns matching rows
```

Verify pruning actually happened:

```sql
EXPLAIN ANALYZE
SELECT *
FROM swap_events
WHERE pair_address = '0xabc...'
  AND block_timestamp >= '2026-09-01'
  AND block_timestamp <  '2026-10-01';
```

```text
Append (actual rows=1284)
  -> Index Scan using idx_swap_pair_time on swap_events_2026_09
       Index Cond: (pair_address = '0xabc...' AND block_timestamp >= ... AND block_timestamp < ...)
```

Only `swap_events_2026_09` appears in the plan — `swap_events_2026_08` and every older
month are never touched.

---

## What Happens On Insert

```sql
INSERT INTO swap_events (tx_hash, block_timestamp, pair_address, ...)
VALUES ('0xdeadbeef...', '2026-09-15 10:00:00+00', '0xabc...', ...);
```

```text
1. Postgres checks block_timestamp against each partition's range.
2. Routes the row to swap_events_2026_09.
3. Updates only that partition's indexes — not the whole table's.
```

If no partition exists for the row's date (e.g. October hasn't been created yet), the
insert fails:

```text
ERROR: no partition of relation "swap_events" found for row
```

This is why the next month's partition must be created **before** it starts receiving
data — see `partitioning.service.ts` `ensureMonthlyPartition()`.

---

## What Happens On Retention Cleanup

```sql
-- Without partitioning: scans and marks dead every matching row, bloats indexes
DELETE FROM swap_events WHERE block_timestamp < '2025-09-01';

-- With partitioning: instant, no scan, no bloat
DROP TABLE swap_events_2025_08;
```

---

## Query Planner

Partition pruning happens in two possible phases:

```text
Planning-time pruning:  the WHERE value is a constant known when the query is planned
                         (e.g. a literal date) — pruning shows up directly in EXPLAIN.

Execution-time pruning: the WHERE value comes from a parameter/subquery not known until
                         the query runs — EXPLAIN ANALYZE shows
                         "Subplans Removed" for the partitions skipped at runtime.
```

Either way, the unmatched partitions' indexes are never opened — the whole benefit
depends on the query actually filtering on the partition key (`block_timestamp` here).
A query without that filter has to scan every partition, which is worse than one
well-indexed monolithic table.

---

## Short Summary

```text
Without partitioning:
  one huge table + one huge index, every query pays that size

With partitioning:
  same logical table, many small physical tables
  matching partitions are found and scanned, the rest are skipped entirely

Tradeoff:
  faster reads/deletes on time-filtered queries and instant retention cleanup,
  but queries that ignore the partition key get no benefit (or slightly worse),
  and the partition key must be part of any PRIMARY KEY / UNIQUE constraint
```
