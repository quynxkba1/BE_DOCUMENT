# Schema Migration Strategy on Live, Billion-Row Tables

The problem: you cannot run a naive `ALTER TABLE` on a table with billions of rows in production — it either **locks the table for minutes/hours** or **rewrites the whole table**, both of which take down writes (and often reads) on a hot path.

This note covers three things: which DDL operations are actually safe, the **expand/contract pattern** for changes that aren't safe, and how to **backfill data without locking**.

---

## 1. Why naive DDL is dangerous

Every `ALTER TABLE` needs a lock. The type of lock — and whether the table gets rewritten — determines the blast radius.

```sql
-- Looks harmless. On Postgres < 11, this REWRITES THE ENTIRE TABLE.
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
```

Why: adding a column with a default used to mean writing that default into every existing row — a full table rewrite under `ACCESS EXCLUSIVE` lock, blocking **all** reads and writes for the duration. On a 2-billion-row table, that's not seconds — it's hours.

```
Lock hierarchy (Postgres, weakest → strongest):
ACCESS SHARE            → SELECT
ROW SHARE                → SELECT FOR UPDATE
ROW EXCLUSIVE            → INSERT/UPDATE/DELETE
SHARE UPDATE EXCLUSIVE   → CREATE INDEX CONCURRENTLY, VACUUM, some ALTERs
SHARE                     → CREATE INDEX (non-concurrent)
SHARE ROW EXCLUSIVE      → some ALTER TABLE variants
EXCLUSIVE                 → rarely used directly
ACCESS EXCLUSIVE          → DROP TABLE, TRUNCATE, most ALTER TABLE, VACUUM FULL
```

`ACCESS EXCLUSIVE` conflicts with everything, including plain `SELECT`. That's the lock you must avoid holding for anything longer than milliseconds.

---

## 2. What's actually safe vs. what rewrites the table (Postgres)

| Operation | Safe? | Why |
|---|---|---|
| `ADD COLUMN col TYPE` (nullable, no default) | ✅ Instant | Just adds metadata; existing rows return `NULL` for the new column |
| `ADD COLUMN col TYPE DEFAULT <constant>` | ✅ Instant (Postgres 11+) | Default stored as metadata, applied lazily on read — no rewrite |
| `ADD COLUMN col TYPE DEFAULT <volatile expr>` (e.g. `now()`, `random()`) | ❌ Rewrites table | Can't be applied lazily — every row needs the value computed at add-time |
| `DROP COLUMN` | ✅ Instant | Marks column dead in catalog; space reclaimed later by `VACUUM` |
| `ADD COLUMN ... NOT NULL` (no default) | ❌ Fails immediately | Can't satisfy constraint for existing rows |
| `ALTER COLUMN TYPE` (e.g. `INT` → `BIGINT`) | ❌ Rewrites table (usually) | Needs to re-encode every value; exception: compatible type changes in newer Postgres |
| `ADD CONSTRAINT CHECK (...)` | ❌ Full table scan under lock (unless `NOT VALID`) | Must verify every existing row satisfies it |
| `ADD CONSTRAINT ... NOT VALID` | ✅ Instant | Skips validation, only enforces on new writes — validate separately (see §4) |
| `CREATE INDEX` | ❌ Blocks writes for the duration | Takes a lock that blocks `INSERT`/`UPDATE`/`DELETE` |
| `CREATE INDEX CONCURRENTLY` | ✅ Non-blocking | Builds the index in the background using weaker locks, at the cost of ~2x build time and no wrap in a transaction block |
| `RENAME COLUMN` / `RENAME TABLE` | ✅ Instant (metadata only) | But **breaks any code still using the old name** — this is an application coordination problem, not a DB one |

**Rule of thumb:** anything that requires reading/rewriting every existing row, or validating every existing row against a new rule, is dangerous at scale. Anything that's pure catalog metadata is safe.

---

## 3. The Expand/Contract pattern (a.k.a. Parallel Change)

For changes that aren't inherently safe — renaming a column the app depends on, changing a column's type, splitting one table into two — you never do it in one step. You do it in three phases, each independently deployable and reversible.

### Example: renaming `orders.total` → `orders.total_amount`

**Phase 1 — Expand** (additive only, fully backward compatible)
```sql
-- Add the new column, nullable, no default (instant)
ALTER TABLE orders ADD COLUMN total_amount NUMERIC(12,2);
```
Deploy application code that **writes to both** columns on every insert/update, but still **reads from the old one**:
```typescript
await db.orders.update({
  where: { id },
  data: { total: amount, total_amount: amount }, // dual write
});
```

**Phase 2 — Backfill** (populate the new column for existing rows — see §4 for how to do this without locking)

**Phase 3 — Migrate reads**
Deploy application code that reads from `total_amount` instead of `total`. Keep writing to both columns for one more deploy cycle as a safety net (easy rollback if a bug surfaces).

