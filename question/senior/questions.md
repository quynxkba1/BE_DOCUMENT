# Backend Interview Questions — Senior Level

> Focus: distributed systems, scalable architecture, security depth, DevOps, technical leadership.
> Key signal: strategic thinking and ownership of the whole system.

---

## Distributed Systems

1. **Explain the CAP theorem. Give a real-world example of each trade-off.**
   - Can only guarantee 2 of 3: Consistency, Availability, Partition tolerance. Cassandra = AP, PostgreSQL = CP

2. **What is eventual consistency and when is it acceptable?**
   - OK for likes/view counts — NOT OK for bank balances or inventory deductions

3. **What is a distributed transaction? What is the Saga pattern?**
   - Saga = sequence of local transactions with compensating actions on failure (choreography vs orchestration)

4. **What are the challenges of microservices vs monolith? When would you NOT use microservices?**
   - Small teams often better with modular monolith — microservices add complexity in debugging, tracing, consistency

5. **Explain the difference between synchronous and asynchronous communication in microservices.**
   - Sync (HTTP/gRPC) = tight coupling, Async (Kafka/RabbitMQ) = decoupled, better fault tolerance

---

## System Design

1. **Design a URL shortener (like Bitly) that handles 100M requests/day.**
   - Hash function → check collision → cache hot URLs in Redis → CDN → DB sharding by hash

2. **Design a real-time notification system.**
   - WebSockets or SSE for delivery, message queue (Kafka) for fan-out, Redis for active connections

3. **Design a rate limiter for a public API.**
   - Token bucket or sliding window counter in Redis — per IP or per user token

4. **How would you design a backend for uploading and serving millions of images?**
   - S3 for storage, CDN for serving, async background job for resizing, metadata in DB

5. **Design an authentication and SSO platform.**
   - OAuth 2.0 + OIDC, JWT with short TTL, refresh token rotation, centralized token validation

---

## DevOps & Infrastructure

1. **What is the difference between Deployment, ReplicaSet, and StatefulSet in Kubernetes?**
   - ReplicaSet = fixed pod count, Deployment = rolling updates, StatefulSet = stable identity (DBs)

2. **How do you manage secrets in Kubernetes?**
   - Kubernetes Secrets + HashiCorp Vault or AWS Secrets Manager + KMS encryption at rest

3. **What is the difference between Terraform and Ansible?**
   - Terraform = provision infra (VMs, DBs), Ansible = configure systems (install packages, configs)

4. **Explain blue/green vs canary deployment strategies.**
   - Blue/green = instant switch, canary = gradual traffic shift — canary reduces blast radius

5. **How do you debug a pod that keeps crashing in Kubernetes?**
   - `kubectl describe pod` → check events, `kubectl logs --previous` → check misconfig, resource limits

---

## Security (Advanced)

1. **What is the Zero Trust security model?**
   - "Never trust, always verify" — every request authenticated and authorized even inside the network

2. **How would you secure a microservices architecture?**
   - mTLS between services, API Gateway for external auth, centralized secrets, network policies, RBAC

3. **What is encryption at rest vs in transit?**
   - At rest = encrypted stored data (disk/DB), in transit = TLS/HTTPS/mTLS. Both required for compliance

4. **What is a DDoS attack and how do you mitigate it?**
   - WAF + rate limiting + CDN (Cloudflare, AWS Shield) + auto-scaling + traffic anomaly detection

---

## Architecture Patterns

1. **What is CQRS and when would you use it?**
   - Separate read and write models — useful for high read/write ratio, event-sourced systems

2. **What is event sourcing? How is it different from traditional state storage?**
   - Store events (what happened) not current state — enables full audit log, replay, time travel

3. **What is the BASE property of a system?**
   - Basically Available, Soft state, Eventual consistency — describes NoSQL systems (vs ACID for SQL)

4. **How do you design for failure (fault tolerance patterns)?**
   - Circuit breaker, retry with backoff, bulkhead, timeout, fallback — e.g. Resilience4j

---

## Leadership & Process

1. **How do you decide when to refactor vs rewrite a system?**
   - Refactor if structure is salvageable, rewrite if core assumptions are wrong — consider migration cost

2. **How do you approach technical debt in a fast-moving team?**
   - Track it explicitly, allocate ~20% capacity, distinguish intentional vs accidental debt

3. **How do you mentor junior developers effectively?**
   - Code reviews, pair programming, clear feedback, create safe space to fail — teach reasoning not just answers

4. **Describe your approach to a post-mortem after a production incident.**
   - Blameless, focus on systems not people — 5 Whys, timeline, action items with owners and deadlines
