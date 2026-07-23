# Answers — Database Fundamentals

---

## 1. What is the difference between SQL and NoSQL?

### SQL (Relational databases)

Data is stored in **tables** with predefined columns and types. Rows relate to rows in other tables via foreign keys. Schema is enforced — you cannot insert a row with an unknown column.

Examples: PostgreSQL, MySQL, SQLite, MS SQL Server.

```sql
-- Structured, typed, relational
CREATE TABLE users (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL
);
```

### NoSQL (Non-relational databases)

Data is stored in flexible formats: documents (JSON), key-value pairs, wide columns, or graphs. No fixed schema — documents in the same collection can have different fields.

Examples: MongoDB (document), Redis (key-value), Cassandra (wide column), Neo4j (graph).

```json
// MongoDB document — no fixed schema required
{ "_id": "abc", "name": "Alice", "preferences": { "theme": "dark" } }
{ "_id": "def", "name": "Bob" }   // preferences field simply missing
```

### Comparison

| | SQL | NoSQL |
|---|---|---|
| Schema | Fixed, enforced | Flexible / schema-less |
| Consistency | ACID by default | Often eventual consistency |
| Relationships | Foreign keys, JOINs | Embedded documents or application-level joins |
| Scaling | Vertical (bigger server) | Horizontal (more servers) |
| Query language | SQL (standardized) | Varies by DB |
| Best for | Financial data, e-commerce, reporting | Social feeds, logs, real-time analytics, caching |

### When to choose which

| Use case | Recommended |
|---|---|
| Banking / payments — strong consistency required | PostgreSQL |
| User profiles with variable attributes | MongoDB |
| Session storage / rate limiting | Redis |
| Product catalog with complex queries and joins | PostgreSQL |
| Activity feeds, time-series events | Cassandra / DynamoDB |
| Social graph (who follows whom) | Neo4j |

### Follow-up Q&A

**Q: Can NoSQL databases be consistent?**

Yes. MongoDB has supported multi-document ACID transactions since version 4.0. Consistency guarantees depend on configuration. The assumption that NoSQL = eventual consistency is outdated for many modern NoSQL databases.

**Q: What is the CAP theorem?**

CAP states that a distributed system can guarantee at most 2 of 3 properties:
- **Consistency** — every read returns the latest write.
- **Availability** — every request receives a response (not necessarily the latest data).
- **Partition tolerance** — the system keeps running even when network partitions occur.

In practice, partition tolerance is mandatory for distributed systems, so the real trade-off is between Consistency and Availability (CP vs AP).

**Q: When would you choose Redis over PostgreSQL?**

Redis is in-memory and extremely fast (sub-millisecond reads/writes). Use Redis for caching, session storage, rate limiting counters, pub/sub messaging, and leaderboards. Use PostgreSQL for durable, relational, transactional data.

---

## 2. What are ACID properties?

ACID is a set of guarantees that database transactions must satisfy to be reliable.

### Bank transfer example: move $100 from Alice to Bob

```sql
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE user_id = 'alice';
  UPDATE accounts SET balance = balance + 100 WHERE user_id = 'bob';
COMMIT;
```

### Atomicity

**All operations in a transaction succeed, or none of them do. No partial state.**

If the server crashes after debiting Alice but before crediting Bob, the entire transaction is rolled back. Alice does not lose $100.

### Consistency

**A transaction brings the database from one valid state to another valid state.**

Business rules and constraints are never violated. If a constraint says `balance >= 0`, a transaction that would make Alice's balance negative is rejected entirely.

### Isolation

**Concurrent transactions do not see each other's intermediate state.**

If Alice and Bob are both transferring money at the same time, one transaction does not see the half-written state of the other. The final result is as if the transactions ran one after another.

Isolation levels (from weakest to strongest):
| Level | Problem prevented |
|---|---|
| Read Uncommitted | Nothing — can read uncommitted changes (dirty reads) |
| Read Committed | No dirty reads |
| Repeatable Read | No dirty reads, no non-repeatable reads |
| Serializable | Fully isolated — behaves as if transactions run sequentially |

Higher isolation = stronger guarantees but more lock contention and lower throughput.

### Durability

**Once committed, the transaction is permanent — it survives a crash.**

The database writes to a **Write-Ahead Log (WAL)** before confirming the commit. On recovery, uncommitted transactions are rolled back; committed ones are replayed from the log.

### Follow-up Q&A

**Q: What is a dirty read?**

