---
name: sql
description: "Query optimization, EXPLAIN, indexes, JOINs, window functions, CTEs, transactions, PostgreSQL tips, MySQL gotchas, N+1 problem, bulk operations, and schema design patterns."
domain: general
version: "1.0"
---

# SQL Reference Dictionary

## Query Optimization

### EXPLAIN and Query Plans

```sql
-- PostgreSQL: Full execution plan with timing
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.name, COUNT(o.id)
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2024-01-01'
GROUP BY u.name;

-- Read the output bottom-up:
-- Seq Scan on users  (cost=0.00..1.52 rows=52 width=32) (actual time=0.01..0.03 rows=52 loops=1)
--   Filter: (created_at > '2024-01-01')
--   Rows Removed by Filter: 948
--
-- Key things to look for:
-- 1. Seq Scan on large tables (needs index?)
-- 2. High "Rows Removed by Filter" (index not selective enough)
-- 3. Nested Loop with many loops (N+1 join)
-- 4. Sort with high memory (needs index for ORDER BY)
-- 5. Hash Join with large hash (memory pressure)

-- PostgreSQL: JSON format for programmatic analysis
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ...;

-- MySQL: EXPLAIN
EXPLAIN SELECT u.name, COUNT(o.id)
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2024-01-01'
GROUP BY u.name;

-- MySQL: Extended EXPLAIN with warnings
EXPLAIN FORMAT=TREE SELECT ...;   -- MySQL 8.0+ tree format
EXPLAIN ANALYZE SELECT ...;       -- MySQL 8.0.18+ with actual timing

-- Key MySQL EXPLAIN columns:
-- type: ALL (full scan) -> index -> range -> ref -> eq_ref -> const
-- key: which index is used (NULL = no index)
-- rows: estimated rows examined
-- Extra: "Using filesort", "Using temporary" = potential problems
```

### Query Rewriting Patterns

```sql
-- AVOID: Subquery in SELECT (executes once per row)
SELECT u.name,
    (SELECT COUNT(*) FROM orders WHERE user_id = u.id) AS order_count
FROM users u;

-- BETTER: JOIN with aggregate
SELECT u.name, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name;

-- AVOID: OR conditions on different columns (can't use single index)
SELECT * FROM products
WHERE category_id = 5 OR brand_id = 10;

-- BETTER: UNION ALL (each uses its own index)
SELECT * FROM products WHERE category_id = 5
UNION ALL
SELECT * FROM products WHERE brand_id = 10 AND category_id != 5;

-- AVOID: Function on indexed column (prevents index use)
SELECT * FROM users WHERE YEAR(created_at) = 2024;

-- BETTER: Range condition (uses index)
SELECT * FROM users
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';

-- AVOID: LIKE with leading wildcard
SELECT * FROM users WHERE email LIKE '%@gmail.com';

-- BETTER: Use a reverse index or full-text search
-- PostgreSQL: trigram index
CREATE INDEX idx_users_email_trgm ON users USING gin (email gin_trgm_ops);
-- Or store reversed email and search: WHERE reverse_email LIKE 'moc.liamg@%'

-- AVOID: SELECT * (wastes bandwidth, prevents covering indexes)
SELECT * FROM users WHERE status = 'active';

-- BETTER: Select only needed columns
SELECT id, name, email FROM users WHERE status = 'active';

-- AVOID: DISTINCT when you mean EXISTS
SELECT DISTINCT u.name
FROM users u
JOIN orders o ON o.user_id = u.id;

-- BETTER: EXISTS
SELECT u.name
FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

### Pagination

```sql
-- AVOID: OFFSET for deep pagination (slow: scans and discards rows)
SELECT * FROM products ORDER BY id LIMIT 20 OFFSET 10000;
-- This reads 10020 rows and discards 10000!

-- BETTER: Keyset/cursor pagination (constant time regardless of page)
-- First page:
SELECT * FROM products ORDER BY id LIMIT 20;
-- Next page (pass last id from previous result):
SELECT * FROM products WHERE id > :last_id ORDER BY id LIMIT 20;

