# Database Partitioning

See [database-scaling.md](./database-scaling.md) for how partitioning fits alongside caching, indexes, replication, and sharding — and the key distinction: partitioning splits a table *within one DB instance*, sharding splits data *across instances*.

Partitioning splits one large table into smaller pieces. There are two fundamentally different types:

| Type | Splits by | Reduces |
|---|---|---|
| **Horizontal** | Rows | Too many rows in one table |
| **Vertical** | Columns | Too many columns in one table |

---

# Horizontal Partitioning — splitting by rows

Splits a table into smaller tables based on row values. To the application it still looks like one table, but the database reads only the relevant partition(s) — this is called **partition pruning**.

```
swap_events (logical table)
├── swap_events_2025_01  (Jan 2025 — 40M rows)
├── swap_events_2025_02  (Feb 2025 — 38M rows)
├── ...
└── swap_events_2026_06  (Jun 2026 — 42M rows, current)
```

A query for `WHERE block_timestamp BETWEEN '2026-06-01' AND '2026-06-30'` touches only June — all other months are skipped.

---

## Range partition (by time — most common)

```sql
CREATE TABLE swap_events (
  id              BIGSERIAL,
  block_timestamp TIMESTAMPTZ NOT NULL,
  pair_address    VARCHAR(42),
  price           NUMERIC(30,18),
  wallet          VARCHAR(42)
) PARTITION BY RANGE (block_timestamp);

CREATE TABLE swap_events_2026_06
  PARTITION OF swap_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE swap_events_2026_07
  PARTITION OF swap_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

Each partition has its own indexes:

```sql
CREATE INDEX ON swap_events_2026_06 (pair_address, block_timestamp DESC);
```

---

## Hash partition (even distribution)

```sql
CREATE TABLE orders (
  id      BIGSERIAL,
  user_id BIGINT NOT NULL,
  amount  NUMERIC(12,2)
) PARTITION BY HASH (user_id);

CREATE TABLE orders_p0 PARTITION OF orders FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE orders_p1 PARTITION OF orders FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE orders_p2 PARTITION OF orders FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE orders_p3 PARTITION OF orders FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

Use when rows have no natural time range but you want to distribute load evenly. Queries must filter by `user_id` for pruning to work.

---

## List partition (by known values)

```sql
CREATE TABLE orders (
  id     BIGSERIAL,
  region VARCHAR(20) NOT NULL,
  amount NUMERIC(12,2)
) PARTITION BY LIST (region);

CREATE TABLE orders_asia   PARTITION OF orders FOR VALUES IN ('VN', 'SG', 'TH', 'ID');
CREATE TABLE orders_europe PARTITION OF orders FOR VALUES IN ('DE', 'FR', 'GB', 'NL');
CREATE TABLE orders_us     PARTITION OF orders FOR VALUES IN ('US', 'CA');
```

Use for multi-tenant or multi-region data where each region is queried independently.

---

## The killer feature — instant DROP of old data

```sql
-- Deleting old rows the slow way — takes minutes, causes index bloat
DELETE FROM swap_events WHERE block_timestamp < '2025-01-01';

-- Dropping old partition — instant, zero bloat
DROP TABLE swap_events_2024_12;
```

---

## Partition pruning in action

```sql
EXPLAIN SELECT * FROM swap_events
WHERE block_timestamp BETWEEN '2026-06-01' AND '2026-06-30';
```

```
Append
  -> Seq Scan on swap_events_2026_06
       Filter: (block_timestamp BETWEEN ...)
```

Only one partition scanned. All others pruned automatically.

---

## TimescaleDB — automatic horizontal partitioning

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Converts table to hypertable — auto-creates time-based chunks
SELECT create_hypertable('swap_events', 'block_timestamp',
  chunk_time_interval => INTERVAL '1 day');

-- Auto-compress chunks older than 7 days
SELECT add_compression_policy('swap_events', INTERVAL '7 days');

-- Auto-drop chunks older than 1 year
SELECT add_retention_policy('swap_events', INTERVAL '1 year');
```

---

## Common mistakes (horizontal)

| Mistake | Problem |
|---|---|
| Partition key not in `WHERE` | Pruning doesn't happen — all partitions scanned |
| Too many small partitions (hourly) | Planner overhead — thousands of partitions to evaluate |
| Forgetting to pre-create next partition | INSERTs fail with "no partition found" |
| Using `DELETE` instead of `DROP TABLE` | Slow, causes bloat — always drop the whole partition |

---

---

# Vertical Partitioning — splitting by columns

Splits one wide table into multiple narrower tables linked by the same primary key. Each table holds columns with the same **access pattern**.

---

## The problem — a wide table

```sql
CREATE TABLE users (
  -- read on every authenticated request
  id            BIGINT PRIMARY KEY,
  email         VARCHAR(255),
  password_hash VARCHAR(255),

  -- read on profile page only
  first_name    VARCHAR(100),
  last_name     VARCHAR(100),
  avatar_url    TEXT,
  bio           TEXT,

  -- read on settings page only
  theme         VARCHAR(20),
  language      VARCHAR(10),
  timezone      VARCHAR(50),
  notifications JSONB,

  -- written by background jobs, rarely queried
  last_login_at   TIMESTAMPTZ,
  login_count     INT,
  total_spent     DECIMAL(12,2),

  -- read only on checkout
  stripe_customer_id VARCHAR(100),
  billing_address    TEXT
);
```

Every `SELECT id, email FROM users WHERE id = 5` loads **all 15 columns** — including billing and analytics that aren't needed. Wide rows = fewer rows per page = more disk reads.

---

## After vertical split

```sql
-- Hot: read on every request
CREATE TABLE user_credentials (
  id            BIGINT PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL
);