Reading data that another transaction has written but not yet committed. If that transaction later rolls back, your read was based on data that never officially existed. Prevented by Read Committed isolation level and above.

**Q: What is a non-repeatable read?**

Reading the same row twice within the same transaction and getting different values because another transaction modified and committed it in between. Prevented by Repeatable Read isolation and above.

**Q: What is a phantom read?**

Running the same query twice and getting a different number of rows because another transaction inserted or deleted rows in between. Prevented only by Serializable isolation.

---

## 3. What is a JOIN? Explain INNER, LEFT, RIGHT JOIN.

A JOIN combines rows from two tables based on a related column.

### Source tables (used for all examples below)

**users**

| id | name    |
|----|---------|
| 1  | Alice   |
| 2  | Bob     |
| 3  | Charlie |

**orders**

| id | user_id | product |
|----|---------|---------|
| 10 | 1       | Laptop  |
| 11 | 1       | Phone   |
| 12 | 2       | Monitor |
| 13 | 999     | Tablet  |

- Alice has 2 orders (Laptop, Phone).
- Bob has 1 order (Monitor).
- Charlie has **no orders**.
- Order 13 (Tablet) has `user_id=999` which **does not exist** in users — it is an orphan.

The JOIN condition for all examples: `users.id = orders.user_id`

---

### INNER JOIN

**Rule:** only keep rows where a match is found **in both tables**. Rows with no match on either side are dropped.

```sql
SELECT users.name, orders.product
FROM users
INNER JOIN orders ON users.id = orders.user_id;
```

The database checks each `users` row against every `orders` row:

| users.id | users.name | orders.user_id | orders.product | Match? |
|----------|------------|----------------|----------------|--------|
| 1        | Alice      | 1              | Laptop         | YES    |
| 1        | Alice      | 1              | Phone          | YES    |
| 2        | Bob        | 2              | Monitor        | YES    |
| 3        | Charlie    | (none)         | (none)         | NO — dropped |
| (none)   | (none)     | 999            | Tablet         | NO — dropped |

**Result:**

| name  | product |
|-------|---------|
| Alice | Laptop  |
| Alice | Phone   |
| Bob   | Monitor |

Charlie is gone (no orders). Tablet is gone (no matching user). Only matched pairs survive.

---

### LEFT JOIN

**Rule:** keep **every row from the left table** (`users`). For rows that have no match in the right table, fill the right table's columns with `NULL`.

```sql
SELECT users.name, orders.product
FROM users
LEFT JOIN orders ON users.id = orders.user_id;
```

The database goes through each `users` row and tries to find a match:

| users.id | users.name | Match in orders?        | orders.product |
|----------|------------|-------------------------|----------------|
| 1        | Alice      | YES → order 10          | Laptop         |
| 1        | Alice      | YES → order 11          | Phone          |
| 2        | Bob        | YES → order 12          | Monitor        |
| 3        | Charlie    | NO match found          | **NULL**       |

**Result:**

| name    | product |
|---------|---------|
| Alice   | Laptop  |
| Alice   | Phone   |
| Bob     | Monitor |
| Charlie | NULL    |

Charlie is **kept** because it is in the left table. NULL fills in where orders data would be.
Tablet (user_id=999) is **not shown** because it is only in the right table and LEFT JOIN does not guarantee right-table rows.

#### Using LEFT JOIN to find users with NO orders

```sql
SELECT users.name
FROM users
LEFT JOIN orders ON users.id = orders.user_id
WHERE orders.id IS NULL;
```

After the LEFT JOIN, the full result looks like this:

| users.name | orders.id | orders.product |
|------------|-----------|----------------|
| Alice      | 10        | Laptop         |
| Alice      | 11        | Phone          |
| Bob        | 12        | Monitor        |
| Charlie    | **NULL**  | **NULL**       |

`WHERE orders.id IS NULL` keeps only rows where no match was found → **Charlie**.

**Result:**

| name    |
|---------|
| Charlie |

---

### RIGHT JOIN

**Rule:** keep **every row from the right table** (`orders`). For rows that have no match in the left table, fill the left table's columns with `NULL`.

It is the mirror image of LEFT JOIN — now `orders` is the "keeper".

```sql
SELECT users.name, orders.product
FROM users
RIGHT JOIN orders ON users.id = orders.user_id;
```

The database goes through each `orders` row and tries to find a match:

| orders.id | orders.user_id | orders.product | Match in users?       | users.name |
|-----------|----------------|----------------|------------------------|------------|
| 10        | 1              | Laptop         | YES → user 1 (Alice)  | Alice      |
| 11        | 1              | Phone          | YES → user 1 (Alice)  | Alice      |
| 12        | 2              | Monitor        | YES → user 2 (Bob)    | Bob        |
| 13        | 999            | Tablet         | NO match found         | **NULL**   |

**Result:**

| name  | product |
|-------|---------|
| Alice | Laptop  |
| Alice | Phone   |
| Bob   | Monitor |
| NULL  | Tablet  |

Tablet is **kept** because it is in the right table. NULL fills in where user data would be.
Charlie is **not shown** because Charlie is only in the left table and RIGHT JOIN does not guarantee left-table rows.

#### RIGHT JOIN is a flipped LEFT JOIN

These two queries return the same result:

```sql
-- RIGHT JOIN
SELECT users.name, orders.product
FROM users
RIGHT JOIN orders ON users.id = orders.user_id;

-- Equivalent: swap the tables, use LEFT JOIN
SELECT users.name, orders.product
FROM orders
LEFT JOIN users ON users.id = orders.user_id;
```

In practice, RIGHT JOIN is rarely used. Most developers always write LEFT JOIN and swap the table order when needed.

---

### FULL OUTER JOIN

**Rule:** keep **every row from both tables**. NULL fills in missing columns on whichever side has no match.

```sql
SELECT users.name, orders.product
FROM users
FULL OUTER JOIN orders ON users.id = orders.user_id;
```

**Result:**

| name    | product |
|---------|---------|
| Alice   | Laptop  |
| Alice   | Phone   |
| Bob     | Monitor |
| Charlie | NULL    |
| NULL    | Tablet  |

Charlie comes from the left table with no match. Tablet comes from the right table with no match. Nobody is dropped.

---

### All JOIN types compared on the same data

| JOIN type      | Alice/Laptop | Alice/Phone | Bob/Monitor | Charlie/NULL | NULL/Tablet |
|----------------|:---:|:---:|:---:|:---:|:---:|
| INNER JOIN     | ✓  | ✓  | ✓  | —  | —  |
| LEFT JOIN      | ✓  | ✓  | ✓  | ✓  | —  |
| RIGHT JOIN     | ✓  | ✓  | ✓  | —  | ✓  |
| FULL OUTER JOIN| ✓  | ✓  | ✓  | ✓  | ✓  |

**One-line rule for each:**

| JOIN | Keeps |
|---|---|
| INNER | Only matched rows |
| LEFT | All left rows + matched right rows |
| RIGHT | All right rows + matched left rows |
| FULL OUTER | All rows from both sides |

### Follow-up Q&A

**Q: Write a query to find all users who have never placed an order.**

```sql
SELECT users.name
FROM users
LEFT JOIN orders ON users.id = orders.user_id
WHERE orders.id IS NULL;
```

**Q: What is a self-join?**

Joining a table to itself. Common for hierarchical data.

```sql
-- Find employees and their managers (both in the same table)
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;
```

**Q: What is a CROSS JOIN?**

Produces the Cartesian product — every row from table A paired with every row from table B. A table with 100 rows cross-joined to a table with 100 rows returns 10,000 rows. Rarely used intentionally.

---

## 4. What is the difference between WHERE and HAVING?

Both filter rows, but they operate at **different stages** of query execution.

### Execution order

```
FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
```

- `WHERE` filters **individual rows** before grouping.
- `HAVING` filters **grouped results** after aggregation.

### Example

```sql
-- Count employees per department, but only show departments with more than 10 people,
-- and only count employees earning more than 50,000.

SELECT department, COUNT(*) AS headcount
FROM employees
WHERE salary > 50000          -- filters rows BEFORE grouping
GROUP BY department
HAVING COUNT(*) > 10;         -- filters groups AFTER aggregation
```

### WHERE with aggregates — this FAILS

```sql
-- WRONG: cannot use aggregate in WHERE
SELECT department, COUNT(*)
FROM employees
WHERE COUNT(*) > 10           -- ❌ error: aggregates not allowed in WHERE
GROUP BY department;
```

### Key rule

> Use `WHERE` to filter rows. Use `HAVING` to filter the result of an aggregate (`COUNT`, `SUM`, `AVG`, `MAX`, `MIN`).

### Follow-up Q&A

**Q: Can you use both WHERE and HAVING in the same query?**

Yes. They serve different purposes and can coexist.

```sql
SELECT department, AVG(salary) AS avg_salary
FROM employees
WHERE hire_date > '2020-01-01'     -- only consider employees hired after 2020
GROUP BY department
HAVING AVG(salary) > 70000;       -- only show departments with high average salary
```