-- Keyset pagination with multiple sort columns:
SELECT * FROM products
WHERE (created_at, id) < (:last_created_at, :last_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- For UI that NEEDS total count + page numbers:
-- Use a materialized count or estimate
SELECT reltuples::bigint AS estimate
FROM pg_class WHERE relname = 'products';

-- Or count in a CTE (only when needed)
WITH filtered AS (
    SELECT * FROM products WHERE category_id = 5
)
SELECT *, (SELECT COUNT(*) FROM filtered) AS total
FROM filtered
ORDER BY id
LIMIT 20 OFFSET :offset;
```

## Indexes

### Index Types and When to Use Them

```sql
-- B-tree (default): equality and range queries
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_orders_date ON orders (created_at);

-- Multi-column index (leftmost prefix rule)
CREATE INDEX idx_orders_user_date ON orders (user_id, created_at);
-- Supports: WHERE user_id = 5
-- Supports: WHERE user_id = 5 AND created_at > '2024-01-01'
-- Does NOT efficiently support: WHERE created_at > '2024-01-01' alone

-- Covering index (include columns for index-only scans)
CREATE INDEX idx_orders_covering ON orders (user_id, created_at)
    INCLUDE (total_amount, status);
-- Query can be answered entirely from the index:
SELECT total_amount, status FROM orders
WHERE user_id = 5 AND created_at > '2024-01-01';

-- Partial index (index only rows matching a condition)
CREATE INDEX idx_active_users ON users (email) WHERE status = 'active';
-- Smaller index, faster lookups for common queries
-- Only helps: SELECT * FROM users WHERE status = 'active' AND email = ...

-- Unique index
CREATE UNIQUE INDEX idx_users_email_unique ON users (email);
-- Also enforces uniqueness constraint

-- Expression index
CREATE INDEX idx_users_lower_email ON users (LOWER(email));
-- Supports: WHERE LOWER(email) = 'user@example.com'

-- PostgreSQL: GIN index for arrays and JSONB
CREATE INDEX idx_posts_tags ON posts USING gin (tags);
-- Supports: WHERE tags @> ARRAY['sql', 'optimization']
CREATE INDEX idx_data_jsonb ON events USING gin (metadata jsonb_path_ops);
-- Supports: WHERE metadata @> '{"type": "click"}'

-- PostgreSQL: GiST index for geometric/range types
CREATE INDEX idx_locations_coords ON locations USING gist (coordinates);
-- Supports: WHERE coordinates <-> point(40.7, -74.0) < 0.1

-- PostgreSQL: BRIN index for naturally ordered data (e.g., time-series)
CREATE INDEX idx_logs_timestamp ON logs USING brin (timestamp);
-- Very small index, good for append-only tables sorted by timestamp

-- Hash index (PostgreSQL 10+: WAL-logged, safe to use)
CREATE INDEX idx_sessions_token ON sessions USING hash (token);
-- Only supports equality, but faster than B-tree for that case
```

### Index Maintenance

```sql
-- PostgreSQL: Check index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;  -- unused indexes at top

-- Find unused indexes
SELECT indexrelid::regclass AS index, relid::regclass AS table,
       idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- PostgreSQL: Reindex (rebuild fragmented indexes)
REINDEX INDEX idx_users_email;
REINDEX TABLE users;
REINDEX INDEX CONCURRENTLY idx_users_email;  -- non-blocking (PG 12+)

-- MySQL: Check index usage
SELECT * FROM sys.schema_unused_indexes;
SELECT * FROM sys.schema_redundant_indexes;

-- MySQL: Analyze table (update index statistics)
ANALYZE TABLE users;

-- MySQL: Optimize table (rebuild + analyze)
OPTIMIZE TABLE users;

-- Create index without locking (PostgreSQL)
CREATE INDEX CONCURRENTLY idx_name ON table (column);
-- Note: Cannot be run inside a transaction

-- Drop index without locking (PostgreSQL)
DROP INDEX CONCURRENTLY idx_name;
```

## JOINs

### JOIN Types and Patterns

```sql
-- INNER JOIN: only matching rows
SELECT u.name, o.total
FROM users u
INNER JOIN orders o ON o.user_id = u.id;

-- LEFT JOIN: all from left + matching from right (NULL if no match)
SELECT u.name, COALESCE(COUNT(o.id), 0) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name;

-- RIGHT JOIN: all from right + matching from left
-- Rarely used: rewrite as LEFT JOIN by swapping table order

-- FULL OUTER JOIN: all rows from both (NULL where no match)
SELECT COALESCE(a.date, b.date) AS date,
       a.revenue, b.expenses
FROM revenue a
FULL OUTER JOIN expenses b ON a.date = b.date;

-- CROSS JOIN: cartesian product (every combination)
SELECT d.date, p.name
FROM dates d
CROSS JOIN products p;
-- Useful for generating all combinations

-- LATERAL JOIN (PostgreSQL): correlated subquery as a table
SELECT u.name, recent.total, recent.created_at
FROM users u
CROSS JOIN LATERAL (
    SELECT total, created_at
    FROM orders
    WHERE user_id = u.id
    ORDER BY created_at DESC
    LIMIT 3
) recent;
-- Gets the 3 most recent orders per user efficiently

-- Self JOIN: join table to itself
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;

-- Anti-join: find rows WITHOUT a match
-- Method 1: LEFT JOIN + IS NULL (often fastest)
SELECT u.*
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;

-- Method 2: NOT EXISTS (clearest intent)
SELECT u.*
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);

