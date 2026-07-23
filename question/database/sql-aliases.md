# SQL Aliases — AS keyword

An alias gives a **temporary name** to a column or table inside a query. It exists only for the duration of that query.

```sql
expression AS alias_name
```

---

## Column alias

Without alias, computed columns have no name:

```sql
SELECT first_name, last_name, salary * 12 FROM employees;
-- third column shows as "?column?" or "salary * 12"
```

With alias:

```sql
SELECT
  first_name,
  last_name,
  salary * 12 AS annual_salary
FROM employees;
```

```sql
SELECT
  COUNT(*)    AS total_orders,
  SUM(amount) AS total_revenue,
  AVG(amount) AS average_order_value
FROM orders
WHERE status = 'completed';
```

---

## Table alias

```sql
-- Without alias — verbose
SELECT employees.first_name, departments.department_name
FROM employees
INNER JOIN departments ON employees.department_id = departments.id;

-- With alias — shorter
SELECT e.first_name, d.department_name
FROM employees  AS e
INNER JOIN departments AS d ON e.department_id = d.id;
```

When two tables have the same column name, aliases resolve the ambiguity:

```sql
SELECT u.name AS user_name, p.name AS product_name
FROM users AS u
INNER JOIN products AS p ON u.id = p.created_by;
```

---

## Self-join — alias is required

```sql
SELECT e.name AS employee, m.name AS manager
FROM employees AS e
LEFT JOIN employees AS m ON e.manager_id = m.id;
```

`e` and `m` are two aliases for the **same table**. Without aliases this query cannot be written.

---

## Alias scope — where you can and cannot use it

```
FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY
                                            ↑
                                    alias defined here
```

```sql
-- FAILS — alias not yet defined when WHERE is evaluated
SELECT salary * 12 AS annual_salary
FROM employees
WHERE annual_salary > 100000; -- ❌

-- CORRECT
SELECT salary * 12 AS annual_salary
FROM employees
WHERE salary * 12 > 100000;   -- ✓ repeat the expression
```

```sql
-- FAILS in strict SQL
HAVING avg_salary > 70000;    -- ❌

-- CORRECT
HAVING AVG(salary) > 70000;   -- ✓
```

```sql
-- ORDER BY runs after SELECT — alias is allowed
ORDER BY annual_salary DESC;  -- ✓
```

---

## Subquery alias — required

```sql
-- FAILS — subquery has no alias
SELECT * FROM (SELECT user_id, COUNT(*) FROM orders GROUP BY user_id);

-- CORRECT
SELECT *
FROM (
  SELECT user_id, COUNT(*) AS order_count
  FROM orders
  GROUP BY user_id
) AS order_summary
WHERE order_summary.order_count > 5;
```

---

## Summary

| Alias type | Required? |
|---|---|
| Column alias | No, but recommended |
| Table alias | No, but recommended for JOINs |
| Self-join alias | **Yes — mandatory** |
| Subquery alias | **Yes — mandatory** |
