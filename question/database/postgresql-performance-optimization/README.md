# PostgreSQL Performance Optimization Series

> Condensed notes from the Viblo series: [Performance Optimization với PostgreSQL](https://viblo.asia/s/performance-optimization-voi-postgresql-OVlYq8oal8W) by Dat Bui.

Each file is a short summary of one article — key points and SQL examples only, not a full translation. For deeper standalone coverage of indexes/joins/partitioning in this repo, see `indexes-fundamentals.md`, `indexes-types.md`, `joins.md`, `database-partitioning.md`.

| # | Topic | File | Source |
|---|---|---|---|
| 001 | Ways to optimize a SQL query | [001-sql-query-optimization-overview.md](./001-sql-query-optimization-overview.md) | [viblo](https://viblo.asia/p/001-co-nhung-cach-nao-de-toi-uu-sql-query-RnB5pVgrZPG) |
| 002 | Index fundamentals (P1) | [002-index-fundamentals.md](./002-index-fundamentals.md) | [viblo](https://viblo.asia/p/002-hieu-ve-index-de-tang-performance-voi-postgresql-p1-3Q75wV3elWb) |
| 003 | B-Tree & Bitmap index (P2) | [003-btree-bitmap-index.md](./003-btree-bitmap-index.md) | [viblo](https://viblo.asia/p/003-hieu-ve-index-de-tang-performance-voi-postgresql-p2-m68Z049MZkG) |
| 004 | Hash index (P3) | [004-hash-index.md](./004-hash-index.md) | [viblo](https://viblo.asia/p/004-hieu-ve-index-de-tang-performance-voi-postgresql-p3-ByEZkrB4KQ0) |
| 005 | Join algorithms | [005-join-algorithms.md](./005-join-algorithms.md) | [viblo](https://viblo.asia/p/005-hieu-ve-join-de-tang-performance-voi-postgresql-924lJjpXlPM) |
| 006 | Partitioning (P1) | [006-partitioning-p1.md](./006-partitioning-p1.md) | [viblo](https://viblo.asia/p/006-partitioning-data-voi-postgresql-p1-1VgZvr87ZAw) |
| 007 | Partitioning (P2) | [007-partitioning-p2.md](./007-partitioning-p2.md) | [viblo](https://viblo.asia/p/007-partitioning-data-voi-postgresql-p2-GrLZD1yelk0) |
| 008 | Materialized views | [008-materialized-view.md](./008-materialized-view.md) | [viblo](https://viblo.asia/p/008-materialized-view-voi-postgresql-RQqKLoP057z) |
| 009 | Optimistic vs pessimistic lock | [009-optimistic-vs-pessimistic-lock.md](./009-optimistic-vs-pessimistic-lock.md) | [viblo](https://viblo.asia/p/009-optimistic-lock-va-pessimistic-lock-L4x5xr7aZBM) |
| 010 | Exclusive vs shared lock | [010-exclusive-vs-shared-lock.md](./010-exclusive-vs-shared-lock.md) | [viblo](https://viblo.asia/p/010-exclusive-lock-va-shared-lock-924lJjn0lPM) |
| 011 | MVCC | [011-mvcc.md](./011-mvcc.md) | [viblo](https://viblo.asia/p/011-postgresql-multi-version-concurrency-control-6J3ZgdGLlmB) |
| 012 | VACUUM | [012-vacuum.md](./012-vacuum.md) | [viblo](https://viblo.asia/p/012-postgresql-vacuum-la-gi-ByEZkrRWKQ0) |
| 013 | VACUUM in practice | [013-vacuum-in-practice.md](./013-vacuum-in-practice.md) | [viblo](https://viblo.asia/p/013-thuc-hanh-vacuum-voi-postgresql-gAm5yrkkKdb) |
| 014 | Transaction isolation levels | [014-transaction-isolation.md](./014-transaction-isolation.md) | [viblo](https://viblo.asia/p/014-postgresql-transaction-isolation-OeVKB67JKkW) |
| 015 | Best practices | [015-best-practices.md](./015-best-practices.md) | [viblo](https://viblo.asia/p/015-postgresql-best-practice-djeZ1j8olWz) |