-- Method 3: NOT IN (caution: NULL handling)
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders WHERE user_id IS NOT NULL);
-- If subquery can return NULL, NOT IN gives unexpected results!
```

### JOIN Optimization

```sql
-- Ensure join columns are indexed
CREATE INDEX idx_orders_user_id ON orders (user_id);

-- For many-to-many, index both FK columns on junction table
CREATE INDEX idx_post_tags_post ON post_tags (post_id);
CREATE INDEX idx_post_tags_tag ON post_tags (tag_id);
-- Or a composite index:
CREATE UNIQUE INDEX idx_post_tags_both ON post_tags (post_id, tag_id);

-- Push filters down into joins
-- SLOW: Filter after joining millions of rows
SELECT * FROM orders o
JOIN products p ON p.id = o.product_id
WHERE o.created_at > '2024-01-01';

-- FAST: Optimizer usually does this, but be explicit if needed
SELECT * FROM (
    SELECT * FROM orders WHERE created_at > '2024-01-01'
) o
JOIN products p ON p.id = o.product_id;

-- Avoid joining on expressions
-- SLOW:
SELECT * FROM a JOIN b ON LOWER(a.code) = LOWER(b.code);
-- FAST: normalize data or use expression index
```

## Window Functions

### Basic Window Functions

```sql
-- ROW_NUMBER: unique sequential number
SELECT name, department, salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rank
FROM employees;
-- Get top 3 earners per department:
WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rn
    FROM employees
)
SELECT * FROM ranked WHERE rn <= 3;

-- RANK: same rank for ties, gaps after
SELECT name, score,
    RANK() OVER (ORDER BY score DESC) AS rank
FROM leaderboard;
-- Scores: 100, 95, 95, 90 -> Ranks: 1, 2, 2, 4

-- DENSE_RANK: same rank for ties, no gaps
SELECT name, score,
    DENSE_RANK() OVER (ORDER BY score DESC) AS rank
FROM leaderboard;
-- Scores: 100, 95, 95, 90 -> Ranks: 1, 2, 2, 3

-- NTILE: distribute rows into N buckets
SELECT name, salary,
    NTILE(4) OVER (ORDER BY salary) AS quartile
FROM employees;
```

### Aggregate Window Functions

```sql
-- Running total
SELECT date, amount,
    SUM(amount) OVER (ORDER BY date) AS running_total
FROM transactions;

-- Running average
SELECT date, amount,
    AVG(amount) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS moving_avg_7day
FROM daily_sales;

-- Percentage of total
SELECT department, salary,
    salary::numeric / SUM(salary) OVER () * 100 AS pct_of_total,
    salary::numeric / SUM(salary) OVER (PARTITION BY department) * 100 AS pct_of_dept
FROM employees;

-- Count within window
SELECT date, category,
    COUNT(*) OVER (PARTITION BY category ORDER BY date
                   RANGE BETWEEN INTERVAL '30 days' PRECEDING AND CURRENT ROW) AS count_last_30d
FROM events;
```

### Navigation Functions

```sql
-- LAG: value from previous row
-- LEAD: value from next row
SELECT date, close_price,
    LAG(close_price) OVER (ORDER BY date) AS prev_close,
    close_price - LAG(close_price) OVER (ORDER BY date) AS daily_change,
    LEAD(close_price) OVER (ORDER BY date) AS next_close
FROM stock_prices;

-- FIRST_VALUE / LAST_VALUE
SELECT date, close_price,
    FIRST_VALUE(close_price) OVER (ORDER BY date) AS first_price,
    close_price - FIRST_VALUE(close_price) OVER (ORDER BY date) AS change_from_start