**Q: Can you filter on an aliased column in HAVING?**

In standard SQL, you cannot use a SELECT alias in HAVING because HAVING is evaluated before SELECT. Some databases (MySQL, PostgreSQL) allow it as an extension.

---

## 5. What is an index in a database and why use it?

An index is a **separate data structure** that the database maintains alongside a table. It stores a sorted copy of one or more column values, each paired with a pointer to the actual row on disk. The database can use this structure to find rows without reading the entire table.

The real-world analogy: a book's index at the back. Instead of reading every page to find "PostgreSQL", you look it up alphabetically in the index and jump directly to page 142.

---

### The problem indexes solve: sequential scan

Imagine the `users` table has 5 million rows:

```
users table on disk (simplified):
page 1  → row 1:  id=1,  email='zara@...',   name='Zara'
page 1  → row 2:  id=2,  email='bob@...',    name='Bob'
page 1  → row 3:  id=3,  email='carol@...',  name='Carol'
...
page 40000 → row 5000000: id=5000000, email='alice@example.com', name='Alice'
```

Without an index:
```sql
SELECT * FROM users WHERE email = 'alice@example.com';
```

The database reads every single page — all 40,000 pages — until it finds the matching row. This is a **sequential scan (Seq Scan)**. Time complexity: **O(n)**.

On a table with 5 million rows, this can take seconds.

---

### How a B-tree index solves it

A B-tree (Balanced Tree) is the default index type. It stores column values in **sorted order** in a tree structure, where each node points to child nodes or to actual table rows.

```
B-tree index on users(email) — simplified:

                    [m]
                   /   \
            [a-l]         [n-z]
           /     \        /    \
       [a-f]  [g-l]  [n-s]  [t-z]
         |       |      |       |
      alice@  jan@   sam@   zara@
      → page  → page  → page  → page
        40000    120    8900     1
```

To find `alice@example.com`:
1. Start at the root — go left (a-l).
2. Go left again (a-f).
3. Find `alice@example.com` — points to page 40000, row offset 5.
4. Fetch that one page.

Instead of reading 40,000 pages, the DB reads ~3-4 index pages + 1 data page. Time complexity: **O(log n)**.

---

### How to create an index

#### Basic index

```sql
-- Syntax
CREATE INDEX index_name ON table_name (column_name);

-- Example: speed up login queries that filter by email
CREATE INDEX idx_users_email ON users (email);
```

Naming convention: `idx_<table>_<column(s)>` — not required but strongly recommended so you can identify indexes quickly.

#### Unique index

Enforces that every value in the column is unique AND creates an index for fast lookups.

```sql
CREATE UNIQUE INDEX idx_users_email ON users (email);

-- Inserting a duplicate email will now raise an error:
-- ERROR: duplicate key value violates unique constraint "idx_users_email"
```

Note: `UNIQUE` in a column definition (`email VARCHAR UNIQUE`) automatically creates a unique index behind the scenes. Explicit `CREATE UNIQUE INDEX` gives you more control (e.g. partial unique indexes).

#### Composite index (multiple columns)

```sql
-- Index on two columns together
CREATE INDEX idx_orders_user_date ON orders (user_id, created_at);
```

#### Partial index (index a subset of rows)

```sql
-- Only index pending orders — completed/cancelled orders are rarely looked up
CREATE INDEX idx_orders_pending ON orders (created_at)
WHERE status = 'pending';
```

#### Index on expression

```sql
-- Queries that use LOWER(email) can use this index
CREATE INDEX idx_users_email_lower ON users (LOWER(email));

-- Now this query uses the index:
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
```

#### Drop an index

```sql
DROP INDEX idx_users_email;
```

#### View existing indexes (PostgreSQL)

```sql
-- List all indexes on a table
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'users';
```

---

### What happens to indexes on write operations

Every index is a data structure that must stay in sync with the table. Every write operation — `INSERT`, `UPDATE`, `DELETE` — must also update every index on the affected columns.

#### INSERT

```sql
INSERT INTO users (email, name) VALUES ('dave@example.com', 'Dave');
```

1. Write new row to the table heap.
2. Find the correct position in the B-tree for `'dave@example.com'`.
3. Insert the new key into the B-tree and update pointers.
4. If the tree node is full, split the node (**page split** — expensive).

If the table has 5 indexes, step 2-4 runs 5 times.

#### UPDATE

