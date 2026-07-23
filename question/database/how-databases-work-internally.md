# How Databases Work Internally

A database turns a SQL string into disk/memory operations while guaranteeing correctness. This note walks the full path: **client → query pipeline → storage engine → disk**, then ties it to physical storage (pages, `.ibd` files) and durability (WAL, ACID).

Source: [Unboxing a Database: How Databases Work Internally](https://dev.to/gbengelebs/unboxing-a-database-how-databases-work-internally-155h)

---

## Definitions

| Term | Meaning |
|---|---|
| **Database** | A set of physical files on disk, stored and accessed electronically |
| **DBMS** | The software that manages those files — storage, retrieval, updates |
| **Database engine** | The component inside the DBMS that actually executes CRUD operations |

---

## 1. Client → Server

The app sends a SQL string over a TCP connection, usually through a **connection pool** rather than opening a fresh connection per query (see [[pooling-connection]]).

---

## 2. Query processing pipeline

Every query passes through four stages before touching disk:

```
Parse → Compile → Optimize → Execute
```

| Stage | What happens |
|---|---|
| **Parse** | Syntax + semantic validation; check tables/columns exist; turn SQL text into a parse tree |
| **Compile** | Convert the parse tree into an execution plan (byte code) |
| **Optimize** | Use table statistics (row counts, index cardinality) to compare candidate plans — seq scan vs. index scan vs. hash join — and pick the cheapest one |
| **Execute** | Run the chosen plan: read rows, filter (`WHERE`), join, aggregate (`GROUP BY`), sort (`ORDER BY`) |

The optimizer is why `EXPLAIN ANALYZE` can show different plans for the same query on different data sizes — the cost estimate changes with cardinality.

---

## 3. Physical storage — pages

On disk, a database is literally a directory of files. For MySQL (InnoDB):

```
datadir/
  mydb/
    users.frm   -- table structure/format
    users.ibd   -- actual table data
```

Data inside `.ibd` is not stored row-by-row loosely — it's grouped into fixed-size **pages** (16KB by default in InnoDB, 8KB in PostgreSQL). Each page has three parts:

```
┌─────────────────────────────┐
│ Page Header                 │  ← metadata + pointers to prev/next page
├─────────────────────────────┤
│ Actual Data (records)       │  ← rows with type indicators
├─────────────────────────────┤
│ Offset Table                │  ← pointers to each record's location in the page
└─────────────────────────────┘
```

Reads and writes happen at the **page** granularity, not the row — this is why a `SELECT` on one column can still pull a whole 8–16KB page into memory, and why the **buffer pool/cache** (hot pages kept in RAM) matters so much for performance: disk I/O is the real bottleneck, not CPU.

---

## 4. Indexes — B-tree / B+ tree

Without an index, finding a row means reading every page — a **sequential scan**, O(n).

An index is a separate sorted structure (usually a **B-tree** in Postgres, **B+ tree** in InnoDB) that maps column values → row pointers, like a dictionary: sorted entries, each pointing to more detail.

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

- **Internal nodes**: navigation pointers only.
- **Leaf nodes**: actual data pointers, linked together — this is what makes range scans (`WHERE created_at > X`) cheap in a B+ tree, since leaves form a linked list.

Lookup cost drops from O(n) to O(log n): ~4 page reads instead of 40,000.

Full detail on how INSERT/SEARCH/UPDATE/DELETE interact with an index (and write-cost tradeoffs) is in [[indexes-fundamentals]].

---

## 5. Write path & durability (ACID)

Writes don't go straight to the data file:

```
1. Change is appended to the Write-Ahead Log (WAL) first.
2. COMMIT flushes the WAL to disk → durability guaranteed even on crash.
3. The actual data page is updated (can happen lazily, after WAL is safe).
4. ROLLBACK discards the change before it's committed.
```

Concurrent transactions are isolated via locks or **MVCC** (multi-version concurrency control — Postgres's approach: an UPDATE doesn't overwrite a row in place, it marks the old version dead and inserts a new one; `VACUUM` reclaims dead versions later).

Full ACID breakdown: [[acid-properties]].

---

## 6. Response

Result rows are serialized and streamed back to the client over the same connection.

---

## End-to-end summary

```
Client
  │  SQL string
  ▼
Parse → Compile → Optimize → Execute      (query pipeline)
  │
  ▼
Storage engine
  │  reads/writes PAGES (8-16KB), cached in buffer pool
  │  uses B-tree/B+ tree INDEXES to avoid seq scans
  │  writes go through WAL first (durability)
  │  MVCC/locks isolate concurrent transactions
  ▼
Disk (.ibd / heap files)
```

NoSQL databases follow the same broad shape (storage engine, indexes, WAL) but relax schema and sometimes consistency to scale horizontally instead of vertically — see [[sql-vs-nosql]].

---

## Follow-up Q&A

**Q: Why does the engine read a whole page instead of just the row I asked for?**

Disk I/O is expensive per-seek, not per-byte, so databases amortize the cost by always reading/writing in page-sized chunks and caching those pages in memory. A query touching one row still pulls in its neighbors "for free."

**Q: Why is a B+ tree preferred over a plain B-tree for database indexes?**

In a B+ tree, only leaf nodes hold data, and leaves are linked in sorted order. This makes range scans (`BETWEEN`, `>`, `ORDER BY`) fast — walk the leaf chain — whereas a plain B-tree would require re-traversing from internal nodes.

**Q: What's the difference between the query plan and the query optimizer?**

The **plan** is the concrete sequence of operations (scan type, join order, join algorithm) the engine will execute. The **optimizer** is the component that generates multiple candidate plans and picks the lowest estimated-cost one, based on table statistics.

**Q: Why do frequent updates cause "bloat"?**

Under MVCC, an UPDATE doesn't modify a row in place — it writes a new row version and marks the old one dead, and the index gets a new key pointing to the new version. Dead versions in both table and index accumulate until `VACUUM` reclaims them; heavy update workloads without regular vacuuming can bloat both table and index size significantly.
