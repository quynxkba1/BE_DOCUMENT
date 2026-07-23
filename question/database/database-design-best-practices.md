# Database Design Best Practices for Backend Developers

> A practical, production-oriented guide synthesizing normalization theory, naming conventions, indexing strategy, security, and common pitfalls.

---

## Table of Contents

1. [The Full Design Process](#1-the-full-design-process)
2. [Normalization Rules](#2-normalization-rules)
3. [Naming Conventions](#3-naming-conventions)
4. [Primary Keys & Foreign Keys](#4-primary-keys--foreign-keys)
5. [Indexing Strategy](#5-indexing-strategy)
6. [Data Integrity & Constraints](#6-data-integrity--constraints)
7. [Security & Access Control](#7-security--access-control)
8. [Timezone & Date Handling](#8-timezone--date-handling)
9. [Performance & When to Denormalize](#9-performance--when-to-denormalize)
10. [Common Pitfalls](#10-common-pitfalls)
11. [Pre-Launch Checklist](#11-pre-launch-checklist)

---

## 1. The Full Design Process

Follow this sequence **every time** you design a new database or a significant new feature.

```
Requirements → ERD → Normalization → Physical Design → Indexing → Security → Test → Document → Deploy → Monitor
```

### Step 1 — Gather Requirements

Collect every piece of information the system must store before touching a schema editor.

- What data is created, read, updated, and deleted?
- What are the read/write ratios? (read-heavy → optimize for queries; write-heavy → keep writes cheap)
- What are the volume expectations? (rows per day, total dataset size in 1 year)
- What are the SLA requirements? (acceptable query latency, uptime)
- Who are the consumers? (frontend, internal services, analytics, third-party APIs)

> **Rule:** Never design a schema before you can answer all of the above. A schema designed without requirements will need to be redesigned.

### Step 2 — Identify Entities & Attributes

An **entity** is a real-world object the system needs to track. An **attribute** is a property of that entity.

- List all nouns from the requirements document — these are candidates for entities.
- Group attributes that naturally belong together.
- Identify which attributes are mandatory vs. optional.

```
Entity: User
Attributes: id, email, password_hash, full_name, created_at, updated_at

Entity: Order
Attributes: id, user_id, total_amount, status, placed_at

Entity: Product
Attributes: id, name, description, price, stock_quantity
```

### Step 3 — Define Relationships

Map how entities relate to each other. Use ERD diagrams (draw.io, dbdiagram.io, Lucidchart).

| Relationship | Example | Implementation |
|---|---|---|
| One-to-One (1:1) | User ↔ Profile | Foreign key on either side |
| One-to-Many (1:N) | User → Orders | Foreign key on the "many" side |
| Many-to-Many (N:N) | Products ↔ Orders | Junction/bridge table |

> **Rule:** Every many-to-many relationship needs a **junction table** with its own primary key plus both foreign keys.

### Step 4 — Create Tables & Primary Keys

Each entity becomes a table. Every table must have a primary key.

### Step 5 — Add Foreign Keys

Link tables through foreign keys. Always define the FK constraint in the DDL — do not rely on the application layer to enforce referential integrity.

### Step 6 — Normalize (see Section 2)

Apply normalization rules to eliminate redundancy and anomalies. Target: **3NF** for most systems.

### Step 7 — Plan Indexes (see Section 5)

Add indexes after normalization is complete, not before.

### Step 8 — Apply Security (see Section 7)

Define user roles, permissions, and encryption requirements.

### Step 9 — Test with Real Queries

Run your most frequent and most complex production queries against the schema before launch. Use `EXPLAIN ANALYZE` to verify query plans.

### Step 10 — Document

Write an ERD, a data dictionary (table + column descriptions), and any non-obvious business rules.

### Step 11 — Deploy & Monitor

Track slow queries, table sizes, index usage, and connection pool saturation in production.

---

## 2. Normalization Rules

Normalization is the process of structuring tables to reduce redundancy and prevent update/insert/delete anomalies. Each normal form **builds on the previous** — you cannot skip levels.

> **Production target: 3NF.** Go higher only when you have a specific, identified problem.

---

### 1NF — First Normal Form

**Rule:** Every column must hold a **single atomic value**. No arrays, no comma-separated lists, no repeated column groups.

**Violation:**
```
students(id, name, courses)
1, "Alice", "Math, Science, History"   ← NOT atomic
```

**Fix — separate the multi-value into its own table:**
```
students(id, name)
student_courses(student_id, course_name)  ← junction table
```

**Additional 1NF requirements:**
- Each row must be uniquely identifiable (primary key exists)
- No duplicate rows

---

### 2NF — Second Normal Form

**Rule:** Achieve 1NF + **no partial dependencies**. Every non-key attribute must depend on the **entire** primary key, not just part of it.

This only applies when the primary key is **composite** (multiple columns).

**Violation:**
```
order_items(order_id, product_id, product_name, quantity, unit_price)
PK = (order_id, product_id)

product_name depends only on product_id → partial dependency
```

**Fix:**
```
products(product_id, product_name, ...)
order_items(order_id, product_id, quantity, unit_price)
```

---

### 3NF — Third Normal Form

**Rule:** Achieve 2NF + **no transitive dependencies**. A non-key attribute must not depend on another non-key attribute.

**Violation:**
```
employees(id, name, department_id, department_name, department_location)

department_name depends on department_id, not on id → transitive dependency
```

**Fix:**
```
departments(department_id, department_name, department_location)
employees(id, name, department_id)  ← FK to departments
```

---

### BCNF — Boyce-Codd Normal Form

**Rule:** Achieve 3NF + **only keys may determine other attributes**. A non-key attribute cannot be a determinant.

Use BCNF when 3NF still allows anomalies due to overlapping candidate keys.

---

### 4NF — Fourth Normal Form

**Rule:** Achieve BCNF + **no more than one independent multi-valued dependency** per table.

**Violation:**
```
franchisee_data(franchisee_id, book_title, location)

franchisee_id →→ book_title   (independent)
franchisee_id →→ location     (independent)
```

**Fix:**
```
franchisee_books(franchisee_id, book_title)
franchisee_locations(franchisee_id, location)
```

---

### 5NF & 6NF

| Form | When to Use |
|---|---|
| 5NF | Tables that can be decomposed into smaller tables and rejoined without loss — split them |
| 6NF | Temporal/audit data where each table has PK + exactly one non-key attribute |

> **Rule:** 5NF+ is theoretical for most CRUD applications. Apply only when you have a documented, measurable reason.

---

### Normalization Decision Tree

```
Does any column contain multiple values?
  YES → Fix to 1NF first

Is the PK composite AND does any non-key column depend on only part of it?
  YES → Fix to 2NF

Does any non-key column depend on another non-key column?
  YES → Fix to 3NF

Still have anomalies with overlapping candidate keys?
  YES → Apply BCNF

Does one entity record two independent multi-valued facts?
  YES → Apply 4NF

→ STOP HERE for most applications
```

---

## 3. Naming Conventions

Consistent naming is not a style preference — it is a **structural contract** that makes schemas queryable, reviewable, and maintainable by any developer.

### General Rules

| Rule | Good | Bad |
|---|---|---|
| Use lowercase only | `user_id` | `UserID`, `USERID` |
| Use underscores as separators | `created_at` | `createdAt`, `created-at` |
| No spaces | `order_status` | `order status` |
| No dots | `user_name` | `user.name` |
| No special characters | `phone_number` | `phone#` |
| Use English | `user_name` | `ten_nguoi_dung` |

> **Why no dots?** Dots are hierarchy separators in SQL: `database.schema.table.column`. A dot in a column name breaks this convention and forces ugly quoting everywhere.
>
> **Why no spaces?** Every framework and ORM that uses spaces in identifiers requires quoted raw SQL — you lose all the nice helper syntax.
>
> **Why no uppercase?** Different databases handle case differently. PostgreSQL folds unquoted identifiers to lowercase. MySQL on case-insensitive filesystems is inconsistent. Lowercase everywhere removes the ambiguity.

### Tables

- Use **plural nouns**: `users`, `orders`, `products`
- Use **snake_case**: `order_items`, `user_sessions`
- Junction tables: combine both entity names alphabetically: `product_categories`, `user_roles`

### Columns

- Use **snake_case**: `first_name`, `created_at`
- Primary key: always `id` (or `{table_singular}_id` if needed for clarity in joins)
- Foreign keys: `{referenced_table_singular}_id` → `user_id`, `product_id`, `order_id`
- Boolean columns: prefix with `is_` or `has_`: `is_active`, `has_verified_email`
- Timestamps: use `_at` suffix: `created_at`, `updated_at`, `deleted_at`
- Status enums: use `_status` suffix: `order_status`, `payment_status`

### Indexes

- Pattern: `idx_{table}_{columns}`: `idx_orders_user_id`, `idx_users_email`
- Unique indexes: `uq_{table}_{columns}`: `uq_users_email`

### Foreign Key Constraints

- Pattern: `fk_{child_table}_{parent_table}`: `fk_orders_users`

### Avoid These Naming Mistakes

```sql
-- BAD: reserved words as column names
SELECT type, status, order FROM users;

-- GOOD: avoid SQL reserved words
SELECT user_type, account_status FROM users;

-- BAD: vague names
SELECT d1, temp, val FROM orders;

-- GOOD: self-documenting names
SELECT discount_amount, temp_hold_until, total_amount FROM orders;
```

---

## 4. Primary Keys & Foreign Keys

### Primary Keys

**Prefer integer auto-increment over UUID for most cases.**

| | Integer PK | UUID |
|---|---|---|
| Storage | 4–8 bytes | 16 bytes |
| Index performance | Excellent (sequential inserts) | Poor (random inserts cause page splits) |
| Readability in queries | Easy | Hard |
| Distributed systems | Conflicts if merging DBs | Safe globally unique |
| Obfuscation | Low (sequential = guessable) | High |

**Rules:**
- Every table must have a primary key.
- Never use a business value as a PK (emails change, national IDs change, phone numbers change).
- Use `BIGINT` (`BIGSERIAL` in PostgreSQL) for tables expected to grow large.
- Use UUID only when you need globally unique IDs across distributed databases or need to obscure sequential IDs in public APIs.

```sql
-- Recommended default
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Use UUID when globally unique or public-facing IDs needed
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id)
);
```

### Foreign Keys

**Always define FK constraints in DDL — never rely solely on application code.**

```sql
-- Correct: constraint enforced at the database level
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**ON DELETE behavior — choose deliberately:**

| Option | Behavior | Use When |
|---|---|---|
| `RESTRICT` | Block delete of parent if children exist | Default safe choice |
| `CASCADE` | Delete children when parent is deleted | Children have no meaning without parent (e.g., order_items when order deleted) |
| `SET NULL` | Set FK to NULL when parent deleted | Child can exist independently (e.g., assigned_user_id on a ticket) |
| `NO ACTION` | Like RESTRICT but deferred | Rarely needed |

> **Rule:** Default to `RESTRICT`. Use `CASCADE` only when you consciously want cascading deletes and have documented the behavior.

---

## 5. Indexing Strategy

Indexes speed up reads but slow down writes and consume storage. Add them **after normalization**, based on actual query patterns.

### When to Always Add an Index

1. **Every primary key** (automatic in most databases)
2. **Every foreign key column** — joins on unindexed FKs cause full table scans
3. **Every column used in WHERE clauses frequently**
4. **Every column used in ORDER BY or GROUP BY on large tables**
5. **Columns used in JOIN conditions**

```sql
-- Index on FK (critical for join performance)
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- Index on frequently filtered column
CREATE INDEX idx_orders_status ON orders(order_status);

-- Composite index: column order matters — put most selective first
CREATE INDEX idx_orders_user_status ON orders(user_id, order_status);

-- Unique index = constraint + performance
CREATE UNIQUE INDEX uq_users_email ON users(email);
```

### Composite Index Column Order

The **leftmost prefix rule** applies: a composite index on `(A, B, C)` can serve queries filtering on:
- `A`
- `A, B`
- `A, B, C`

But **not** on `B` alone or `C` alone.

```sql
-- This index:
CREATE INDEX idx_orders_composite ON orders(user_id, order_status, placed_at);

-- Serves these queries:
WHERE user_id = 1
WHERE user_id = 1 AND order_status = 'pending'
WHERE user_id = 1 AND order_status = 'pending' AND placed_at > '2024-01-01'

-- Does NOT efficiently serve:
WHERE order_status = 'pending'   -- user_id missing from prefix
```

### When NOT to Add an Index

- Columns with **very low cardinality** (e.g., `is_active` boolean on a mostly-active table) — the planner may skip it anyway
- Tables with **fewer than ~10,000 rows** — full scan is often faster
- Columns that are **rarely queried**
- Do **not** index every column "just in case" — each index adds write overhead

### Index Maintenance Rules

- Run `EXPLAIN ANALYZE` on slow queries before adding an index.
- Periodically audit unused indexes (`pg_stat_user_indexes` in PostgreSQL).
- Drop indexes that are never used — they only slow down writes.
- Consider **partial indexes** for filtered queries:

```sql
-- Only index active users — much smaller index
CREATE INDEX idx_users_active_email ON users(email) WHERE is_active = true;
```

---

## 6. Data Integrity & Constraints

**Never rely on the application layer alone to enforce data rules. The database is the last line of defense.**

### Constraint Types

```sql
CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,

  -- NOT NULL: mandatory fields
  name VARCHAR(255) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,

  -- UNIQUE: business uniqueness
  sku VARCHAR(100) NOT NULL UNIQUE,

  -- CHECK: domain validation
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),

  -- DEFAULT: safe fallback values
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Rules

- Mark columns `NOT NULL` unless NULL has a deliberate meaning distinct from empty/zero.
- Use `CHECK` constraints for domain rules (price >= 0, status IN ('active','inactive')).
- Use `UNIQUE` constraints for business identifiers (email, SKU, slug).
- Use `DEFAULT` values to prevent accidental NULL insertion on optional fields.
- Avoid storing derived data that can be computed from other columns — it creates consistency risk.

### Soft Delete Pattern

When you need to "delete" records but retain history:

```sql
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;

-- Query active records
SELECT * FROM users WHERE deleted_at IS NULL;

-- Partial unique index respects soft-delete
CREATE UNIQUE INDEX uq_users_active_email ON users(email) WHERE deleted_at IS NULL;
```

---

## 7. Security & Access Control

### Principle of Least Privilege

Never let your application connect to the database as a superuser. Create dedicated roles with only the permissions they need.

```sql
-- Application user: read/write only
CREATE ROLE app_user WITH LOGIN PASSWORD 'strong_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Read-only user for analytics/reporting
CREATE ROLE readonly_user WITH LOGIN PASSWORD 'strong_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;

-- Migration user: can alter schema
CREATE ROLE migration_user WITH LOGIN PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE mydb TO migration_user;
```

### Sensitive Data

| Data Type | Rule |
|---|---|
| Passwords | **Never store plaintext.** Use bcrypt/argon2 with salt. |
| PII (emails, phone, SSN) | Encrypt at rest. Consider column-level encryption. |
| Payment data | Follow PCI-DSS. Do not store raw card numbers. |
| API keys / tokens | Store hashed, not plaintext. |
| Audit logs | Immutable — do not allow UPDATE/DELETE on log tables. |

### Additional Security Rules

- Rotate database credentials on a schedule; use secrets managers (AWS Secrets Manager, Vault).
- Enable SSL/TLS for all database connections.
- Restrict database host access by IP allowlist.
- Audit all schema changes — track who ran what DDL and when.
- Never expose database connection strings in source code or logs.

---

## 8. Timezone & Date Handling

### Rule: Always Store Timestamps in UTC

```sql
-- PostgreSQL: use TIMESTAMPTZ (timestamp with time zone)
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

-- MySQL: use DATETIME + explicit UTC insert
created_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
```

**Why UTC?**
- Eliminates daylight saving time bugs.
- Simplifies cross-region deployments.
- Makes time-based queries consistent regardless of server timezone.
- Convert to user's local timezone at the **presentation layer** (frontend or API response), never in the database.

### Date-Only vs Timestamp

```sql
-- For dates without time (birthdate, expiry date)
birth_date DATE NOT NULL

-- For events in time (created, modified, occurred)
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

## 9. Performance & When to Denormalize

### Start Normalized, Denormalize Deliberately

The correct order:
1. Design fully normalized schema (3NF)
2. Measure with production-like data and real queries
3. Identify specific bottlenecks with `EXPLAIN ANALYZE`
4. Denormalize **only the specific tables/columns causing issues**
5. Document why denormalization was applied

> **Never denormalize preemptively.** Premature denormalization adds complexity and data integrity risk without proven benefit.

### Common Denormalization Patterns

**Cached aggregates** — store computed counts to avoid expensive COUNT queries:
```sql
ALTER TABLE users ADD COLUMN order_count INT NOT NULL DEFAULT 0;
-- Update via trigger or application logic on each order insert/delete
```

**Redundant columns** — copy a frequently-joined value to avoid a join:
```sql
-- Instead of joining to users on every order query:
ALTER TABLE orders ADD COLUMN user_email VARCHAR(255);
-- Accept: email updates must now sync in two places
```

**Summary tables / materialized views** — pre-compute analytics aggregations:
```sql
CREATE MATERIALIZED VIEW daily_revenue AS
  SELECT DATE(placed_at) AS day, SUM(total_amount) AS revenue
  FROM orders WHERE status = 'completed'
  GROUP BY DATE(placed_at);
```

### DISTINCT is a Code Smell

`DISTINCT` is almost always masking a bad join or schema problem.

```sql
-- This suggests the join is producing duplicate rows → fix the schema or query
SELECT DISTINCT user_id FROM orders JOIN order_items ON ...

-- Instead: identify why duplicates appear and fix the root cause
```

---

## 10. Common Pitfalls

### Design Pitfalls

| Pitfall | Problem | Fix |
|---|---|---|
| Using business values as PK | Email/phone changes break FK chains | Use surrogate integer PK |
| Storing multiple values in one column | Breaks 1NF, impossible to index/query | Separate table or JSON only for unstructured data |
| EAV (Entity-Attribute-Value) tables | Kills query performance and type safety | Proper columns or JSONB |
| Nullable FK without meaning | Ambiguous: is it missing or intentionally empty? | Clarify and document every nullable column |
| Missing FK constraints | Orphaned rows, data corruption | Always declare FK constraints |
| Over-indexing | Slows writes, wastes disk | Index only what you measure as slow |
| Storing timezone-naive timestamps | DST bugs, cross-region inconsistency | Always use TIMESTAMPTZ / UTC |

### Query Pitfalls

```sql
-- BAD: function on indexed column breaks the index
WHERE YEAR(created_at) = 2024

-- GOOD: range query uses the index
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01'

-- BAD: leading wildcard prevents index use
WHERE name LIKE '%smith%'

-- GOOD: trailing wildcard uses index
WHERE name LIKE 'smith%'

-- BAD: implicit type cast breaks index
WHERE user_id = '123'   -- user_id is BIGINT, '123' is VARCHAR

-- GOOD: match the column type
WHERE user_id = 123
```

### Anti-Patterns to Avoid

- **God table** — one table with 80+ columns covering multiple entities. Split it.
- **Polymorphic associations** — one FK column pointing to multiple tables based on a `type` column. Use proper FK constraints per table.
- **No audit trail** — for any table that stores important business state, add `created_at`, `updated_at`, and optionally `created_by`, `updated_by`.
- **Storing passwords or secrets in plaintext** — this is a critical security vulnerability.

---

## 11. Pre-Launch Checklist

Use this before deploying any new schema to production.

### Schema Design
- [ ] Every table has a primary key
- [ ] No column contains multiple values (1NF satisfied)
- [ ] No partial dependencies on composite keys (2NF satisfied)
- [ ] No transitive dependencies between non-key columns (3NF satisfied)
- [ ] All FK constraints are declared in DDL
- [ ] ON DELETE behavior is documented and intentional
- [ ] Soft-delete pattern applied where needed

### Naming & Conventions
- [ ] All identifiers are lowercase with underscores
- [ ] No reserved words used as identifiers
- [ ] FK columns follow `{table_singular}_id` pattern
- [ ] Timestamp columns use `_at` suffix
- [ ] Boolean columns use `is_` or `has_` prefix

### Indexes
- [ ] Every FK column has an index
- [ ] Frequently queried/filtered columns are indexed
- [ ] No redundant or duplicate indexes
- [ ] Composite index column order matches query patterns
- [ ] `EXPLAIN ANALYZE` run on all critical queries

### Data Integrity
- [ ] `NOT NULL` applied on all mandatory columns
- [ ] `UNIQUE` constraints on all business identifiers
- [ ] `CHECK` constraints for domain rules (prices >= 0, etc.)
- [ ] `DEFAULT` values set where appropriate

### Security
- [ ] Application connects as a least-privilege role (not superuser)
- [ ] Passwords stored as hashed values (bcrypt/argon2)
- [ ] PII columns encrypted or masked
- [ ] SSL/TLS enabled on database connection
- [ ] No credentials in source code

### Timestamps & Timezones
- [ ] All timestamps stored in UTC
- [ ] `TIMESTAMPTZ` (or equivalent) used for time-aware columns
- [ ] `DATE` type used for date-only values

### Documentation
- [ ] ERD diagram up to date
- [ ] Data dictionary written (table + column descriptions)
- [ ] Non-obvious business rules documented
- [ ] Migration scripts reviewed and tested on staging

---

## Quick Reference

```
Normalization target:    3NF for OLTP, consider denorm only after measuring
Primary key type:        BIGSERIAL (integer) by default; UUID for distributed/public APIs
Naming style:            lowercase_snake_case everywhere
Timestamps:              Always UTC, always TIMESTAMPTZ
FK constraints:          Always declare in DDL, default ON DELETE RESTRICT
Index rule:              Every FK gets an index; add others based on EXPLAIN ANALYZE
Security:                Least privilege roles; hash passwords; encrypt PII
DISTINCT in queries:     Treat as a schema smell — find and fix the root cause
Denormalization:         Measure first, denormalize last, document always
```