```sql
UPDATE users SET email = 'david@example.com' WHERE id = 4;
```

If `email` is indexed:
1. Delete the old key `'dave@example.com'` from the B-tree.
2. Insert the new key `'david@example.com'` into the B-tree.

Updating an unindexed column costs nothing extra for the index.

#### DELETE

```sql
DELETE FROM users WHERE id = 4;
```

1. Remove the row from the heap.
2. Mark the key in the B-tree as deleted (it becomes a "dead tuple").

Dead tuples accumulate over time — this is **index bloat**. PostgreSQL's `VACUUM` process cleans them up.

#### Impact summary

| Operation | Table with 0 indexes | Table with 5 indexes |
|-----------|---------------------|---------------------|
| SELECT (indexed col) | Seq scan — slow | Index scan — fast |
| SELECT (non-indexed) | Seq scan | Seq scan (unchanged) |
| INSERT | Write 1 row | Write 1 row + update 5 indexes |
| UPDATE (indexed col) | Update row | Update row + rebuild key in each index |
| DELETE | Delete row | Delete row + mark dead in each index |

This is why you do not blindly add indexes to every column. Each index you add slows down writes.

---

### Types of indexes in detail

#### B-tree (default)

Supports: `=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `IN`, `LIKE 'prefix%'`

```sql
CREATE INDEX ON users (age);

SELECT * FROM users WHERE age = 25;           -- uses index ✓
SELECT * FROM users WHERE age BETWEEN 20 AND 30; -- uses index ✓
SELECT * FROM users WHERE age > 18;           -- uses index ✓
SELECT * FROM users WHERE LOWER(name) = 'alice'; -- does NOT use index ✗
                                                 -- (expression, not raw column)
```

Does NOT support: `LIKE '%suffix'` (leading wildcard kills the sort order).

#### Hash index

Supports only: `=` (exact equality). Faster than B-tree for pure equality lookups. Useless for ranges.

```sql
CREATE INDEX idx_users_id_hash ON users USING HASH (id);

SELECT * FROM users WHERE id = 42;   -- uses hash index ✓
SELECT * FROM users WHERE id > 42;   -- cannot use hash index ✗
```

In practice, B-tree is almost always used because it handles both equality and range queries.

#### Composite index

An index on two or more columns together. The column order determines which queries benefit.

```sql
CREATE INDEX idx_orders_user_date ON orders (user_id, created_at);
```

Think of it as a phone book sorted first by last name, then by first name within the same last name.

| Query | Uses index? | Why |
|---|---|---|
| `WHERE user_id = 5 AND created_at > '2025-01-01'` | YES | Both columns, leading column first |
| `WHERE user_id = 5` | YES | Leading column alone |
| `WHERE created_at > '2025-01-01'` | NO | Missing leading column `user_id` |

The **leftmost prefix rule**: a composite index on `(A, B, C)` can be used by queries filtering on `A`, `A+B`, or `A+B+C` — but not `B` alone or `C` alone.

```sql
CREATE INDEX ON orders (user_id, status, created_at);

WHERE user_id = 5                                  -- ✓ uses index (prefix: user_id)
WHERE user_id = 5 AND status = 'pending'           -- ✓ uses index (prefix: user_id, status)
WHERE user_id = 5 AND status = 'pending'
  AND created_at > '2025-01-01'                    -- ✓ uses index (full)
WHERE status = 'pending'                           -- ✗ missing leading column
WHERE status = 'pending' AND created_at > '...'   -- ✗ missing leading column
```

#### Partial index

Indexes only rows matching a condition. Smaller, faster, and uses less storage than a full index.

```sql
-- 95% of orders are 'completed'. Only 5% are 'pending'.
-- Workers only query pending orders. Index only those.
CREATE INDEX idx_orders_pending ON orders (created_at)
WHERE status = 'pending';

-- This query uses the partial index ✓
SELECT * FROM orders WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour';

-- This query does NOT use the partial index ✗
SELECT * FROM orders WHERE status = 'completed' AND created_at < NOW() - INTERVAL '1 day';
```

#### Covering index (INCLUDE)

A covering index stores extra columns inside the index so the DB never needs to touch the main table (called a **heap fetch**).

```sql
-- Query: find all orders for a user, return status and amount
SELECT status, amount FROM orders WHERE user_id = 5;

