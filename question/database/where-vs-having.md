# WHERE vs HAVING

Both filter rows, but they operate at **different stages** of query execution.

---

## Execution order

```
FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
```

- `WHERE` filters **individual rows** before grouping.
- `HAVING` filters **grouped results** after aggregation.

---

## Example

```sql
SELECT department, COUNT(*) AS headcount
FROM employees
WHERE salary > 50000          -- filters rows BEFORE grouping
GROUP BY department
HAVING COUNT(*) > 10;         -- filters groups AFTER aggregation
```

---

## WHERE with aggregates — this FAILS

```sql
-- WRONG
SELECT department, COUNT(*)
FROM employees
WHERE COUNT(*) > 10           -- ❌ aggregates not allowed in WHERE
GROUP BY department;
```

---

## Key rule

> Use `WHERE` to filter rows. Use `HAVING` to filter the result of an aggregate (`COUNT`, `SUM`, `AVG`, `MAX`, `MIN`).

---

## Follow-up Q&A

**Q: Can you use both WHERE and HAVING in the same query?**

Yes. They serve different purposes and can coexist.

```sql
SELECT department, AVG(salary) AS avg_salary
FROM employees
WHERE hire_date > '2020-01-01'     -- only employees hired after 2020
GROUP BY department
HAVING AVG(salary) > 70000;        -- only departments with high average salary
```

**Q: Can you filter on an aliased column in HAVING?**

In standard SQL, no — `HAVING` is evaluated before `SELECT` so the alias does not exist yet. MySQL and PostgreSQL allow it as an extension, but it is not portable.
