-- Database partitioning examples, built on the dex-scanner's swap_events table
-- (see prisma/schema.prisma — "grows by millions of rows per day").
--
-- Prisma has no PARTITION BY syntax, so this is applied as raw SQL, either by hand
-- or via partitioning.service.ts using $executeRawUnsafe. The Prisma model still
-- reads/writes the table by name; Postgres handles routing rows to partitions.

-- ─── 1. Retrofitting an existing table into partitions ─────────────────────────
-- You cannot ALTER an existing table to add PARTITION BY. Create a new partitioned
-- table, backfill, then swap names.

CREATE TABLE swap_events_new (
  id             BIGSERIAL,
  tx_hash        VARCHAR(66)  NOT NULL,
  block_number   BIGINT       NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,
  pair_address   VARCHAR(42)  NOT NULL,
  token_in       VARCHAR(42)  NOT NULL,
  token_out      VARCHAR(42)  NOT NULL,
  amount_in      NUMERIC(38,0) NOT NULL,
  amount_out     NUMERIC(38,0) NOT NULL,
  price          NUMERIC(30,18) NOT NULL,
  wallet         VARCHAR(42)  NOT NULL,
  log_index      INT          NOT NULL,
  -- the partition key (block_timestamp) must be part of every PK/UNIQUE constraint
  PRIMARY KEY (id, block_timestamp)
) PARTITION BY RANGE (block_timestamp);

-- Create partitions for the months already covered by existing data, plus the
-- current and next month so inserts don't fail on day one.
CREATE TABLE swap_events_2026_07 PARTITION OF swap_events_new
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE swap_events_2026_08 PARTITION OF swap_events_new
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE swap_events_2026_09 PARTITION OF swap_events_new
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE swap_events_2026_10 PARTITION OF swap_events_new
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- Recreate the same indexes the monolithic table had, per partition (or on the
-- parent — Postgres propagates an index created on the parent to every partition).
CREATE INDEX ON swap_events_new (pair_address, block_timestamp DESC);
CREATE INDEX ON swap_events_new (wallet, block_timestamp DESC);
CREATE UNIQUE INDEX ON swap_events_new (tx_hash, log_index);

-- Backfill in batches by month so each transaction stays small.
INSERT INTO swap_events_new
  SELECT * FROM swap_events
  WHERE block_timestamp >= '2026-07-01' AND block_timestamp < '2026-08-01';
INSERT INTO swap_events_new
  SELECT * FROM swap_events
  WHERE block_timestamp >= '2026-08-01' AND block_timestamp < '2026-09-01';
-- ... repeat per month until caught up ...

-- Swap the tables (brief lock during the rename, no data copy).
ALTER TABLE swap_events RENAME TO swap_events_old;
ALTER TABLE swap_events_new RENAME TO swap_events;

-- Once verified, drop the old monolithic table.
-- DROP TABLE swap_events_old;

-- ─── 2. Partition pruning in action ─────────────────────────────────────────────

EXPLAIN ANALYZE
SELECT *
FROM swap_events
WHERE pair_address = '0xabc0000000000000000000000000000000000abc'
  AND block_timestamp >= '2026-09-01'
  AND block_timestamp <  '2026-10-01';

-- Expected: only swap_events_2026_09 appears in the plan.

-- ─── 3. Rolling maintenance: add next month, drop oldest ───────────────────────

CREATE TABLE swap_events_2026_11 PARTITION OF swap_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

-- Instant retention cleanup — no row-by-row DELETE, no index bloat.
DROP TABLE swap_events_2025_10;

-- ─── 4. Listing partitions of a table (for the service's listPartitions()) ─────

SELECT
  child.relname  AS partition_name,
  pg_get_expr(child.relpartbound, child.oid) AS partition_range
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
WHERE parent.relname = 'swap_events'
ORDER BY partition_name;

-- ─── 5. Common mistake: query without the partition key ────────────────────────

-- No block_timestamp filter -> every partition must be scanned, defeating pruning.
EXPLAIN
SELECT * FROM swap_events WHERE wallet = '0xdef0000000000000000000000000000000000def';