**Phase 4 — Contract** (cleanup, only after you're confident nothing reads the old column)
```sql
-- Stop dual-writing in app code first, deploy, THEN:
ALTER TABLE orders DROP COLUMN total;  -- instant, metadata-only
```

### Why this works
Each phase is a **small, reversible, independently deployable** change. If phase 3 breaks something, you roll back the app deploy — the schema still has both columns, no data loss, no emergency migration. Compare to a single `ALTER TABLE ... RENAME` deployed atomically with app code: any rollback requires an emergency DB change under pressure.

### Same pattern applies to:
- **Type changes**: add new-typed column → backfill → switch reads → drop old column.
- **Splitting a table**: create the new table → dual-write → backfill → switch reads → stop writing to the old location.
- **NOT NULL constraints**: add column nullable → backfill → add `CHECK (col IS NOT NULL) NOT VALID` → validate (§4) → only then convert to a real `NOT NULL`.

---

## 4. Backfilling without locking

Never do this on a billion-row table:
```sql
-- DON'T: one giant transaction, holds locks for the entire duration,
-- generates a huge amount of WAL/undo, risks lock timeout and replication lag spikes
UPDATE orders SET total_amount = total WHERE total_amount IS NULL;
```

Instead, **batch it**:

```sql
-- Repeat in a loop from application code or a script, e.g. 5,000 rows per batch
UPDATE orders
SET total_amount = total
WHERE id IN (
  SELECT id FROM orders
  WHERE total_amount IS NULL
  ORDER BY id
  LIMIT 5000
);
```

Key practices:
- **Small batches, short transactions** — each batch commits and releases its locks immediately, so it never blocks concurrent app traffic for more than milliseconds.
- **Throttle between batches** (e.g. sleep 50-100ms) — gives replicas time to catch up and keeps WAL generation rate manageable; skipping this can spike **replication lag** on read replicas.
- **Iterate by indexed key (usually PK), not `OFFSET`** — `OFFSET` re-scans skipped rows every batch, degrading to O(n²) over a billion rows.
- **Monitor as you go** — replication lag, lock wait time, `pg_stat_activity` for blocked queries. Stop/pause the backfill job if lag crosses a threshold.
- **Make it resumable** — track the last processed `id` (checkpoint) so a restart doesn't reprocess billions of rows or double-apply.
- **Run during low-traffic windows** if the table is especially hot, even though the batching should make it safe at any time.

```
Batched backfill timeline:
batch 1 (5k rows) → commit → sleep 100ms → batch 2 → commit → sleep 100ms → ...
                     ↑ locks released here, app queries proceed normally
```

### Backfilling a NOT NULL constraint specifically

```sql
-- 1. Add as NOT VALID — instant, only enforces on new/updated rows
ALTER TABLE orders ADD CONSTRAINT total_amount_not_null
  CHECK (total_amount IS NOT NULL) NOT VALID;

-- 2. Backfill any remaining NULLs using the batched approach above

-- 3. Validate — scans the table but takes SHARE UPDATE EXCLUSIVE,
--    which does NOT block reads/writes (only blocks other DDL)
ALTER TABLE orders VALIDATE CONSTRAINT total_amount_not_null;

-- 4. Now safe to add the real constraint (Postgres 12+, this is instant
--    once an equivalent valid CHECK exists)
ALTER TABLE orders ALTER COLUMN total_amount SET NOT NULL;
```

This is the standard way to add `NOT NULL` to a huge table with zero downtime.

### Foreign keys follow the same shape

```sql
ALTER TABLE orders ADD CONSTRAINT fk_orders_user
  FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_user;
```

---

## 5. MySQL — a different mechanism, same principle

InnoDB's "online DDL" support varies by operation and version — many `ALTER TABLE`s still take a metadata lock or rebuild the table. For anything non-trivial at scale, the standard tools are:

- **`gh-ost`** (GitHub) or **`pt-online-schema-change`** (Percona): both work by creating a shadow copy of the table with the new schema, copying rows over in batches, capturing ongoing writes (via triggers or binlog tailing) to replay onto the shadow table, then atomically renaming shadow → original in one fast swap.
- Conceptually this **is** the expand/contract + batched-backfill pattern, just automated and applied to the whole table at once instead of column-by-column.

---

## 6. Common mistakes

| Mistake | Consequence |
|---|---|
| Running `ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT X` on Postgres < 11 | Full table rewrite under `ACCESS EXCLUSIVE` — total outage for the duration |
| `CREATE INDEX` instead of `CREATE INDEX CONCURRENTLY` | Blocks all writes to the table until the index finishes building |
| One giant `UPDATE` for backfill | Long transaction → lock contention, WAL bloat, replication lag spike, risk of hitting lock/statement timeouts and rolling back everything |
| Renaming a column/table in one atomic deploy with app code | No safe rollback path; any bug forces an emergency schema change under pressure |
| Using `OFFSET` for batch pagination during backfill | O(n²) — gets progressively slower as the backfill proceeds |
| Skipping throttling between backfill batches | Can starve replicas, causing them to fall far behind (stale reads for anyone using read replicas) |
| Forgetting to `VALIDATE CONSTRAINT` before relying on it query-planner-wise | The constraint enforces new writes correctly but the planner can't yet use it for query optimization until validated |

---

## Follow-up Q&A

**Q: Why doesn't `VALIDATE CONSTRAINT` block reads/writes even though it scans the whole table?**

It takes a `SHARE UPDATE EXCLUSIVE` lock, which conflicts with other DDL (another `VALIDATE`, `VACUUM FULL`, etc.) but **not** with normal `SELECT`/`INSERT`/`UPDATE`/`DELETE`. It's designed exactly for this "scan without blocking traffic" use case.

**Q: Why can Postgres 11+ add a column with a constant default instantly, but not with `now()`?**

Postgres 11 introduced the ability to store the default as metadata and compute it lazily per-row on read, but only for defaults that are the same for every row (a constant). A volatile expression like `now()` or `random()` needs a different value per row, so it still requires an actual rewrite.

**Q: Can I just run the migration in a maintenance window instead of doing all this?**

For small tables, yes — that's simpler and this whole pattern is overkill. The expand/contract + batched backfill approach is specifically for tables large enough (typically 10M+ rows, definitely at billions) that even a "maintenance window" lock would take longer than an acceptable outage, or for systems that can't accept any downtime at all.

**Q: How does this interact with [[database-partitioning]]?**

Partitioned tables make some of this easier — `DROP TABLE` on an old partition is instant, so retention-driven schema changes don't need any of this. But adding a column/constraint to a partitioned table still applies to (and needs backfilling across) every partition, so the same principles apply per-partition.