-- Without INCLUDE: DB reads index (user_id) → follows pointer to heap → fetches status, amount
-- With INCLUDE: DB reads index only — status and amount are stored right inside the index
CREATE INDEX idx_orders_user_covering ON orders (user_id) INCLUDE (status, amount);
```

The columns in `INCLUDE` are not sortable — they are just stored as extra payload. The index is larger but eliminates heap fetches for these queries.

---

### Choosing which column to index — practical rules

| Situation | Index? |
|---|---|
| Column used in `WHERE` clause frequently | YES |
| Column used in `JOIN ON` condition | YES |
| Column used in `ORDER BY` on large result sets | YES |
| Primary key | YES — automatically created |
| `UNIQUE` column (email, username) | YES — automatically created |
| Column with very few distinct values (boolean, enum with 2-3 values) | NO — index rarely helps |
| Very small table (< 1000 rows) | NO — sequential scan is faster |
| Column rarely queried | NO |
| Table with extremely high write rate | Be careful — each index costs write performance |

**Cardinality matters.** An index on a column with only 2 values (`true`/`false`) does not help — the DB would still read 50% of the table. An index on `email` (millions of unique values) is highly effective.

---

### Checking if a query uses an index — EXPLAIN

`EXPLAIN` shows what the database will do without actually running the query. `EXPLAIN ANALYZE` runs it and shows real timings.

```sql
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';
```

**Without index — Seq Scan:**
```
Seq Scan on users  (cost=0.00..2890.00 rows=1 width=50)
  Filter: (email = 'alice@example.com')
```
The DB reads the entire table (Seq Scan). `cost` is high.

**After creating the index — Index Scan:**
```sql
CREATE INDEX idx_users_email ON users (email);
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';
```
```
Index Scan using idx_users_email on users  (cost=0.43..8.45 rows=1 width=50)
  Index Cond: (email = 'alice@example.com')
```
Cost dropped from 2890 to 8.45. The DB uses the index.

**With ANALYZE for real execution stats:**
```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'alice@example.com';
```
```
Index Scan using idx_users_email on users
  (cost=0.43..8.45 rows=1 width=50)
  (actual time=0.032..0.034 rows=1 loops=1)
Planning Time: 0.2 ms
Execution Time: 0.1 ms
```

Key terms to know in EXPLAIN output:

| Term | Meaning |
|---|---|
| `Seq Scan` | Full table scan — no index used |
| `Index Scan` | Index used, then heap fetched for full row |
| `Index Only Scan` | Index used, no heap fetch needed (covering index) |
| `Bitmap Index Scan` | Index used for multiple matching rows, then fetches heap in bulk |
| `cost=X..Y` | Estimated cost: X=startup, Y=total (arbitrary units) |
| `rows=N` | Estimated number of rows returned |
| `actual time=X..Y` | Real milliseconds (only with ANALYZE) |

---

### When NOT to add an index

| Reason | Explanation |
|---|---|
| Small table (< ~1000 rows) | A sequential scan of a small table is faster than index overhead |
| Low cardinality column | Boolean, enum with few values — index reads too many rows to be useful |
| Column never used in WHERE/JOIN/ORDER BY | Pure write cost with no read benefit |
| Very high write volume | Each index slows every INSERT/UPDATE/DELETE |
| Already covered by another index | `(user_id, email)` makes a separate `(user_id)` index redundant |

---

### Follow-up Q&A

**Q: What is a covering index and why is it faster?**

A covering index stores all columns needed by a query inside the index itself. The DB reads the index and never needs to go back to the main table (no heap fetch). This is called an **Index Only Scan** and is the fastest possible read path.

```sql
-- Query only needs user_id, status, amount
SELECT status, amount FROM orders WHERE user_id = 5;

-- Covering index stores status and amount alongside user_id
CREATE INDEX ON orders (user_id) INCLUDE (status, amount);

