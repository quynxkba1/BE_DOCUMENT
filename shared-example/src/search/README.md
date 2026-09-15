# Advanced Search (Elasticsearch)

Demonstrates the concepts from the earlier discussion — inverted index, analyzers, relevance
scoring, faceted search, and autocomplete — against a real Elasticsearch instance.

## Run it

```bash
docker-compose -f docker-compose.elasticsearch.yml up -d
npm run start:dev
```

Elasticsearch: http://localhost:9200 · Kibana: http://localhost:5601

## Try it

```bash
# Index the sample product catalog
curl -X POST localhost:3000/search/seed

# Full-text search, ranked by BM25 relevance (name weighted 3x over description)
curl "localhost:3000/search/query?q=running+shoes"

# Fuzzy match — typo tolerant
curl "localhost:3000/search/query?q=runing"

# Combine relevance with structured filters (facets)
curl "localhost:3000/search/query?q=shoes&category=footwear&minPrice=50&maxPrice=100"

# Prefix-based autocomplete, powered by an edge-ngram field
curl "localhost:3000/search/autocomplete?q=run"

# Facet counts (e.g. for a filter sidebar)
curl "localhost:3000/search/facets"
```

## Where each concept lives

| Concept | Code |
|---|---|
| Inverted index | Built automatically by Elasticsearch when documents are indexed in `seed()` |
| Analyzer / tokenizer | `autocomplete_analyzer` (edge n-gram) in `ensureIndex()` |
| Relevance scoring (BM25) | `multi_match` with `name^3` field boost in `search()` — see the `score` on each hit |
| Fuzzy / typo tolerance | `fuzziness: 'AUTO'` in `search()` |
| Faceted search | `filter` clauses (category, price range) in `search()`, and `facets()` |
| Autocomplete | `name.suggest` sub-field + `autocomplete()` |

## Why a separate search engine instead of `LIKE '%q%'` in Postgres

The primary DB stays the source of truth for writes. Elasticsearch holds a denormalized,
indexed copy of searchable fields (here, seeded directly for simplicity — in production this
would sync via CDC or an outbox pattern) so search-heavy reads don't compete with transactional
queries and get relevance ranking that SQL `LIKE` can't provide.
