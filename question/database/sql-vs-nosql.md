# SQL vs NoSQL

---

## SQL (Relational databases)

Data is stored in **tables** with predefined columns and types. Rows relate to rows in other tables via foreign keys. Schema is enforced — you cannot insert a row with an unknown column.

Examples: PostgreSQL, MySQL, SQLite, MS SQL Server.

```sql
CREATE TABLE users (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL
);
```

---

## NoSQL (Non-relational databases)

Data is stored in flexible formats: documents (JSON), key-value pairs, wide columns, or graphs. No fixed schema — documents in the same collection can have different fields.

Examples: MongoDB (document), Redis (key-value), Cassandra (wide column), Neo4j (graph).

```json
{ "_id": "abc", "name": "Alice", "preferences": { "theme": "dark" } }
{ "_id": "def", "name": "Bob" }
```

---

## Comparison

| | SQL | NoSQL |
|---|---|---|
| Schema | Fixed, enforced | Flexible / schema-less |
| Consistency | ACID by default | Often eventual consistency |
| Relationships | Foreign keys, JOINs | Embedded documents or application-level joins |
| Scaling | Vertical (bigger server) | Horizontal (more servers) |
| Query language | SQL (standardized) | Varies by DB |
| Best for | Financial data, e-commerce, reporting | Social feeds, logs, real-time analytics, caching |

---

## When to choose which

| Use case | Recommended |
|---|---|
| Banking / payments — strong consistency required | PostgreSQL |
| User profiles with variable attributes | MongoDB |
| Session storage / rate limiting | Redis |
| Product catalog with complex queries and joins | PostgreSQL |
| Activity feeds, time-series events | Cassandra / DynamoDB |
| Social graph (who follows whom) | Neo4j |

---

## `$lookup` (MongoDB) vs SQL JOIN

MongoDB's default answer to relationships isn't joining — it's **embedding** (nest related data into the document at write time, so no join is needed at read time). `$lookup` is an aggregation stage that exists as an escape hatch for when you kept data in separate collections anyway. It behaves like a weaker, more manual LEFT JOIN.

Using the same `users`/`orders` data as [joins.md](./joins.md): Alice (id 1) has orders Laptop + Phone, Bob (id 2) has Monitor, Charlie (id 3) has no orders, and there's an orphan order (user_id 999, Tablet).

### Syntax mapping

```sql
SELECT users.name, orders.product
FROM users
LEFT JOIN orders ON users.id = orders.user_id;
```

```js
db.users.aggregate([
  { $lookup: {
      from: "orders",          // table after JOIN
      localField: "_id",       // left side of ON  (users.id)
      foreignField: "user_id", // right side of ON (orders.user_id)
      as: "orders"             // name of the new array field holding matches
  }}
])
```

| SQL | `$lookup` |
|---|---|
| `FROM users` | the collection you call `.aggregate()` on |
| `JOIN orders` | `from: "orders"` |
| `ON users.id = orders.user_id` | `localField: "_id"`, `foreignField: "user_id"` |
| result columns flattened into one row | result nested as an array field (`as: "orders"`) |

The key structural difference: SQL JOIN produces flat rows, one per match. `$lookup` produces one document per **left-side row**, with an array of all its matches embedded inside.

### `$lookup` alone = LEFT JOIN (its native, default behavior)

```json
{ "_id":1, "name":"Alice",   "orders":[{"product":"Laptop"},{"product":"Phone"}] }
{ "_id":2, "name":"Bob",     "orders":[{"product":"Monitor"}] }
{ "_id":3, "name":"Charlie", "orders":[] }
```

Charlie is kept with an empty array — same idea as LEFT JOIN keeping Charlie with `NULL`.

### Emulating INNER JOIN

`$lookup` has no INNER mode. Add `$unwind` to flatten the array into separate rows — documents with an empty array drop out automatically:

```js
[
  { $lookup: { from:"orders", localField:"_id", foreignField:"user_id", as:"orders" } },
  { $unwind: "$orders" }
]
```
→ Alice/Laptop, Alice/Phone, Bob/Monitor. Charlie disappears.

### Emulating "users with no orders" (LEFT JOIN ... WHERE NULL trick)

```js
[
  { $lookup: { from:"orders", localField:"_id", foreignField:"user_id", as:"orders" } },
  { $match: { orders: { $size: 0 } } }
]
```
→ Charlie.

