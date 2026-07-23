# Indexes in a Real Project

---

## Rule: always use migrations, never raw SQL

Never run `CREATE INDEX` manually in production. Add it as a versioned migration.

---

## TypeORM migration

```typescript
export class AddEmailIndex implements MigrationInterface {
  transaction = false; // required for CONCURRENTLY

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email
      ON users (email)
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_id_created_at
      ON orders (user_id, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_users_email`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_orders_user_id_created_at`);
  }
}
```

---

## Prisma schema

```prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique              // unique index — automatic

  @@map("users")
}

model Order {
  userId    Int
  createdAt DateTime @default(now())

  @@index([userId, createdAt], name: "idx_orders_user_id_created_at")
  @@index([status, createdAt],  name: "idx_orders_status_created_at")

  @@map("orders")
}
```

Run `pnpm prisma migrate dev` — Prisma generates the SQL migration automatically.

---

## Always use CONCURRENTLY in production

```sql
-- Locks the table during build — dev/staging only
CREATE INDEX idx_users_email ON users (email);

-- Non-blocking — safe for live production traffic
CREATE INDEX CONCURRENTLY idx_users_email ON users (email);
```

`CONCURRENTLY` takes longer but never blocks writes.

**Caveat:** cannot run inside a transaction block. Set `transaction = false` in TypeORM migrations.

---

## Practical decision flow

1. Find slow queries via slow query log or APM (Datadog, New Relic)
2. Run `EXPLAIN ANALYZE` — look for `Seq Scan` on large tables
3. Check cardinality — high cardinality (email, user_id) = good candidate
4. Add index via migration with `CONCURRENTLY`
5. Run `EXPLAIN ANALYZE` again — verify cost drops and `Index Scan` appears

---

## Composite index column order

Put the **equality filter first**, range/sort second.

```sql
-- Query: WHERE user_id = ? AND created_at > ?
CREATE INDEX idx_orders_user_date ON orders (user_id, created_at);
-- user_id first (equality), created_at second (range)
```

Swapping the order means `WHERE user_id = ?` alone won't use the index.

---

## Monitoring index health

```sql
-- Find unused indexes — candidates for removal
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY tablename;

-- Find tables doing more seq scans than index scans — missing indexes
SELECT relname, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan
ORDER BY seq_scan DESC;
```
