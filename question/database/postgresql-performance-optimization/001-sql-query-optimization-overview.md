# 001 — Ways to Optimize a SQL Query

> Source: [viblo.asia](https://viblo.asia/p/001-co-nhung-cach-nao-de-toi-uu-sql-query-RnB5pVgrZPG)

SQL is declarative — you say *what* you want, the engine decides *how*. That "how" (the execution plan) can be inefficient, which is what the rest of this series digs into.

## Four levers covered by the series

1. **Scanning** — plain linear scan, O(n). Fine for small tables, collapses at scale.
2. **Indexing** — build a sorted structure (B-Tree etc.) on a column so lookups skip the full scan. Tradeoff: slower writes, more storage.
3. **Join strategy** — nested loop (simple, slow), hash join (O(1) lookup via hash table), sort-merge join (relies on sorted input).
4. **Partitioning** — split a huge table into smaller physical sub-tables by a partition key, so queries only touch the relevant slice.

```sql
SELECT * FROM ENGINEER e WHERE e.title = 'Software Engineer';
```

Each of these four levers gets its own deep-dive later in the series (indexes: 002–004, joins: 005, partitioning: 006–007).
