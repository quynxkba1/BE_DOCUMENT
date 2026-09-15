# Database Migration Workflow: Local → CI → CD → Prod

> How a schema change (new column, new table) travels from a local branch to
> production, using PostgreSQL + Prisma as the concrete example.

---

## The three places a migration "exists"

```
1. Local machine   — you write the schema change, generate migration SQL, test it
2. Git repo        — the migration SQL file is committed, reviewed like code
3. CI/CD pipeline   — the SQL is *applied* to staging/prod as a deploy step
```

**Rule:** the migration file is generated **once**, locally, and never regenerated
per environment. The exact same SQL that ran on your laptop runs on prod — that's
what makes it safe and predictable.

---

## Step 1 — Local: make the schema change

```prisma
model Order {
  id     Int    @id @default(autoincrement())
  ...
  status String @default("pending")   // new column
}
```

```bash
npx prisma migrate dev --name add_order_status
```

This does three things locally:
1. Diffs your schema against your local dev DB.
2. Generates `prisma/migrations/20260915_add_order_status/migration.sql`.
3. Applies it to your local DB immediately, so you can test against it.

```sql
-- prisma/migrations/20260915120000_add_order_status/migration.sql
ALTER TABLE "orders" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
```

For anything risky (two-step `NOT VALID` constraints, batched backfills — see
`database-optimization-techniques.md` / lock-safety notes below), use
`--create-only` and hand-edit the SQL before it's ever applied anywhere:

```bash
npx prisma migrate dev --name add_order_status --create-only
# edit migration.sql by hand
npx prisma migrate dev   # now apply the edited version locally
```

---

## Step 2 — Git: commit the migration file, open a PR

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "Add status column to orders"
git push
```

The migration SQL is now a reviewable artifact — reviewers read the actual
`ALTER TABLE` statement, not just the Prisma model diff, so they can catch a
missing `CONCURRENTLY` or a risky rewrite before it ever reaches prod.

---

## Step 3 — CI: verify the migration applies cleanly

On every PR, CI spins up a throwaway Postgres and runs the migration against it —
this catches "works on my machine" schema drift before merge:

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx prisma migrate deploy   # applies all pending migrations, in order
      - run: npm test
```

`migrate deploy` (not `migrate dev`) is the command built for CI/CD — it's
non-interactive, doesn't touch a shadow DB, doesn't try to generate new
migrations, and just applies whatever's already committed in
`prisma/migrations/`.

---

## Step 4 — CD: apply the migration to staging, then prod

This is the part that actually touches production. It runs as its **own
pipeline step, before the new app version starts serving traffic**:

```yaml
# .github/workflows/deploy.yml
jobs:
  migrate:
    steps:
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}

  deploy-app:
    needs: migrate
    steps:
      - run: kubectl rollout restart deployment/api   # or however you deploy
```

Two properties of `migrate deploy` make this safe to run unattended against prod:

- **Idempotent** — it tracks applied migrations in a `_prisma_migrations` table,
  so re-running it does nothing if everything's already applied. Safe to retry.
- **Sequential and one-directional** — it applies pending migrations in order,
  doesn't try to "diff" the live prod schema against your local file, and never
  auto-generates SQL against prod. Nothing unexpected can run.

In a Kubernetes setup specifically, this migration step is usually a `Job` or
`initContainer` that must complete successfully before the deployment's rolling
update proceeds — so a broken migration blocks the app deploy instead of
half-deploying.

---

## How this connects to expand-contract

Migration and app deploy are **separate pipeline steps** on purpose — that's
what makes expand-contract work safely with rolling deploys:

```
migrate (expand)  →  runs first, adds "status" column (nullable/defaulted)
                      old app code (doesn't know about "status") keeps running fine

deploy-app         →  rolls out new code across pods one at a time
                      during the rollout, OLD pods and NEW pods are both running
                      against the SAME already-migrated schema — both work

(next PR) migrate (contract) → drop anything the old code needed, only after
                                 you're sure no old pod is running anymore
```

This is why you never put "add column" and "drop column" in the same
migration/deploy — a rolling deploy means both old and new code run
simultaneously against the same DB for a few minutes, and the schema has to
satisfy both at once.

---

## Rollback strategy

Prisma migrations are **forward-only** in practice — there's no built-in
`migrate down`. If a migration turns out to be wrong in prod:

```bash
# Write a NEW migration that undoes it — never edit/delete an already-applied migration file
npx prisma migrate dev --name revert_order_status
```

Editing or deleting a migration file that's already applied to prod desyncs
`_prisma_migrations` from reality — treat committed migration files as
immutable history, like git commits.

---

## Full flow summary

