# SQL JOINs

A JOIN combines rows from two tables based on a related column.

---

## Source tables (used for all examples)

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

- Alice has 2 orders. Bob has 1 order. Charlie has **no orders**.
- Order 13 (Tablet) has `user_id=999` which **does not exist** — orphan row.

JOIN condition: `users.id = orders.user_id`

---

## INNER JOIN

**Rule:** only keep rows where a match is found **in both tables**.

```sql
SELECT users.name, orders.product
FROM users
INNER JOIN orders ON users.id = orders.user_id;
```

| name  | product |
|-------|---------|
| Alice | Laptop  |
| Alice | Phone   |
| Bob   | Monitor |

Charlie dropped (no orders). Tablet dropped (no matching user).

---

## LEFT JOIN

**Rule:** keep **every row from the left table**. Fill with NULL where no match.

```sql
SELECT users.name, orders.product
FROM users
LEFT JOIN orders ON users.id = orders.user_id;
```

| name    | product |
|---------|---------|
| Alice   | Laptop  |
| Alice   | Phone   |
| Bob     | Monitor |
| Charlie | NULL    |

Charlie is **kept**. Tablet is **not shown** (only in right table).

### Find users with NO orders

```sql
SELECT users.name
FROM users
LEFT JOIN orders ON users.id = orders.user_id
WHERE orders.id IS NULL;
```

Result: **Charlie**

---

## RIGHT JOIN

**Rule:** keep **every row from the right table**. Fill with NULL where no match.

```sql
SELECT users.name, orders.product
FROM users
RIGHT JOIN orders ON users.id = orders.user_id;
```

| name  | product |
|-------|---------|
| Alice | Laptop  |
| Alice | Phone   |
| Bob   | Monitor |
| NULL  | Tablet  |

Tablet is **kept**. Charlie is **not shown**.

> RIGHT JOIN is a flipped LEFT JOIN. Swap the tables and use LEFT JOIN instead — most developers never write RIGHT JOIN.

---

## FULL OUTER JOIN

**Rule:** keep **every row from both tables**. NULL fills missing columns on either side.

```sql
SELECT users.name, orders.product
FROM users
FULL OUTER JOIN orders ON users.id = orders.user_id;
```

| name    | product |
|---------|---------|
| Alice   | Laptop  |
| Alice   | Phone   |
| Bob     | Monitor |
| Charlie | NULL    |
| NULL    | Tablet  |

---

## All JOIN types compared

| JOIN type       | Alice/Laptop | Alice/Phone | Bob/Monitor | Charlie/NULL | NULL/Tablet |
|-----------------|:---:|:---:|:---:|:---:|:---:|
| INNER JOIN      | ✓  | ✓  | ✓  | —  | —  |
| LEFT JOIN       | ✓  | ✓  | ✓  | ✓  | —  |
| RIGHT JOIN      | ✓  | ✓  | ✓  | —  | ✓  |
| FULL OUTER JOIN | ✓  | ✓  | ✓  | ✓  | ✓  |

| JOIN | Keeps |
|---|---|
| INNER | Only matched rows |
| LEFT | All left rows + matched right rows |
| RIGHT | All right rows + matched left rows |
| FULL OUTER | All rows from both sides |

---

## Follow-up Q&A

**Q: What is a self-join?**

Joining a table to itself. Common for hierarchical data (employees and their managers).

```sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;
```

**Q: What is a CROSS JOIN?**

Produces the Cartesian product — every row from table A paired with every row from table B. 100 rows × 100 rows = 10,000 rows. Rarely used intentionally.