-- EXPLAIN shows: Index Only Scan (no heap access)
```

**Q: How do you know if a query is using an index?**

Run `EXPLAIN` (query plan without execution) or `EXPLAIN ANALYZE` (query plan with real timings). Look for `Index Scan` or `Index Only Scan` — both mean the index is used. `Seq Scan` means the optimizer decided to skip the index (either no index exists or the table is small enough that a full scan is faster).

**Q: The index exists but the query still does a Seq Scan — why?**

The query optimizer may decide a sequential scan is cheaper. This happens when:
- The query returns a large percentage of the table rows (e.g. `WHERE status = 'active'` where 90% of rows are active).
- The table statistics are stale — run `ANALYZE table_name` to update them.
- The index type does not support the operation (e.g. Hash index on a range query).

**Q: What is index bloat?**

When rows are deleted or updated, the B-tree marks old keys as "dead" but does not immediately reclaim the space. Over time this creates wasted pages — the index grows larger without adding useful data. In PostgreSQL, `VACUUM` and `AUTOVACUUM` clean dead tuples. `REINDEX` rebuilds the index from scratch if bloat is severe.

**Q: What is the difference between a primary key index and a regular index?**

A primary key automatically creates a **unique index**. In some databases (MySQL InnoDB), the primary key is a **clustered index** — the table data is physically stored in primary key order. In PostgreSQL, all indexes are **non-clustered** (heap-based) — the table is an unordered heap and indexes are separate structures. A clustered index means the very first lookup is faster because data and index are co-located; non-clustered always requires a heap fetch after the index lookup.

**Q: How many indexes should a table have?**

There is no hard limit, but a common rule: tables that are read-heavy can have more indexes; tables that are write-heavy should have as few as needed. A typical OLTP table might have 3–6 indexes. An analytics (OLAP) table might have many more because it is insert-once, read-many. More than 10-15 indexes on a heavily-written table is a strong warning sign.

---

## 6. SQL Aliases — `AS` keyword

An alias gives a **temporary name** to a column or a table inside a query. It exists only for the duration of that query — it does not rename anything in the database.

Syntax:
```sql
expression AS alias_name
-- AS is optional in most databases, but always write it for clarity
expression alias_name   -- also valid but harder to read
```

---

### Column alias — renaming what appears in the result

Without alias the result column inherits the raw expression name, which can be ugly or meaningless:

```sql
SELECT
  first_name,
  last_name,
  salary * 12
FROM employees;
```

Result:

| first_name | last_name | ?column? |
|------------|-----------|----------|
| Alice      | Nguyen    | 120000   |
| Bob        | Tran      | 84000    |

The third column has no name (`?column?` in PostgreSQL, `salary * 12` in MySQL). The client has no idea what it means.

With alias:

```sql
SELECT
  first_name,
  last_name,
  salary * 12  AS annual_salary
FROM employees;
```

Result:

| first_name | last_name | annual_salary |
|------------|-----------|---------------|
| Alice      | Nguyen    | 120000        |
| Bob        | Tran      | 84000         |

The alias `annual_salary` is what the application code or frontend receives as the column name.

#### More column alias examples

```sql
SELECT
  COUNT(*)          AS total_orders,
  SUM(amount)       AS total_revenue,
  AVG(amount)       AS average_order_value,
  MAX(amount)       AS largest_order,
  MIN(amount)       AS smallest_order
FROM orders
WHERE status = 'completed';
```

Result:

| total_orders | total_revenue | average_order_value | largest_order | smallest_order |
|--------------|---------------|---------------------|---------------|----------------|
| 1523         | 98450.00      | 64.64               | 999.00        | 5.00           |

Without aliases all of these would show as `count(*)`, `sum(amount)`, etc. — readable in a query tool but messy when code accesses `row['count(*)']`.

---

### Table alias — shortening table names in JOINs

When a query joins multiple tables, writing the full table name before every column becomes repetitive and long:

```sql
-- Without alias — verbose
SELECT
  employees.first_name,
  employees.last_name,
  departments.department_name,
  departments.location
FROM employees
INNER JOIN departments ON employees.department_id = departments.id;
```

With table aliases:

```sql
-- With alias — much shorter
SELECT
  e.first_name,
  e.last_name,
  d.department_name,
  d.location
FROM employees  AS e
INNER JOIN departments AS d ON e.department_id = d.id;
```

Both queries produce the same result. The alias `e` and `d` are only shorthand inside this query.

**Why table aliases matter — ambiguous column names:**

When two tables have a column with the same name, you must qualify which one you mean. Without an alias you write the full table name; with an alias you write the short prefix:

```sql
-- Both tables have a column called "name"
SELECT
  u.name  AS user_name,
  p.name  AS product_name
FROM users    AS u
INNER JOIN products AS p ON u.id = p.created_by;
```

| user_name | product_name |
|-----------|--------------|
| Alice     | Widget A     |
| Bob       | Widget B     |

Without the aliases `u.name` and `p.name`, writing `name` would be ambiguous and the DB would throw an error: `column "name" is ambiguous`.

---

### Self-join — table alias is required

A self-join joins a table to itself. Without aliases there is no way to tell which copy of the table each column comes from:

```sql
-- employees table
-- id | name    | manager_id
-- 1  | Alice   | NULL   (Alice is the CEO, no manager)
-- 2  | Bob     | 1      (Bob reports to Alice)
-- 3  | Charlie | 2      (Charlie reports to Bob)