### RIGHT / FULL OUTER have no clean equivalent

`$lookup` is directional — it always attaches "from" data onto the collection you started `.aggregate()` on. To reproduce a RIGHT JOIN you must start from `orders` instead and lookup into `users`. FULL OUTER has no direct equivalent at all; it requires stitching two `$lookup` pipelines together with `$unionWith`.

### Execution & performance differences

| | SQL JOIN | `$lookup` |
|---|---|---|
| Planner | Cost-based optimizer picks nested-loop / hash / merge join | Always behaves like a nested loop: for each left document, look up matches on the right |
| Index used | Both sides can use indexes; planner decides | Only the **foreign** collection's `foreignField` benefits from an index |
| Cross-shard | Transparent | Restricted — the `from` collection has sharding limitations |
| Referential integrity | FK constraint guarantees `orders.user_id` always exists in `users` | Nothing enforced — orphan `user_id: 999` just silently returns no match |

**Bottom line:** `$lookup` is roughly SQL's LEFT JOIN reimplemented as one pipeline stage, with INNER/RIGHT/FULL and "no match" filtering all requiring extra hand-assembled stages that SQL gives for free as keywords. It's intentionally the exception in MongoDB, not the everyday tool — the idiomatic fix for "I need this data together" is to embed it at write time instead.

---

## Real case studies & decision framework

The choice isn't "which database is better" — it's "which engine fits this specific access pattern." Two real, opposite-failure case studies make this concrete:

**Case 1 — News feed on PostgreSQL, chosen wrong:** A social feed required joining many tables (users, posts, likes, follows) on every read. As data grew, the JOINs turned into random disk I/O and latency grew exponentially. This is the classic case for **embedding/denormalization** instead — feed-style, read-heavy, known-access-pattern data is exactly what NoSQL document stores (or precomputed feed tables) are built for.

**Case 2 — Billing on MongoDB, chosen wrong (opposite mistake):** A billing system built on MongoDB lost ACID guarantees, forcing the team to hand-write thousands of lines of application-level code just to fake consistency that a relational database would have enforced for free. Money/state-changing systems need **SQL's transactional guarantees by default** — see criterion 1 above.

These two cases are symmetric: picking NoSQL for join-heavy relational workloads fails the same way picking SQL for money/consistency-critical workloads would fail in reverse. The lesson is the workload decides, not the hype cycle.

### A 3-step framework for deciding

1. **Identify the top ~20% of queries that matter most** — you don't need to support every hypothetical query well, just the ones that actually run in production at volume.
2. **Define the real consistency boundary** — not "we want everything perfectly safe," but which specific operations must be transactional (payments, inventory) vs. which can tolerate eventual consistency (view counts, activity feeds).
3. **Weigh operational cost and team expertise** — a NoSQL cluster the team doesn't know how to operate reliably is worse in practice than a "theoretically slower" SQL database the team can actually run well.

**Default recommendation:** start with PostgreSQL. Only move to NoSQL when there's clear evidence SQL can't meet the workload after real optimization attempts (indexing, partitioning, read replicas, denormalization) — not because NoSQL is trending. Most production systems end up as **polyglot persistence** anyway: SQL for the transactional core, NoSQL/Redis/Elasticsearch layered in for specific subsystems with known, high-volume access patterns (e.g. Discord's message store on Cassandra/ScyllaDB, partitioned by channel ID for append-heavy, time-ordered access).

---

## Follow-up Q&A

**Q: Can NoSQL databases be consistent?**

Yes. MongoDB has supported multi-document ACID transactions since version 4.0. The assumption that NoSQL = eventual consistency is outdated for many modern NoSQL databases.

**Q: What is the CAP theorem?**

CAP states that a distributed system can guarantee at most 2 of 3 properties:
- **Consistency** — every read returns the latest write.
- **Availability** — every request receives a response.
- **Partition tolerance** — the system keeps running even when network partitions occur.

In practice, partition tolerance is mandatory, so the real trade-off is between Consistency and Availability (CP vs AP).

**Q: When would you choose Redis over PostgreSQL?**

Redis is in-memory and extremely fast (sub-millisecond reads/writes). Use Redis for caching, session storage, rate limiting counters, pub/sub messaging, and leaderboards. Use PostgreSQL for durable, relational, transactional data.