-- Warm: read on profile page
CREATE TABLE user_profiles (
  user_id    BIGINT PRIMARY KEY REFERENCES user_credentials(id),
  first_name VARCHAR(100),
  last_name  VARCHAR(100),
  avatar_url TEXT,
  bio        TEXT
);

-- Cold: read on settings page only
CREATE TABLE user_settings (
  user_id       BIGINT PRIMARY KEY REFERENCES user_credentials(id),
  theme         VARCHAR(20) DEFAULT 'light',
  language      VARCHAR(10) DEFAULT 'en',
  timezone      VARCHAR(50) DEFAULT 'UTC',
  notifications JSONB       DEFAULT '{}'
);

-- Background: written by jobs, rarely read by API
CREATE TABLE user_analytics (
  user_id       BIGINT PRIMARY KEY REFERENCES user_credentials(id),
  last_login_at TIMESTAMPTZ,
  login_count   INT         DEFAULT 0,
  total_spent   DECIMAL(12,2) DEFAULT 0
);

-- Checkout only
CREATE TABLE user_billing (
  user_id            BIGINT PRIMARY KEY REFERENCES user_credentials(id),
  stripe_customer_id VARCHAR(100),
  billing_address    TEXT
);
```

---

## Why this is faster

```
Before — every query loads the full row (~400 bytes):
  SELECT id, email FROM users WHERE id = 5;
  → loads: credentials + profile + settings + analytics + billing
  → 1 page fits ~20 rows

After — query loads only what it needs (~40 bytes):
  SELECT id, email FROM user_credentials WHERE id = 5;
  → loads: id + email only
  → 1 page fits ~200 rows  → 10x more rows in cache → 10x fewer disk reads
```

---

## In Prisma

```prisma
model UserCredential {
  id           Int     @id @default(autoincrement())
  email        String  @unique
  passwordHash String

  profile   UserProfile?
  settings  UserSetting?
  analytics UserAnalytic?
  billing   UserBilling?

  @@map("user_credentials")
}

model UserProfile {
  userId    Int     @id
  firstName String?
  lastName  String?
  avatarUrl String?
  bio       String?

  user UserCredential @relation(fields: [userId], references: [id])
  @@map("user_profiles")
}

model UserSetting {
  userId   Int    @id
  theme    String @default("light")
  language String @default("en")
  timezone String @default("UTC")

  user UserCredential @relation(fields: [userId], references: [id])
  @@map("user_settings")
}
```

Query only what you need:

```typescript
// Login — hot path, no JOIN
const user = await prisma.userCredential.findUnique({ where: { email } });

// Profile page — credentials + profile
const user = await prisma.userCredential.findUnique({
  where: { id },
  include: { profile: true },
});

// Settings page — settings only
const settings = await prisma.userSetting.findUnique({ where: { userId: id } });

// Checkout — billing only
const billing = await prisma.userBilling.findUnique({ where: { userId: id } });
```

---

## Normalization — the formal theory behind vertical splitting

| Normal Form | Rule | Problem it fixes |
|---|---|---|
| **1NF** | Each column holds one atomic value — no arrays, no comma-separated lists | `tags = "tech,news"` cannot be indexed |
| **2NF** | Every non-key column depends on the **whole** primary key | `order_items(order_id, product_id, product_name)` — `product_name` depends only on `product_id` |
| **3NF** | Every non-key column depends **only** on the primary key | `users(id, zip_code, city)` — `city` depends on `zip_code`, not `id` |

**3NF is the practical target** for most OLTP systems.

---

## Denormalization — doing the opposite intentionally

Sometimes you merge tables back for read performance:

```sql
-- Normalized — requires JOIN
SELECT o.id, o.amount, u.email FROM orders o JOIN users u ON o.user_id = u.id;

-- Denormalized — email stored in orders (redundant but no JOIN needed)
SELECT id, amount, user_email FROM orders;
```

| | Normalized | Denormalized |
|---|---|---|
| Storage | Less | More (data duplicated) |
| Write | Simple | Complex (update all copies) |
| Read | Needs JOIN | No JOIN needed |
| Use when | Write-heavy OLTP | Read-heavy analytics |

---

## When to use which

| Use horizontal partitioning when | Use vertical partitioning when |
|---|---|
| Table has too many **rows** (50M+) | Table has too many **columns** (30+) |
| Data has a natural time range | Columns have different access patterns |
| You need instant data retention (DROP old partition) | Some columns are read every request, others rarely |
| Query always filters by time or region | Different processes own different column groups |