```
local: edit schema.prisma → migrate dev → test
  ↓
git: commit migration.sql → PR → code review (reviews the SQL, not just the model)
  ↓
CI: migrate deploy against throwaway DB → run tests
  ↓
CD: migrate deploy against staging → smoke test
  ↓
CD: migrate deploy against prod (own pipeline step, before app rollout)
  ↓
CD: rolling app deploy (old + new code both compatible with the now-migrated schema)
```

---

## Deploy-order rule of thumb

- **Adding something** (column, table, index): migrate first, deploy code second.
- **Removing something**: deploy code first (stop using it), migrate second (drop it).
- Never combine both directions in one deploy — that's what makes rollback
  impossible without also rolling back the DB.

---

## Tools that enforce safe migrations automatically

| Tool | What it does |
|---|---|
| `strong_migrations` (Rails) | Catches unsafe migrations at dev time, enforces `lock_timeout`/`statement_timeout` |
| `safe-pg-migrations` (Doctolib) | Auto-rewrites risky operations into the safe multi-step version |
| GitLab migration style guide | Retry-with-backoff pattern: short `lock_timeout`, back off, retry |
| `pgroll` | Purpose-built for Postgres expand/contract migrations with instant rollback |
| `pg_repack` | Online table rewrites without a long exclusive lock |
| `pg_partman` | Automates ongoing partition maintenance (create/drop partitions on schedule) |

---

## Q&A: With many files in `prisma/migrations/`, how does Prisma know to apply only the newest ones?

Prisma tracks migration state in a special table it creates in the **target
database** itself: `_prisma_migrations`. That table — not `schema.prisma` — is
the source of truth for "what's already been applied."

### How `migrate deploy` decides what's pending

```
1. Read every folder in prisma/migrations/, sorted by their timestamp prefix
   (20260910..., 20260912..., 20260915...) — this defines the canonical order.

2. Query _prisma_migrations in the TARGET database:
   SELECT migration_name, checksum, finished_at, rolled_back_at
   FROM _prisma_migrations;

3. Diff: any migration folder whose name has no "finished_at" row = pending.

4. Apply pending migrations one at a time, in timestamp order,
   executing migration.sql for each.

5. After each one succeeds, insert/update its row in _prisma_migrations
   (name, checksum of migration.sql, finished_at = now()).
```

So on a fresh prod DB, all 20 migrations are pending and run in order. On a DB
that already has the first 18 applied, `migrate deploy` sees 18 matching rows
in `_prisma_migrations`, skips them, and only runs migration #19 and #20.

### What the `_prisma_migrations` table actually looks like

```
id        | migration_name              | checksum   | started_at | finished_at | rolled_back_at
----------|------------------------------|------------|------------|-------------|---------------
a1b2c3... | 20260910_init                | 7f3a9c...  | ...        | ...         | NULL
d4e5f6... | 20260912_add_orders_table    | 2b8e1d...  | ...        | ...         | NULL
g7h8i9... | 20260915_add_order_status    | 9c4f2a...  | ...        | NULL        | NULL   <- in progress / failed
```

A row with `finished_at = NULL` and no `rolled_back_at` means that migration
started but never completed — it's treated as **failed**, and `migrate deploy`
refuses to continue past it until you resolve it manually:

```bash
npx prisma migrate resolve --applied 20260915_add_order_status      # if it actually succeeded despite the crash
npx prisma migrate resolve --rolled-back 20260915_add_order_status  # if you manually reverted it
```

### Why checksums matter

Each row also stores a hash of the migration file's SQL content. If you (or
someone) edits an already-applied `migration.sql` file after the fact, the
checksum on disk no longer matches the checksum recorded in
`_prisma_migrations`, and `migrate deploy` fails loudly instead of silently
re-running or skipping it. This is the mechanism that enforces "committed
migrations are immutable" — it's not just a convention, Prisma actively
checks it.

### Locking against concurrent deploys

`migrate deploy` takes an advisory lock in Postgres before running, so if your
CI/CD accidentally triggers two deploy jobs at once (e.g. a retried pipeline),
the second one waits instead of racing the first and corrupting
`_prisma_migrations`.

### Why this is different from `migrate dev`

| | `migrate dev` (local) | `migrate deploy` (CI/CD, prod) |
|---|---|---|
| Compares against | Shadow DB (temporary) vs `schema.prisma`, to *generate* new SQL | Only `_prisma_migrations` history, to *apply* existing SQL |
| Can create new migration files | Yes | No — fails if `schema.prisma` and migration history don't match |
| Interactive | Yes (prompts on drift) | No — must be scriptable for pipelines |

This is exactly why `migrate deploy` is the only command that belongs in a CD
pipeline: it never invents SQL on the fly against prod, it only replays
exactly what's already committed and not yet marked `finished_at` in that
environment's `_prisma_migrations` table.
