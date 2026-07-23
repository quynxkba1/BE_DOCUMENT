# Query Workflow With And Without An Index

This document explains what happens when a database executes a query.

Example query:

```sql
SELECT *
FROM users
WHERE email = 'alice@example.com';
```

---

## Without An Index

If `users.email` has no index, the database may perform a full table scan.

```text
Client sends query
  -> database parses SQL
  -> database plans execution
  -> no useful index found
  -> scan users table row by row
  -> compare each row's email
  -> return matching rows
```

Step by step:

```text
users table

row 1: email = bob@example.com       no match
row 2: email = chris@example.com     no match
row 3: email = alice@example.com     match
row 4: email = david@example.com     no match
...
```

This can be expensive for large tables because the database has to inspect many rows.

---

## With An Index

Create an index:

```sql
CREATE INDEX idx_users_email ON users(email);
```

Now the query workflow can change:

```text
Client sends query
  -> database parses SQL
  -> database plans execution
  -> useful index found: idx_users_email
  -> search index for alice@example.com
  -> index points to matching row location
  -> database reads matching row
  -> return matching rows
```

The index acts like a lookup table:

```text
idx_users_email

alice@example.com -> row id 3
bob@example.com   -> row id 1
chris@example.com -> row id 2
```

The database can jump closer to the target rows instead of scanning the whole table.

---

## What Happens On Insert

Indexes also affect writes.

When inserting a new user:

```sql
INSERT INTO users (name, email)
VALUES ('Alice', 'alice@example.com');
```

The database must update:

```text
1. the users table
2. the email index
```

So writes do more work when indexes exist.

---

## What Happens On Update

If the indexed column changes:

```sql
UPDATE users
SET email = 'alice.new@example.com'
WHERE id = 3;
```

The database must update:

```text
1. the users table row
2. the old email entry in the index
3. the new email entry in the index
```

This is why indexes improve reads but slow down some writes.

---

## Composite Index Workflow

Composite index:

```sql
CREATE INDEX idx_orders_user_id_created_at
ON orders(user_id, created_at);
```

Good query:

```sql
SELECT *
FROM orders
WHERE user_id = 123
ORDER BY created_at DESC;
```

Workflow:

```text
1. Find all index entries for user_id = 123.
2. Use created_at order from the index.
3. Read matching order rows.
```

This works well because the query uses the index from left to right:

```text
(user_id, created_at)
```

Less useful query:

```sql
SELECT *
FROM orders
WHERE created_at > '2026-01-01';
```

The index starts with `user_id`, but the query does not filter by `user_id`.

Depending on the database, this index may not help much for that query.

---

## Query Planner

The database does not blindly use every index.

It uses a query planner to estimate the cheapest plan.

Possible plans:

```text
Full table scan
Index scan
Index seek
Bitmap index scan
Join using index
Sort using index
```

The planner may ignore an index if it thinks scanning the table is cheaper.

Example:

```sql
SELECT *
FROM users
WHERE is_active = true;
```

If almost every user is active, reading the index and then reading most table rows may be slower than scanning the table once.

---

## How To Check Index Usage

Use `EXPLAIN`:

```sql
EXPLAIN
SELECT *
FROM users
WHERE email = 'alice@example.com';
```

Use `EXPLAIN ANALYZE` when you want actual runtime details:

```sql
EXPLAIN ANALYZE
SELECT *
FROM users
WHERE email = 'alice@example.com';
```

Look for terms like:

```text
Index Scan
Index Seek
Seq Scan
Table Scan
```

Names vary by database engine.

---

## Short Summary

```text
Without index:
  database may scan many rows

With index:
  database can use lookup structure to find rows faster

Tradeoff:
  faster reads, slower writes, extra storage
```