FROM stock_prices;
-- Note: LAST_VALUE needs frame specification!
SELECT date, close_price,
    LAST_VALUE(close_price) OVER (
        ORDER BY date
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS last_price
FROM stock_prices;

-- NTH_VALUE
SELECT name, salary,
    NTH_VALUE(salary, 2) OVER (
        PARTITION BY department ORDER BY salary DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS second_highest
FROM employees;
```

### Window Frame Clauses

```sql
-- ROWS: physical row count
SUM(amount) OVER (ORDER BY date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
-- Exactly 3 rows: 2 before + current

-- RANGE: logical value range
SUM(amount) OVER (ORDER BY date RANGE BETWEEN INTERVAL '7 days' PRECEDING AND CURRENT ROW)
-- All rows within 7 days before current row's date

-- GROUPS (PostgreSQL 11+): groups of peers
SUM(amount) OVER (ORDER BY date GROUPS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
-- Include the group before and after current group

-- Frame boundaries:
-- UNBOUNDED PRECEDING: start of partition
-- N PRECEDING: N rows/range before current
-- CURRENT ROW
-- N FOLLOWING: N rows/range after current
-- UNBOUNDED FOLLOWING: end of partition

-- Named windows (DRY principle)
SELECT
    SUM(amount) OVER w AS running_total,
    AVG(amount) OVER w AS running_avg,
    COUNT(*) OVER w AS running_count
FROM transactions
WINDOW w AS (PARTITION BY account_id ORDER BY date);
```

## Common Table Expressions (CTEs)

### Basic CTEs

```sql
-- Simple CTE for readability
WITH active_users AS (
    SELECT id, name, email
    FROM users
    WHERE status = 'active' AND last_login > NOW() - INTERVAL '30 days'
),
user_orders AS (
    SELECT u.id, u.name, COUNT(o.id) AS order_count, SUM(o.total) AS total_spent
    FROM active_users u
    JOIN orders o ON o.user_id = u.id
    WHERE o.created_at > NOW() - INTERVAL '90 days'
    GROUP BY u.id, u.name
)
SELECT name, order_count, total_spent,
    total_spent / NULLIF(order_count, 0) AS avg_order_value
FROM user_orders
WHERE order_count >= 3
ORDER BY total_spent DESC;
```

### Recursive CTEs

```sql
-- Organizational hierarchy (tree traversal)
WITH RECURSIVE org_tree AS (
    -- Base case: top-level managers
    SELECT id, name, manager_id, 1 AS depth,
           name::text AS path
    FROM employees
    WHERE manager_id IS NULL

    UNION ALL

    -- Recursive case: employees reporting to someone in the tree
    SELECT e.id, e.name, e.manager_id, t.depth + 1,
           t.path || ' > ' || e.name
    FROM employees e
    JOIN org_tree t ON e.manager_id = t.id
    WHERE t.depth < 10  -- safety limit
)
SELECT * FROM org_tree ORDER BY path;

-- Generate a date series (when generate_series isn't available)
WITH RECURSIVE dates AS (
    SELECT DATE '2024-01-01' AS date
    UNION ALL
    SELECT date + INTERVAL '1 day'
    FROM dates
    WHERE date < '2024-12-31'
)
SELECT d.date, COALESCE(COUNT(o.id), 0) AS orders
FROM dates d
LEFT JOIN orders o ON DATE(o.created_at) = d.date
GROUP BY d.date;

-- Bill of materials (parts explosion)
WITH RECURSIVE bom AS (
    SELECT part_id, component_id, quantity, 1 AS level
    FROM assemblies
    WHERE part_id = 'PRODUCT-001'

    UNION ALL

    SELECT b.part_id, a.component_id, b.quantity * a.quantity, b.level + 1
    FROM bom b
    JOIN assemblies a ON a.part_id = b.component_id
    WHERE b.level < 20
)
SELECT component_id, SUM(quantity) AS total_needed
FROM bom
GROUP BY component_id;

-- Graph traversal: shortest path
WITH RECURSIVE paths AS (
    SELECT target AS node, 1 AS hops, ARRAY[source, target] AS path
    FROM edges
    WHERE source = 'A'

    UNION ALL

    SELECT e.target, p.hops + 1, p.path || e.target
    FROM paths p
    JOIN edges e ON e.source = p.node
    WHERE e.target != ALL(p.path)  -- prevent cycles
    AND p.hops < 10
)
SELECT node, MIN(hops) AS shortest_path
FROM paths
GROUP BY node;
```

### Materialized CTEs

```sql
-- PostgreSQL: force CTE to materialize (computed once, results cached)
WITH active_users AS MATERIALIZED (
    SELECT * FROM users WHERE status = 'active'
)
SELECT * FROM active_users WHERE email LIKE '%@company.com'
UNION ALL
SELECT * FROM active_users WHERE created_at > '2024-01-01';

-- PostgreSQL 12+: NOT MATERIALIZED (allow optimizer to inline)
WITH user_counts AS NOT MATERIALIZED (
    SELECT user_id, COUNT(*) AS cnt FROM orders GROUP BY user_id
)
SELECT * FROM user_counts WHERE cnt > 10;
-- Optimizer can push the cnt > 10 filter into the CTE
```

## Transactions

### Transaction Isolation Levels

```sql
-- READ UNCOMMITTED: dirty reads possible (rarely used)
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- READ COMMITTED (PostgreSQL default): no dirty reads
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- Each statement sees committed data as of statement start
-- Same query can return different results within one transaction

-- REPEATABLE READ (MySQL default): snapshot at transaction start
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- All queries see the same snapshot
-- Prevents non-repeatable reads
-- PostgreSQL: also prevents phantom reads

-- SERIALIZABLE: full isolation, as if transactions ran serially
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
-- Safest but slowest; may get serialization errors
-- Must be prepared to retry on failure
```

### Transaction Patterns

```sql
-- Basic transaction
BEGIN;
INSERT INTO accounts (id, balance) VALUES (1, 1000);
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

-- With error handling (PostgreSQL)
BEGIN;
SAVEPOINT before_transfer;

UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- Check constraint might fail
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

-- On error:
ROLLBACK TO SAVEPOINT before_transfer;
-- Try alternative logic...
COMMIT;

-- Advisory locks (PostgreSQL): application-level locking
SELECT pg_advisory_lock(hashtext('process-payments'));
-- Do exclusive work...
SELECT pg_advisory_unlock(hashtext('process-payments'));

-- Try lock (non-blocking)
SELECT pg_try_advisory_lock(12345);  -- returns true/false

-- Row-level locking
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;          -- exclusive lock
SELECT * FROM accounts WHERE id = 1 FOR SHARE;           -- shared lock
SELECT * FROM accounts WHERE id = 1 FOR UPDATE NOWAIT;   -- fail immediately if locked
SELECT * FROM accounts WHERE id = 1 FOR UPDATE SKIP LOCKED; -- skip locked rows
```

### Deadlock Prevention

```sql
-- Rule 1: Always lock rows in the same order
-- BAD: Transaction A locks row 1 then 2; Transaction B locks row 2 then 1
-- GOOD: Both transactions lock row 1 first, then row 2

-- Sort IDs before locking:
BEGIN;
SELECT * FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;
-- Now safe to update both
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

-- Rule 2: Keep transactions short
-- Rule 3: Use appropriate isolation level (don't over-isolate)
-- Rule 4: Set lock timeout
SET lock_timeout = '5s';  -- PostgreSQL
SET innodb_lock_wait_timeout = 5;  -- MySQL

-- Rule 5: Use SKIP LOCKED for queue patterns
-- Worker pattern: each worker grabs an unlocked row
BEGIN;
SELECT id, payload FROM job_queue
WHERE status = 'pending'
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;

UPDATE job_queue SET status = 'processing' WHERE id = :selected_id;
COMMIT;
```

## PostgreSQL-Specific

### PostgreSQL Data Types

```sql
-- JSONB: binary JSON with indexing
CREATE TABLE events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data jsonb NOT NULL,
    created_at timestamptz DEFAULT NOW()
);

-- JSONB operators
SELECT data->>'name' AS name,          -- text extraction
       data->'address'->>'city' AS city, -- nested extraction
       data#>>'{tags,0}' AS first_tag   -- path extraction
FROM events
WHERE data @> '{"type": "click"}'       -- containment
  AND data ? 'email'                     -- key exists
  AND (data->>'score')::int > 90;        -- cast and compare

-- JSONB modification
UPDATE events SET data = data || '{"processed": true}';  -- merge
UPDATE events SET data = data - 'temp_field';             -- remove key
UPDATE events SET data = jsonb_set(data, '{address,zip}', '"10001"');

-- Array type
CREATE TABLE posts (
    id serial PRIMARY KEY,
    title text NOT NULL,
    tags text[] DEFAULT '{}'
);

INSERT INTO posts (title, tags) VALUES ('SQL Tips', ARRAY['sql', 'database', 'optimization']);

SELECT * FROM posts WHERE 'sql' = ANY(tags);
SELECT * FROM posts WHERE tags @> ARRAY['sql', 'database'];
SELECT * FROM posts WHERE array_length(tags, 1) > 2;

-- Range types
CREATE TABLE reservations (
    id serial PRIMARY KEY,
    room_id int NOT NULL,
    during tstzrange NOT NULL,
    EXCLUDE USING gist (room_id WITH =, during WITH &&)  -- no overlapping bookings!
);

INSERT INTO reservations (room_id, during)
VALUES (1, tstzrange('2024-03-01 09:00', '2024-03-01 10:00'));
-- Overlapping insert will fail due to exclusion constraint

-- UUID
CREATE TABLE users (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL
);

-- Generated columns
CREATE TABLE products (
    price_cents int NOT NULL,
    tax_rate numeric(5,4) NOT NULL DEFAULT 0.0875,
    total_cents int GENERATED ALWAYS AS (price_cents + (price_cents * tax_rate)::int) STORED
);
```

### PostgreSQL Performance

```sql
-- Table statistics
SELECT relname, n_live_tup, n_dead_tup,
       round(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- Check for table bloat
SELECT schemaname, tablename,
    pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname || '.' || tablename)) AS table_size,
    pg_size_pretty(pg_indexes_size(schemaname || '.' || tablename)) AS index_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;

-- Active queries and locks
SELECT pid, state, query, wait_event_type, wait_event,
    NOW() - query_start AS duration
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;

-- Kill a long-running query
SELECT pg_cancel_backend(pid);    -- graceful (SIGINT)
SELECT pg_terminate_backend(pid); -- force (SIGTERM)

-- Connection pooling settings
-- Use PgBouncer or built-in connection limits
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';  -- 25% of RAM
ALTER SYSTEM SET effective_cache_size = '768MB';  -- 75% of RAM
ALTER SYSTEM SET work_mem = '4MB';  -- per-operation sort memory

-- VACUUM: reclaim dead rows
VACUUM (VERBOSE) users;
VACUUM (ANALYZE) users;  -- also update statistics
-- Autovacuum settings
ALTER TABLE high_churn_table SET (
    autovacuum_vacuum_scale_factor = 0.05,  -- vacuum at 5% dead (default 20%)
    autovacuum_analyze_scale_factor = 0.02
);
```

### PostgreSQL Full-Text Search

```sql
-- Create tsvector column with index
ALTER TABLE articles ADD COLUMN search_vector tsvector;
UPDATE articles SET search_vector =
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(body, '')), 'B');
CREATE INDEX idx_articles_search ON articles USING gin (search_vector);

-- Auto-update with trigger
CREATE FUNCTION update_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.body, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_search_vector
    BEFORE INSERT OR UPDATE OF title, body ON articles
    FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- Search with ranking
SELECT title, ts_rank(search_vector, query) AS rank
FROM articles, to_tsquery('english', 'database & optimization') query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 20;

-- Phrase search
SELECT * FROM articles
WHERE search_vector @@ phraseto_tsquery('english', 'query optimization');

-- Headline (highlighted snippets)
SELECT ts_headline('english', body, to_tsquery('database & optimization'),
    'StartSel=<b>, StopSel=</b>, MaxFragments=3')
FROM articles
WHERE search_vector @@ to_tsquery('database & optimization');
```

## MySQL-Specific

### MySQL Gotchas

```sql
-- 1. Implicit type conversion silently breaks index usage
SELECT * FROM users WHERE phone = 1234567890;  -- phone is VARCHAR
-- MySQL converts every row's phone to int! Full table scan.
-- Fix: Use correct type: WHERE phone = '1234567890'

-- 2. GROUP BY with non-aggregated columns (ONLY_FULL_GROUP_BY)
-- MySQL used to allow this (returning arbitrary values):
SELECT department, name, MAX(salary) FROM employees GROUP BY department;
-- Fix: Enable ONLY_FULL_GROUP_BY (default in 8.0+) or use window functions

-- 3. Zero-date handling
-- '0000-00-00' is valid in MySQL but breaks most applications
SET SQL_MODE = 'NO_ZERO_DATE,NO_ZERO_IN_DATE,STRICT_TRANS_TABLES';

-- 4. utf8 is NOT real UTF-8 (only 3 bytes, no emoji support)
-- Always use utf8mb4:
CREATE TABLE posts (
    content TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
);
ALTER DATABASE mydb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. TIMESTAMP vs DATETIME
-- TIMESTAMP: stored as UTC, converted to session timezone (range: 1970-2038)
-- DATETIME: stored as-is, no timezone conversion (range: 1000-9999)
-- Recommendation: Use TIMESTAMP for events, DATETIME for user-entered dates

-- 6. InnoDB lock behavior with UPDATE
-- UPDATE without WHERE locks ALL rows in the table if no index matches
UPDATE users SET status = 'inactive' WHERE email = 'test@example.com';
-- If email is not indexed, this locks every row!

-- 7. LIMIT without ORDER BY is non-deterministic
SELECT * FROM users LIMIT 10;  -- order may vary between executions!
-- Always: SELECT * FROM users ORDER BY id LIMIT 10;
```

### MySQL Performance Tips

```sql
-- Online DDL (non-blocking schema changes)
ALTER TABLE users ADD COLUMN phone VARCHAR(20), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE users ADD INDEX idx_phone (phone), ALGORITHM=INPLACE, LOCK=NONE;

-- For large tables, use pt-online-schema-change or gh-ost:
-- pt-online-schema-change --alter "ADD COLUMN phone VARCHAR(20)" D=mydb,t=users
-- gh-ost --alter "ADD COLUMN phone VARCHAR(20)" --database=mydb --table=users --execute

-- Buffer pool sizing
SET GLOBAL innodb_buffer_pool_size = 2147483648;  -- 2GB (70-80% of RAM)

-- Query cache (removed in MySQL 8.0, use ProxySQL or app cache)

-- Partitioning for large tables
CREATE TABLE logs (
    id bigint AUTO_INCREMENT,
    message text,
    created_at datetime NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
-- Drop old partitions (instant, no row-by-row delete):
ALTER TABLE logs DROP PARTITION p2023;
```

## N+1 Problem

### Identifying N+1 Queries

```python
# N+1 PROBLEM: 1 query for users + N queries for orders

# BAD: N+1 with SQLAlchemy
users = session.query(User).all()  # 1 query
for user in users:
    print(user.orders)  # N queries (one per user!)

# GOOD: Eager loading
users = session.query(User).options(joinedload(User.orders)).all()  # 1 query with JOIN
# Or subquery loading:
users = session.query(User).options(subqueryload(User.orders)).all()  # 2 queries total

# GOOD: Select related (Django)
users = User.objects.prefetch_related('orders').all()  # 2 queries
users = User.objects.select_related('profile').all()   # 1 query with JOIN
```

```javascript
// N+1 with Prisma
// BAD:
const users = await prisma.user.findMany();
for (const user of users) {
  const orders = await prisma.order.findMany({ where: { userId: user.id } });
}

// GOOD: Include related data
const users = await prisma.user.findMany({
  include: { orders: true },
});

// GOOD: Select only needed fields
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    orders: { select: { id: true, total: true } },
  },
});
```

```sql
-- Raw SQL solution: single query with JOIN
SELECT u.id, u.name, o.id AS order_id, o.total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
ORDER BY u.id;

