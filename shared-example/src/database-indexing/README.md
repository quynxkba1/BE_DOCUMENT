# Database Indexing

Database indexing is a technique for making database queries faster.

An index is a separate lookup structure that points to rows in a table. It helps the database find matching rows without scanning the whole table.

---

## Simple Mental Model

Imagine a book.

Without an index:

```text
To find "Redis", read every page until you find it.
```

With an index:

```text
Look up "Redis" in the index at the back of the book.
Jump directly to the pages where it appears.
```

A database index works in a similar way.

---

## Query Without Index

Example table:

```sql
users
-----
id
name
email
created_at
```

Query:

```sql
SELECT *
FROM users
WHERE email = 'alice@example.com';
```

If there is no index on `email`, the database may do a full table scan:

```text
row 1      check email
row 2      check email
row 3      check email
...
row 999999 check email
```

This is slow when the table is large.

---

## Query With Index

Create an index:

```sql
CREATE INDEX idx_users_email ON users(email);
```

Now the database can use the index:

```text
email index
  alice@example.com -> row id 123
```

The database can jump directly to the matching row instead of checking every row.

---

## What Indexes Are Good For

Indexes help when queries filter, join, sort, or enforce uniqueness.

Common cases:

```sql
-- Find one user by email
SELECT *
FROM users
WHERE email = 'alice@example.com';

-- Find orders for one user
SELECT *
FROM orders
WHERE user_id = 123;

-- Find recent orders for one user
SELECT *
FROM orders
WHERE user_id = 123
ORDER BY created_at DESC;

-- Join orders to users
SELECT *
FROM orders
JOIN users ON users.id = orders.user_id;
```

---

## Common Index Examples

### Single-column index

```sql
CREATE INDEX idx_users_email ON users(email);
```

Useful for:

```sql
SELECT *
FROM users
WHERE email = 'alice@example.com';
```

### Unique index

```sql
CREATE UNIQUE INDEX idx_users_email_unique ON users(email);
```

Useful when each value must be unique.

Example:

```text
Two users cannot have the same email.
```

### Composite index

```sql
CREATE INDEX idx_orders_user_id_created_at
ON orders(user_id, created_at);
```

Useful for:

```sql
SELECT *
FROM orders
WHERE user_id = 123
ORDER BY created_at DESC;
```

Composite index order matters.

This index:

```sql
(user_id, created_at)
```

is good when the query filters by `user_id` first.

---

## When Indexes Do Not Help Much

Indexes are not magic.

They may not help when:

- the table is very small
- the query returns most rows in the table
- the indexed column has very low selectivity
- the query applies a function to the indexed column
- the query filters using a different column order than the composite index supports

Example of low selectivity:

```sql
SELECT *
FROM users
WHERE is_active = true;
```

If 95% of users are active, the index may not help much because the database still needs to read most rows.

Example where a function can block index usage:

```sql
SELECT *
FROM users
WHERE LOWER(email) = 'alice@example.com';
```

The normal index on `email` may not be used because the query transforms the column before comparing it.

---

## Tradeoffs

Indexes improve reads, but they cost something.

| Benefit | Cost |
|---|---|
| Faster `WHERE` queries | Slower `INSERT` |
| Faster joins | Slower `UPDATE` on indexed columns |
| Faster sorting | Slower `DELETE` |
| Enforce uniqueness | More disk space |

Why writes become slower:

```text
When inserting a row, the database must update the table and every related index.
```

Too many indexes can hurt write-heavy systems.

---

## Interview Answer

Use this short answer:

> A database index is a separate data structure that helps the database find rows faster without scanning the entire table. It improves read performance for filtering, joining, and sorting, but it adds storage cost and makes writes slower because indexes must be maintained.

Then add an example:

```sql
CREATE INDEX idx_users_email ON users(email);
```

This helps:

```sql
SELECT *
FROM users
WHERE email = 'alice@example.com';
```

---

## Practical Rule

Create indexes based on real queries, not guesses.

Good process:

```text
1. Find slow query.
2. Check WHERE, JOIN, ORDER BY columns.
3. Run EXPLAIN / EXPLAIN ANALYZE.
4. Add a targeted index.
5. Measure again.
```

