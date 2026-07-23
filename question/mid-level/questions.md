# Backend Interview Questions — Mid-level

> Focus: ownership, trade-offs, scalability basics, API design depth, database optimization, testing, caching.
> Key signal: reasoning about production concerns.

---

## Architecture & Design

1. **What is the difference between monolithic, SOA, and microservices architecture?**
   - Monolith = one app, SOA = services via ESB, microservices = small independent services

2. **Explain DRY, SOLID, and KISS principles. Give a real example.**
   - Focus on Single Responsibility and Open/Closed in backend code

3. **What is an API Gateway pattern?**
   - Single entry point — handles auth, rate limiting, routing, logging

4. **When would you use REST vs GraphQL vs gRPC?**
   - REST = standard CRUD, GraphQL = flexible queries, gRPC = internal service-to-service (low latency)

5. **What is idempotency? Why does it matter in distributed systems?**
   - Same request = same result — critical for payments, retries, message queues

---

## Database (Advanced)

1. **What is the difference between clustered and non-clustered indexes?**
   - Clustered = physical order of data, only one per table. Non-clustered = logical order, multiple allowed

2. **Explain the N+1 query problem and how to fix it.**
   - 1 query for list + N queries for each item — fix with eager loading / JOIN

3. **How do you handle database migrations in production?**
   - Backward-compatible changes, blue/green deploys, avoid locking large tables

4. **What is database replication? Leader vs replica?**
   - Leader handles writes, replicas handle reads — improves read scalability

5. **What is the difference between optimistic and pessimistic locking?**
   - Optimistic = retry on conflict (low contention), pessimistic = lock before access (high contention)

---

## Caching & Performance

1. **What is caching and when should you use it?**
   - Reduce DB load for frequently read, rarely changed data — user profile, config, product catalog

2. **What is a cache invalidation strategy? (TTL, write-through, write-behind)**
   - Write-through = update cache + DB together, TTL = expire after time, write-behind = async DB update

3. **What is the difference between Redis and a regular database?**
   - Redis = in-memory, sub-millisecond reads, best for sessions, leaderboards, pub/sub

4. **What is the difference between vertical and horizontal scaling?**
   - Vertical = bigger server, horizontal = more servers. Horizontal is preferred for high availability

---

## Auth & Security

1. **How does JWT authentication work? What are its weaknesses?**
   - Stateless, self-contained — weakness: can't revoke tokens until expiry unless blacklist

2. **What is OAuth 2.0? What are the main grant types?**
   - Authorization Code (web), Client Credentials (machine-to-machine), Device Code (TV/CLI)

3. **Explain XSS and CSRF attacks and their prevention.**
   - XSS = inject scripts → use CSP + escape output. CSRF = fake requests → CSRF tokens + SameSite cookies

4. **What is rate limiting and how would you implement it?**
   - Token bucket or sliding window — implement with Redis at the API gateway level

---

## Testing

1. **What is the difference between unit, integration, and e2e tests?**
   - Unit = single function, integration = multiple layers together, e2e = full user flow

2. **What is test coverage and is 100% coverage always the goal?**
   - No — focus on critical paths and business logic, not trivial getters/setters

3. **What is mocking and when should you use it in tests?**
   - Replace real dependencies (DB, HTTP) with fakes — isolates unit under test

---

## Observability

1. **What is the difference between logging, metrics, and tracing?**
   - Logs = events, metrics = aggregated numbers (latency/count), traces = request path through services

2. **Your DB is down at 2 AM. Walk me through your first 5 minutes.**
   - Check monitoring → recent deploys → DB connections/locks → external deps → infra (CPU/memory)