-- Or batch loading with IN clause (what ORMs do with prefetch)
-- Query 1: Get users
SELECT * FROM users WHERE active = true;
-- Query 2: Get all orders for those users in one query
SELECT * FROM orders WHERE user_id IN (1, 2, 3, 4, 5);
```

## Bulk Operations

### Efficient Inserts

```sql
-- Single-row insert (slowest)
INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com');

-- Multi-row insert (much faster)
INSERT INTO users (name, email) VALUES
    ('Alice', 'alice@example.com'),
    ('Bob', 'bob@example.com'),
    ('Charlie', 'charlie@example.com');

-- PostgreSQL: COPY (fastest for bulk loading)
COPY users (name, email) FROM '/path/to/data.csv' WITH (FORMAT CSV, HEADER);
-- From stdin:
COPY users (name, email) FROM STDIN WITH (FORMAT CSV);
Alice,alice@example.com
Bob,bob@example.com
\.

-- PostgreSQL: Upsert (INSERT ... ON CONFLICT)
INSERT INTO users (email, name, updated_at)
VALUES ('alice@example.com', 'Alice Smith', NOW())
ON CONFLICT (email)
DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at;

-- Bulk upsert with unnest (PostgreSQL)
INSERT INTO products (sku, name, price)
SELECT * FROM unnest(
    ARRAY['SKU1', 'SKU2', 'SKU3'],
    ARRAY['Product 1', 'Product 2', 'Product 3'],
    ARRAY[9.99, 19.99, 29.99]
)
ON CONFLICT (sku) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price;

