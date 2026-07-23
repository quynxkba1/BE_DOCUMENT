# Index Types

---

## B-tree (default)

Supports: `=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `IN`, `LIKE 'prefix%'`

Does NOT support: `LIKE '%suffix'` (leading wildcard kills sort order).

```sql
CREATE INDEX ON users (age);

SELECT * FROM users WHERE age = 25;              -- ✓
SELECT * FROM users WHERE age BETWEEN 20 AND 30; -- ✓
SELECT * FROM users WHERE age > 18;              -- ✓
SELECT * FROM users WHERE LOWER(name) = 'alice'; -- ✗ (expression, not raw column)
```

---

## Hash index

Supports only `=` (exact equality). Faster than B-tree for pure equality, useless for ranges.

```sql
CREATE INDEX idx_users_id_hash ON users USING HASH (id);

SELECT * FROM users WHERE id = 42;  -- ✓
SELECT * FROM users WHERE id > 42;  -- ✗ cannot use hash index
```

In practice, B-tree is almost always used because it handles both equality and range.

---

## Composite index

Index on two or more columns. Column order determines which queries benefit.

```sql
CREATE INDEX idx_orders_user_date ON orders (user_id, created_at);
```

Think of it as a phone book — sorted first by last name, then first name within the same last name.

**Leftmost prefix rule** — index `(A, B, C)` helps queries on `A`, `A+B`, or `A+B+C`. Not `B` alone or `C` alone.

| Query | Uses index? | Why |
|---|---|---|
| `WHERE user_id = 5 AND created_at > '2025-01-01'` | YES | Leading column first |
| `WHERE user_id = 5` | YES | Leading column alone |
| `WHERE created_at > '2025-01-01'` | NO | Missing leading column |

```sql
CREATE INDEX ON orders (user_id, status, created_at);

WHERE user_id = 5                                       -- ✓
WHERE user_id = 5 AND status = 'pending'                -- ✓
WHERE user_id = 5 AND status = 'pending'
  AND created_at > '2025-01-01'                         -- ✓
WHERE status = 'pending'                                -- ✗ missing user_id
```

---

## Partial index

Indexes only rows matching a condition. Smaller, faster, less storage.

```sql
-- 95% of orders are 'completed'. Workers only query pending.
CREATE INDEX idx_orders_pending ON orders (created_at)
WHERE status = 'pending';

SELECT * FROM orders
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour'; -- ✓ uses partial index

SELECT * FROM orders
WHERE status = 'completed' AND created_at < NOW() - INTERVAL '1 day'; -- ✗ does not use it
```

---

## Covering index (INCLUDE)

Stores extra columns inside the index — the DB never needs to touch the main table (no heap fetch).

```sql
-- Without INCLUDE: DB reads index → follows pointer to heap → fetches status, amount
-- With INCLUDE: DB reads index only — status and amount stored inside the index
CREATE INDEX idx_orders_user_covering ON orders (user_id) INCLUDE (status, amount);

-- EXPLAIN shows: Index Only Scan (no heap access)
SELECT status, amount FROM orders WHERE user_id = 5;
```

---

## Expression index

For queries that apply a function to a column before comparing.

```sql
CREATE INDEX idx_users_lower_email ON users (LOWER(email));

-- Now uses the index ✓
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
```

---

## BRIN index (Block Range Index)

Stores min/max values per physical disk page range instead of per row. Very small index for sequential data.

```sql
CREATE INDEX idx_events_block ON swap_events USING BRIN (block_number);
```

Best for: columns that are always increasing (block numbers, auto-increment IDs, timestamps written in order). Useless for random data. Used by The Graph protocol for blockchain data.

---

## EXPLAIN — verifying index usage

```sql
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';
```

**Without index (Seq Scan):**
```
Seq Scan on users  (cost=0.00..2890.00 rows=1 width=50)
  Filter: (email = 'alice@example.com')
```

**With index (Index Scan):**
```
Index Scan using idx_users_email on users  (cost=0.43..8.45 rows=1 width=50)
  Index Cond: (email = 'alice@example.com')
```

| Term | Meaning |
|---|---|
| `Seq Scan` | Full table scan — no index used |
| `Index Scan` | Index used, then heap fetched for full row |
| `Index Only Scan` | Index used, no heap fetch (covering index) |
| `Bitmap Index Scan` | Index used for multiple rows, heap fetched in bulk |

**Q: Index exists but query still does Seq Scan — why?**

- Query returns large % of rows (e.g. 90% are `active`) — full scan is cheaper
- Stale statistics — run `ANALYZE table_name`
- Index type doesn't support the operation (Hash on range query)
