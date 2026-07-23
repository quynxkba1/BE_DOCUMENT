# Database Indexes — Fundamentals

An index is a **separate data structure** that the database maintains alongside a table. It stores a sorted copy of one or more column values, each paired with a pointer to the actual row on disk.

Analogy: a book's index at the back — instead of reading every page to find "PostgreSQL", you look it up alphabetically and jump directly to page 142.

---

## The problem: sequential scan

Without an index on a 5-million-row table:

```sql
SELECT * FROM users WHERE email = 'alice@example.com';
```

The database reads every single page — all 40,000 pages. This is a **Seq Scan**. Time complexity: **O(n)**. On 5M rows this takes seconds.

---

## How a B-tree index solves it

A B-tree stores values in **sorted order** in a tree structure. Each node points to child nodes or actual table rows.

```
B-tree index on users(email):

                    [m]
                   /   \
            [a-l]         [n-z]
           /     \        /    \
       [a-f]  [g-l]  [n-s]  [t-z]
         |
      alice@ → page 40000
```

To find `alice@example.com`: traverse 3–4 index nodes → fetch 1 data page.
Instead of 40,000 pages → ~4 pages. Time complexity: **O(log n)**.

---

## What actually happens on INSERT, SEARCH, UPDATE, DELETE

Assume this table and index:

```sql
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  name TEXT,
  email TEXT
);

CREATE INDEX idx_users_email ON users (email);
```

The database now maintains two structures:

```
users table        = stores the full rows
idx_users_email    = stores email value → pointer to table row
```

### Before inserting a new row

Imagine the table already has three rows:

```
TABLE: users

row_10: { id: 1, name: "Bob",   email: "bob@example.com" }
row_20: { id: 2, name: "David", email: "david@example.com" }
row_30: { id: 3, name: "Tom",   email: "tom@example.com" }
```

The email index stores sorted email keys and row pointers:

```
INDEX: idx_users_email

bob@example.com   → row_10
david@example.com → row_20
tom@example.com   → row_30
```

The index does **not** usually store the whole user row. It stores the indexed value plus a pointer to where the real row lives.

### INSERT: adding a new record

When you run:

```sql
INSERT INTO users (id, name, email)
VALUES (4, 'Alice', 'alice@example.com');
```

the database does two writes:

```
1. Write the full row into the users table.
2. Insert the email key and row pointer into idx_users_email.
```

After insert:

```
TABLE: users

row_10: { id: 1, name: "Bob",   email: "bob@example.com" }
row_20: { id: 2, name: "David", email: "david@example.com" }
row_30: { id: 3, name: "Tom",   email: "tom@example.com" }
row_40: { id: 4, name: "Alice", email: "alice@example.com" }
```

The index is also updated:

```
INDEX: idx_users_email

alice@example.com → row_40
bob@example.com   → row_10
david@example.com → row_20
tom@example.com   → row_30
```

So the key idea is:

```
INSERT = write table row + update every related index
```

If the table has five indexes, one insert means:

```
write table row
update index 1
update index 2
update index 3
update index 4
update index 5
```

This is why indexes make writes slower.

### SEARCH: finding a row using an index

When you run:

```sql
SELECT *
FROM users
WHERE email = 'alice@example.com';
```

the database planner checks whether a useful index exists for `email`.

Because `idx_users_email` exists, the database can search the index first:

```
1. Search idx_users_email for alice@example.com.
2. Index returns row_40.
3. Database jumps to row_40 in the users table.
4. Database reads the full row.
5. Database returns Alice.
```

Picture:

```
idx_users_email
  alice@example.com → row_40

users table
  row_40 → { id: 4, name: "Alice", email: "alice@example.com" }
```

Without the index, the database may scan the table:

```
check row_10
check row_20
check row_30
check row_40
```

With the index, it can use the sorted lookup structure and jump directly to the matching row pointer.

### UPDATE: changing a non-indexed column

When you run:

```sql
UPDATE users
SET name = 'Alice Nguyen'
WHERE id = 4;
```

the indexed column `email` did not change.

Conceptually:

```
TABLE changes:
row_40: { id: 4, name: "Alice Nguyen", email: "alice@example.com" }

INDEX stays the same:
alice@example.com → row_40
```

This is cheaper than updating an indexed column.

### UPDATE: changing an indexed column

When you run:

```sql
UPDATE users
SET email = 'alice.new@example.com'
WHERE id = 4;
```

the database must update both the table and the email index.