-- MySQL: Upsert
INSERT INTO users (email, name) VALUES ('alice@example.com', 'Alice Smith')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- MySQL: LOAD DATA (fastest bulk insert)
LOAD DATA INFILE '/path/to/data.csv'
INTO TABLE users
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(name, email);
```

### Efficient Updates and Deletes

```sql
-- Batch update with CASE
UPDATE products SET price = CASE sku
    WHEN 'SKU1' THEN 9.99
    WHEN 'SKU2' THEN 19.99
    WHEN 'SKU3' THEN 29.99
END
WHERE sku IN ('SKU1', 'SKU2', 'SKU3');

-- PostgreSQL: Update from a VALUES list
UPDATE products AS p SET
    price = v.price,
    name = v.name
FROM (VALUES
    ('SKU1', 'New Name 1', 9.99),
    ('SKU2', 'New Name 2', 19.99)
) AS v(sku, name, price)
WHERE p.sku = v.sku;

-- Batch delete with limits (avoid locking huge tables)
-- Delete in chunks:
DO $$
DECLARE
    deleted_count int;
BEGIN
    LOOP
        DELETE FROM logs
        WHERE id IN (
            SELECT id FROM logs
            WHERE created_at < NOW() - INTERVAL '90 days'
            LIMIT 10000
        );
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        EXIT WHEN deleted_count = 0;
        PERFORM pg_sleep(0.1);  -- brief pause to reduce lock pressure
    END LOOP;
