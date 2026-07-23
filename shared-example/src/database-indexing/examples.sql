-- Database indexing examples.
-- These examples are generic SQL and may need small syntax changes depending on
-- your database engine.

-- Example tables
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  status VARCHAR(50) NOT NULL,
  total_amount DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL
);

-- 1. Single-column index
-- Helps queries that find users by email.
CREATE INDEX idx_users_email ON users(email);

SELECT *
FROM users
WHERE email = 'alice@example.com';

-- 2. Unique index
-- Helps lookup and also prevents duplicate emails.
CREATE UNIQUE INDEX idx_users_email_unique ON users(email);

-- 3. Foreign-key style lookup index
-- Helps find all orders for one user.
CREATE INDEX idx_orders_user_id ON orders(user_id);

SELECT *
FROM orders
WHERE user_id = 123;

-- 4. Composite index
-- Helps find one user's orders and sort/filter by created_at.
CREATE INDEX idx_orders_user_id_created_at
ON orders(user_id, created_at);

SELECT *
FROM orders
WHERE user_id = 123
ORDER BY created_at DESC;

-- 5. Composite index for filtering by status and time.
CREATE INDEX idx_orders_status_created_at
ON orders(status, created_at);

SELECT *
FROM orders
WHERE status = 'paid'
  AND created_at >= '2026-01-01'
ORDER BY created_at DESC;

-- 6. Query planner inspection.
-- PostgreSQL and MySQL support EXPLAIN, but output format differs.
EXPLAIN
SELECT *
FROM users
WHERE email = 'alice@example.com';

-- PostgreSQL supports EXPLAIN ANALYZE.
EXPLAIN ANALYZE
SELECT *
FROM orders
WHERE user_id = 123
ORDER BY created_at DESC;

-- 7. Example where an index may not help much.
-- If most users are active, an index on is_active may be ignored.
CREATE INDEX idx_users_is_active ON users(is_active);

SELECT *
FROM users
WHERE is_active = TRUE;

-- 8. Function on indexed column.
-- A normal index on email may not help this query because LOWER(email)
-- transforms the column before comparison.
SELECT *
FROM users
WHERE LOWER(email) = 'alice@example.com';

-- Some databases support expression/function indexes for this case.
-- PostgreSQL example:
CREATE INDEX idx_users_lower_email ON users(LOWER(email));