Conceptually:

```
Old index entry:
alice@example.com     → row_40

New index entry:
alice.new@example.com → row_40
```

The database must remove or invalidate the old index key and insert the new key.

In PostgreSQL specifically, because of MVCC, an update is closer to:

```
1. Old row version becomes dead.
2. New row version is inserted.
3. Index points to the new row version.
4. VACUUM later cleans old row/index entries.
```

This is why frequent updates on indexed columns can create index bloat.

### DELETE: removing a row

When you run:

```sql
DELETE FROM users
WHERE id = 4;
```

the database must remove the table row and keep indexes consistent.

Conceptually:

```
TABLE:
row_40 is deleted

INDEX:
alice.new@example.com → row_40 is removed
```

In PostgreSQL, the row and index entry are usually not physically removed immediately:

```
1. Row is marked dead.
2. Index entry becomes a dead reference.
3. VACUUM later reclaims the space.
```

### Full lifecycle summary

```
INSERT
  → write table row
  → add index key → row pointer

SEARCH with indexed WHERE
  → search index
  → get row pointer
  → fetch full row from table

UPDATE non-indexed column
  → update table row
  → index mostly unchanged

UPDATE indexed column
  → update table row/version
  → old index key becomes invalid/dead
  → new index key inserted

DELETE
  → mark/delete table row
  → mark/delete related index entries
  → cleanup later by VACUUM / maintenance
```

Short answer:

> An index is a sorted lookup structure. Search uses it to find row pointers quickly. Insert, update, and delete must keep the index synchronized with the table, which is why indexes speed up reads but add write cost.

---

## How to create an index

```sql
-- Basic index
CREATE INDEX idx_users_email ON users (email);

-- Unique index (lookup + prevents duplicates)
CREATE UNIQUE INDEX idx_users_email ON users (email);

-- Composite index (multiple columns)
CREATE INDEX idx_orders_user_date ON orders (user_id, created_at);

-- Partial index (only index a subset of rows)
CREATE INDEX idx_orders_pending ON orders (created_at)
WHERE status = 'pending';

-- Expression index (for queries using LOWER(email))
CREATE INDEX idx_users_lower_email ON users (LOWER(email));

-- Drop an index
DROP INDEX idx_users_email;

-- View existing indexes (PostgreSQL)
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users';
```

---

## Write cost of indexes

Every index must stay in sync with the table. Every `INSERT`, `UPDATE`, `DELETE` also updates all indexes on affected columns.

| Operation | 0 indexes | 5 indexes |
|---|---|---|
| SELECT (indexed col) | Seq scan — slow | Index scan — fast |
| INSERT | Write 1 row | Write 1 row + update 5 indexes |
| UPDATE (indexed col) | Update row | Update row + rebuild key in each index |
| DELETE | Delete row | Delete row + mark dead in each index |

**Dead tuples** from DELETE/UPDATE accumulate as **index bloat**. PostgreSQL's `VACUUM` cleans them up.

---

## Choosing which column to index

| Situation | Index? |
|---|---|
| Column used in `WHERE` frequently | YES |
| Column used in `JOIN ON` | YES |
| Column used in `ORDER BY` on large result sets | YES |
| Primary key | YES — automatic |
| `UNIQUE` column (email, username) | YES — automatic |
| Boolean / low-cardinality enum | NO — index rarely helps |
| Very small table (< 1000 rows) | NO — seq scan is faster |
| Column rarely queried | NO |
| Extremely high write rate | Be careful |

**Cardinality matters.** An index on a boolean column (2 values) does not help. An index on `email` (millions of unique values) is highly effective.

---

## Follow-up Q&A

**Q: What is index bloat?**

When rows are deleted or updated, the B-tree marks old keys as "dead" but does not immediately reclaim the space. Over time the index grows without adding useful data. `VACUUM` cleans dead tuples. `REINDEX CONCURRENTLY` rebuilds the index from scratch if bloat is severe.

**Q: Clustered vs non-clustered index?**

In MySQL InnoDB, the primary key is a **clustered index** — table data is physically stored in primary key order. In PostgreSQL, all indexes are **non-clustered** (heap-based) — the table is an unordered heap and indexes are separate structures. Clustered means the first lookup is faster because data and index are co-located.

**Q: How many indexes should a table have?**

A typical OLTP table: 3–6 indexes. Write-heavy tables: as few as needed. More than 10–15 indexes on a heavily-written table is a warning sign.
