# Database Knowledge Roadmap — Senior / Tech Lead

Checklist of database knowledge areas expected at senior/tech-lead level. Items already covered by notes in this repo are checked and linked; the rest are open topics to write up as you learn them.

---

## 1. Core internals & performance

- [x] Storage engine internals, pages, B-tree/B+ tree indexes — [[how-databases-work-internally]], [[indexes-fundamentals]]
- [x] ACID properties, MVCC — [[acid-properties]]
- [x] Index types, JOIN mechanics, WHERE vs HAVING — [[indexes-types]], [[joins]], [[where-vs-having]]
- [ ] Query execution plans in depth — reading `EXPLAIN ANALYZE`, spotting bad plans (seq scan on large table, nested loop blowup, missing/stale stats), forcing plan choices
- [ ] Locking internals — row locks, gap locks, deadlock detection/resolution, lock escalation, `SELECT ... FOR UPDATE` / `SKIP LOCKED`

## 2. Data modeling & schema design

- [x] Design best practices — [[database-design-best-practices]]
- [ ] Normalization vs denormalization tradeoffs at scale (when 3NF actively hurts)
- [x] Schema migration strategy on a live production table with billions of rows (online DDL, expand/contract pattern, backfills without locking) — [[schema-migration-strategy]]
- [ ] Multi-tenancy patterns — shared table with `tenant_id` vs schema-per-tenant vs DB-per-tenant, operational cost of each

## 3. Transactions & concurrency

- [ ] Isolation levels in practice — which anomalies each level actually permits, picking the right one per use case
- [ ] Distributed transactions — two-phase commit, saga pattern, outbox pattern for eventual consistency across services
- [ ] Idempotency at the DB layer — unique constraints as a concurrency-safety tool, upserts, optimistic locking (version columns) vs pessimistic locking

## 4. Scaling & distributed systems

- [x] Partitioning, scaling basics — [[database-partitioning]], [[database-scaling]]
- [ ] Sharding strategy — choosing a shard key, resharding without downtime, cross-shard queries/joins, hot-shard problems
- [ ] CAP/PACELC tradeoffs as a design tool — picking CP vs AP per feature, not per database
- [ ] Read replicas & replication lag — designing APIs/UX around eventual consistency (read-your-writes guarantees, sticky sessions)

## 5. Replication & high availability

- [ ] Replication mechanisms — sync vs async, streaming/logical replication, failover mechanics (who promotes a new primary, split-brain risk)
- [ ] Backup & disaster recovery — RPO/RTO targets, point-in-time recovery, testing restores (not just taking backups)
- [ ] Zero-downtime deploys involving schema changes

## 6. Polyglot persistence

- [x] SQL vs NoSQL fundamentals — [[sql-vs-nosql]]
- [ ] Choosing the right store per workload as a team-level decision: OLTP (Postgres/MySQL) vs OLAP (ClickHouse) vs cache (Redis) vs search (Elasticsearch) vs time-series (TimescaleDB/InfluxDB) — and justifying it to stakeholders
- [ ] CQRS — separating write model from read model, when it's worth the complexity

## 7. Operational / production concerns

- [ ] Connection pool sizing under real load — pool size vs DB `max_connections` vs number of app instances, pool exhaustion incident response (builds on [[pooling-connection]])
- [ ] Query performance regression detection — `pg_stat_statements`, slow query logs, alerting on p99 latency before it pages someone
- [ ] Capacity planning — projecting when a table/index will outgrow current hardware, vertical vs horizontal scale timing
- [ ] Incident response for DB issues — runbook for "DB is at 100% CPU right now," lock contention triage, killing runaway queries safely

## 8. Security & compliance

- [ ] Least-privilege DB access — role-based access, row-level security, credential rotation
- [ ] Data protection — encryption at rest/in transit, PII handling, audit logging, GDPR-style deletion requirements (hard with soft-delete + replicas + backups)
- [ ] SQL injection defense at the ORM/query-builder level — where parameterization breaks down (dynamic column/table names, `ORDER BY` injection)

## 9. Tech-lead-specific

- [ ] Cost tradeoffs — read replica vs cache layer vs bigger instance, communicating tradeoffs to non-engineers
- [ ] Vendor/tool evaluation — managed (RDS/Aurora/Atlas) vs self-hosted, what you're actually paying for (failover automation, backups, at 2-3x cost)
- [ ] Mentoring on query review — building team habits like "always check EXPLAIN before merging a new query," index review as part of PR process

---

## Notes

- Biggest current gaps: locking/isolation levels in practice, schema migrations on live large tables, sharding strategy, replication/failover, operational incident response.
- These show up constantly in senior/staff system design interviews and are also where most real production incidents originate.