SELECT
  e.name  AS employee,
  m.name  AS manager
FROM employees  AS e
LEFT JOIN employees AS m ON e.manager_id = m.id;
```

Here `e` and `m` are two aliases for the **same table** `employees`. Without aliases this query cannot be written.

Result:

| employee | manager |
|----------|---------|
| Alice    | NULL    |
| Bob      | Alice   |
| Charlie  | Bob     |

---

### Alias scope — where you can and cannot use it

This is a common source of confusion. An alias defined in `SELECT` is **not available in `WHERE` or `HAVING`** in standard SQL because those clauses are evaluated before `SELECT`.

```
Execution order:
FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY
                                            ↑
                                    alias is defined here
```

**Cannot use SELECT alias in WHERE:**

```sql
-- FAILS in most databases
SELECT salary * 12 AS annual_salary
FROM employees
WHERE annual_salary > 100000;   -- ❌ "column annual_salary does not exist"
```

Must repeat the expression:

```sql
-- CORRECT
SELECT salary * 12 AS annual_salary
FROM employees
WHERE salary * 12 > 100000;    -- ✓ repeat the expression
```

**Cannot use SELECT alias in HAVING:**

```sql
-- FAILS
SELECT department_id, AVG(salary) AS avg_salary
FROM employees
GROUP BY department_id
HAVING avg_salary > 70000;     -- ❌ in strict SQL

-- CORRECT
SELECT department_id, AVG(salary) AS avg_salary
FROM employees
GROUP BY department_id
HAVING AVG(salary) > 70000;    -- ✓ repeat the aggregate
```

> **Note:** MySQL and PostgreSQL allow SELECT aliases in `HAVING` and `ORDER BY` as a convenience extension, but it is not standard SQL. Always repeat the expression in `WHERE`.

**Can use SELECT alias in ORDER BY** (allowed in most databases):

```sql
SELECT salary * 12 AS annual_salary
FROM employees
ORDER BY annual_salary DESC;   -- ✓ ORDER BY runs after SELECT
```

---

### Alias in subqueries — required for derived tables

When you use a subquery in `FROM`, the database treats it as a temporary table. You **must** give it an alias or the query fails:

```sql
-- FAILS — subquery has no alias
SELECT *
FROM (SELECT user_id, COUNT(*) FROM orders GROUP BY user_id);
-- ERROR: subquery in FROM must have an alias

-- CORRECT
SELECT *
FROM (
  SELECT user_id, COUNT(*) AS order_count
  FROM orders
  GROUP BY user_id
) AS order_summary                        -- alias for the derived table
WHERE order_summary.order_count > 5;
```

Result (users with more than 5 orders):

| user_id | order_count |
|---------|-------------|
| 1       | 12          |
| 7       | 8           |

---

### Summary

| Alias type | What it renames | Required? | Example |
|---|---|---|---|
| Column alias | Column name in result | No, but recommended | `COUNT(*) AS total` |
| Table alias | Table reference in query | No, but recommended for JOINs | `FROM users AS u` |
| Self-join alias | Same table used twice | **Yes — mandatory** | `FROM employees AS e JOIN employees AS m` |
| Subquery alias | Derived table in FROM | **Yes — mandatory** | `FROM (...) AS sub` |

### Follow-up Q&A

**Q: Does `AS` actually do anything differently from omitting it?**

No. `salary * 12 AS annual_salary` and `salary * 12 annual_salary` are identical in every major database. `AS` is purely for readability — always include it so the alias is visually obvious.

**Q: Can an alias contain spaces or special characters?**

Yes, if you wrap it in double quotes: `salary * 12 AS "Annual Salary"`. Then you must reference it as `"Annual Salary"` elsewhere. Avoid spaces in aliases — use underscores instead (`annual_salary`) so you never need quotes.

**Q: Can you alias a table in an UPDATE or DELETE statement?**

Yes, in PostgreSQL:
```sql
-- PostgreSQL: DELETE with alias
DELETE FROM orders AS o
WHERE o.created_at < NOW() - INTERVAL '1 year';

-- PostgreSQL: UPDATE with alias
UPDATE employees AS e
SET e.salary = e.salary * 1.1
WHERE e.department_id = 3;
```
MySQL uses slightly different syntax (`UPDATE employees e SET ...` — no `AS` keyword in some contexts). Always check dialect-specific behaviour.