END $$;

-- MySQL batch delete:
REPEAT
    DELETE FROM logs
    WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
    LIMIT 10000;
UNTIL ROW_COUNT() = 0 END REPEAT;

-- Truncate (instant, but locks table and resets auto-increment)
TRUNCATE TABLE temp_data;
-- PostgreSQL: TRUNCATE with cascade
TRUNCATE TABLE parent_table CASCADE;
```

## Schema Design Patterns

### Common Patterns

```sql
-- Soft delete
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
CREATE INDEX idx_users_active ON users (id) WHERE deleted_at IS NULL;
-- All queries: WHERE deleted_at IS NULL

-- Audit trail with triggers
CREATE TABLE audit_log (
    id bigserial PRIMARY KEY,
    table_name text NOT NULL,
    record_id bigint NOT NULL,
    action text NOT NULL,  -- INSERT, UPDATE, DELETE
    old_data jsonb,
    new_data jsonb,
    changed_by text,
    changed_at timestamptz DEFAULT NOW()
);

CREATE FUNCTION audit_trigger() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), current_user);
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), current_user);
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), current_user);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_audit
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- Polymorphic associations (type + id pattern)
CREATE TABLE comments (
    id serial PRIMARY KEY,
    commentable_type text NOT NULL,  -- 'Post', 'Photo', 'Video'
    commentable_id int NOT NULL,
    body text NOT NULL,
    created_at timestamptz DEFAULT NOW()
);
CREATE INDEX idx_comments_target ON comments (commentable_type, commentable_id);

