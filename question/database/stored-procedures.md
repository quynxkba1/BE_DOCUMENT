# Stored Procedures

A **stored procedure** is a named, precompiled block of SQL (plus
procedural logic — loops, conditionals, variables) saved inside the
database itself and called by name, instead of sending raw SQL from the
application every time.

---

## Basic example (MySQL/MariaDB syntax)

```sql
DELIMITER $$

CREATE PROCEDURE GetOrdersByUser(IN userId INT)
BEGIN
  SELECT * FROM orders WHERE user_id = userId;
END $$

DELIMITER ;
```

Calling it:

```sql
CALL GetOrdersByUser(123);
```

Instead of the application sending the full
`SELECT * FROM orders WHERE user_id = 123` text every time, it just calls
`GetOrdersByUser(123)` — the actual query logic lives in the database.

---

## Why they exist

| Without a procedure | With a procedure |
|---|---|
| App sends raw SQL text over the network every call | App sends just a short `CALL name(...)` |
| Logic (multiple queries, loops, conditionals) lives in app code | Logic can run entirely inside the DB, closer to the data |
| Query re-parsed/re-planned on every execution (in some DBs) | Can be precompiled/cached as an execution plan |
| Business logic duplicated across every service touching this table | One shared procedure, called from anywhere |

---

## Procedures support real procedural logic

Not just a single `SELECT` — variables, loops, conditionals, error handling:

```sql
CREATE PROCEDURE MigrateOldOrders()
BEGIN
  DECLARE rows_affected INT DEFAULT 1;

  WHILE rows_affected > 0 DO
    UPDATE orders SET archived = TRUE
    WHERE archived = FALSE
    LIMIT 100000;

    SET rows_affected = ROW_COUNT();
    COMMIT;  -- release locks after each batch, don't hold one huge transaction
  END WHILE;
END
```

---

## Procedure vs. plain query vs. function

| | Plain SQL query | Stored procedure | Stored function |
|---|---|---|---|
| Where it lives | App code | Database | Database |
| Can contain loops/conditionals | No | Yes | Yes (limited) |
| Called how | Sent as raw SQL | `CALL name(...)` | Used inside a `SELECT` expression |
| Returns | Result set | Zero or more result sets, output params | A single value |
| Typical use | Ad-hoc/app queries | Batch jobs, complex multi-step logic, migrations | Reusable calculation used inline in queries |

---

## Tradeoffs

**Pros:**
- Less network round-trip data (just the call, not the full SQL text).
- Centralizes logic that multiple services/apps need to share.
- Can reduce round trips for multi-step operations (do several things in
  one `CALL` instead of several separate queries from the app).

**Cons:**
- Business logic split between application code and the database — harder
  to version control, test, and code-review than application code.
- Vendor-specific syntax (MySQL, Postgres `PL/pgSQL`, SQL Server `T-SQL`
  all differ) — less portable.
- Harder to unit test than application-layer code.
- With modern ORMs (Prisma, TypeORM) and app-centric architectures, most
  teams keep business logic in application code and use plain queries —
  procedures are now mostly reserved for heavy batch jobs, data
  migrations, or places where minimizing round trips to the DB matters a
  lot.

---

## Why procedures fit data migrations / batch jobs specifically

Bulk data movement has different needs than typical app queries — this is
where stored procedures earn their keep.

### 1. No round trip between DB and app per batch

```
Without a procedure (app-driven loop):
  App: SELECT batch → DB
  DB:  rows → over the network → App
  App: transforms/decides → sends UPDATE/INSERT back → DB
  (repeat thousands of times)

With a procedure:
  App: CALL MigrateOrders()
  DB:  reads, transforms, writes — all inside the database engine,
       no network hop per batch
```

For a migration touching a billion rows, every network round trip between
app and DB adds up. Running the loop *inside* the database avoids shipping
data out to the app and back in just to move it somewhere else in the same
database.

### 2. Batching with commit control, without holding one giant transaction

The `MigrateOldOrders` example above batches in chunks of 100,000 and
commits after each — same principle as batched backfills covered in
`database-migration-cicd-workflow.md`: small batches, commit between each,
avoid one long-held lock/transaction on a hot table.

### 3. Doesn't tie up application server resources

A migration touching a billion rows via app code means the app process
holds open a DB connection, buffers/streams rows into memory, and does the
looping logic — competing with the app server's actual job (serving user
requests) for CPU/memory/connections. A stored procedure runs entirely
inside the database server, using the database's own resources.

### 4. Can be scheduled/run independently of app deploys

```sql
CALL MigrateOldOrders();
```

Can be triggered directly from a DB client, a cron job on the DB host, or
the database's own scheduler (MySQL Event Scheduler, `pg_cron` for
Postgres) — without deploying or running any application code at all.
Useful for a one-off backfill/migration an ops engineer runs directly
against the database.

### 5. Avoids ORM overhead for pure bulk movement

When the app layer moves data via an ORM (Prisma, TypeORM), each row
typically gets hydrated into an object, validated, and serialized —
overhead that's pointless when just copying/transforming rows in bulk with
no business logic that needs the ORM's model layer. A procedure operates
directly on rows in SQL.

---

## When a procedure is the right choice vs. when file-based bulk load wins

| Scenario | Better choice |
|---|---|
| Recurring batch job (nightly archival, rolling cleanup) | Stored procedure — reusable, schedulable, no need to regenerate files each run |
| One-time massive migration (billions of rows, done once) | File-based bulk load (CSV + `LOAD DATA INFILE`, or Postgres `COPY`) — fastest raw throughput, see `api-latency-optimize.md` |
| Logic needs conditionals/branching per row/batch | Stored procedure — file-based loading can't express business logic, just raw data transfer |
| Moving data between two different databases/systems | Neither alone — usually an ETL job/pipeline, though file export/import is often a piece of it |

A real benchmark from `api-latency-optimize.md` (migrating ~1 billion
rows): a stored-procedure batch loop took ~30 hours, while CSV export +
`LOAD DATA INFILE` took ~25.5 hours — for a genuinely massive one-time
migration, raw bulk file loading still beat a row-by-row procedure loop,
because `LOAD DATA INFILE` is optimized specifically for bulk ingestion
and skips even more per-row overhead than a procedure's batched
`UPDATE`/`INSERT` calls.

## See also

- `database-migration-cicd-workflow.md` — batched backfills, lock/timeout safety
- `api-latency-optimize.md` — the real-world migration benchmark referenced above
- `database-optimization-techniques.md` §8 — batch `INSERT`/`COPY` vs row-by-row