-- Better alternative: separate join tables
CREATE TABLE post_comments (
    comment_id int REFERENCES comments(id),
    post_id int REFERENCES posts(id),
    PRIMARY KEY (comment_id)
);

-- Entity-Attribute-Value (EAV) — use sparingly, prefer JSONB
CREATE TABLE product_attributes (
    product_id int REFERENCES products(id),
    attribute_name text NOT NULL,
    attribute_value text,
    PRIMARY KEY (product_id, attribute_name)
);

-- Better: JSONB column
ALTER TABLE products ADD COLUMN attributes jsonb DEFAULT '{}';
-- With validation:
ALTER TABLE products ADD CONSTRAINT check_attrs
    CHECK (jsonb_typeof(attributes) = 'object');
```

### Migration Best Practices

```sql
-- Safe column addition (no lock on large tables)
ALTER TABLE users ADD COLUMN phone text;  -- NULL default, instant

-- Unsafe: adding NOT NULL column with default on large table
-- PostgreSQL 11+: this is actually instant (stores default in catalog)
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user';

-- Safe index creation
CREATE INDEX CONCURRENTLY idx_users_phone ON users (phone);
-- Runs in background, doesn't block writes

-- Safe column rename (requires application change coordination)
-- Step 1: Add new column
ALTER TABLE users ADD COLUMN full_name text;
-- Step 2: Backfill
UPDATE users SET full_name = name WHERE full_name IS NULL;
-- Step 3: Deploy code that reads/writes both columns
-- Step 4: Stop writing old column
-- Step 5: Drop old column
ALTER TABLE users DROP COLUMN name;

-- Safe type change: add new column, migrate, swap
ALTER TABLE orders ADD COLUMN amount_numeric numeric(12,2);
UPDATE orders SET amount_numeric = amount::numeric;
ALTER TABLE orders DROP COLUMN amount;
ALTER TABLE orders RENAME COLUMN amount_numeric TO amount;
```
