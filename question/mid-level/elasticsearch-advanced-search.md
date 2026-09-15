# Elasticsearch — Advanced Search On The Backend

---

## What "Advanced Search" Means On The Backend

Going beyond a simple `WHERE column = value` or `LIKE '%x%'` query to support fast, relevant, flexible querying over large or unstructured data.

Core pieces:

- **Full-text search** — tokenizing/stemming text and ranking by relevance (BM25) instead of exact match.
- **Faceted/filtered search** — combining full-text relevance with structured filters (category, price range, date) plus aggregations (counts per facet).
- **Fuzzy/typo-tolerant matching** — edit-distance based matching so "aple" still finds "apple".
- **Autocomplete** — prefix indexes (edge n-grams) for instant-as-you-type suggestions.
- **Multi-field & weighted search** — searching across several fields with different relevance weights (e.g. title weighted higher than description).

Elasticsearch is the tool most commonly used to provide all of this. The rest of this doc walks through a concrete scenario: **1 million books in a database, and you want to search them.**

---

## What Elasticsearch Actually Is

Elasticsearch is a distributed, open-source search and analytics engine built on top of Apache Lucene. It stores data as JSON documents and is optimized for fast full-text search, filtering, and aggregations at scale — not for being a transactional source of truth like a relational DB.

### The core trick: inverted index

Instead of storing rows and scanning them, Elasticsearch builds an **inverted index**: for every unique word (term), it stores a list of which documents contain it.

```
"hobbit"  -> [doc 42, doc 891]
"tolkien" -> [doc 42, doc 57]
```

This is why searching "does this term appear anywhere" is near-instant, even across millions of documents — the opposite of a `LIKE '%term%'` table scan.

---

## Step 1 — Getting 1 Million Books Into Elasticsearch

You never index rows one at a time — that's 1 million HTTP round trips and would take hours. You batch them using the **Bulk API**.

```
Postgres (1,000,000 rows)
        |
        |  SELECT id, title, author, description FROM books
        |  (read in batches, e.g. 1,000 rows at a time via cursor/LIMIT-OFFSET)
        v
  Batch of 1,000 books
        |
        v
  Bulk API request (ONE HTTP call carries all 1,000 docs)
        |
        v
  Elasticsearch splits the batch internally and routes
  each doc to the correct shard based on hash(doc id)
        |
        v
  Repeat for the next batch... (1,000 batches total for 1M books)
```

Using the Node client's bulk helper (streams docs and batches them for you):

```typescript
import { Client } from '@elastic/elasticsearch';
import { Pool } from 'pg';

const es = new Client({ node: 'http://localhost:9200' });
const pg = new Pool({ connectionString: process.env.DATABASE_URL });

async function* streamBooksFromPostgres() {
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    const { rows } = await pg.query(
      'SELECT id, title, author, description, published_year FROM books ORDER BY id LIMIT $1 OFFSET $2',
      [batchSize, offset],
    );
    if (rows.length === 0) break;
    for (const row of rows) yield row;
    offset += batchSize;
  }
}

async function reindexAllBooks() {
  const result = await es.helpers.bulk({
    datasource: streamBooksFromPostgres(),
    onDocument(book) {
      return { index: { _index: 'books', _id: String(book.id) } };
    },
  });
  console.log(result); // { total: 1000000, successful: 1000000, failed: 0, time: ... }
}
```

This finishes in minutes, not hours, because each HTTP request carries hundreds/thousands of docs instead of one.

---

## Step 2 — How Those 1M Docs Get Organized

At roughly 1–2 KB per book document, 1 million books is only ~1–2 GB total — small by Elasticsearch standards (a single shard comfortably handles tens of GB). So this doesn't need many shards.

```
Index "books" (1M docs, ~1-2 GB) — 2 primary shards is plenty

  Node A                      Node B
+---------------+          +---------------+
| Shard 0       |          | Shard 1       |
| ~500K books   |          | ~500K books   |
| own inverted  |          | own inverted  |
| index on disk |          | index on disk |
+---------------+          +---------------+
| Shard 1 (copy)|          | Shard 0 (copy)|
+---------------+          +---------------+

Which shard a book lands on = hash(book_id) % num_shards
```

Every shard builds its own independent inverted index (word → list of book IDs), so each one only ever has to search half your books, not all million.

---

## Step 3 — What Happens When A User Searches

Say someone searches `"lord of the rings"`:

```
User: GET /books/search?q=lord of the rings
        |
        v
  Coordinating node (whichever node received the request)
        |
        +--> Shard 0: searches its ~500K books' inverted index,
        |            finds matches, scores each with BM25
        |
        +--> Shard 1: searches its ~500K books' inverted index,
        |            finds matches, scores each with BM25
        |            (runs in PARALLEL with Shard 0, not after)
        v
  Coordinating node merges both shards' results,
  sorts by score, returns top 10
        |
        v
  Response in ~5-20ms, even across 1 million books
```

The actual query:

```typescript
app.get('/books/search', async (req, res) => {
  const result = await es.search({
    index: 'books',
    query: {
      multi_match: {
        query: req.query.q,            // "lord of the rings"
        fields: ['title^3', 'author'], // ^3 = title matches matter 3x more
        fuzziness: 'AUTO',
      },
    },
    size: 10,
  });
  res.json(result.hits.hits.map((h) => ({ id: h._id, score: h._score, ...h._source })));
});
```

### Why this beats a SQL query at this scale

```
SQL:  SELECT * FROM books WHERE title ILIKE '%lord of the rings%'
      -> no index can help a leading-wildcard LIKE
      -> scans all 1,000,000 rows' title column, every single search
      -> no ranking: matches are just "yes" or "no", in arbitrary order

Elasticsearch: query "lord of the rings"
      -> looks up 4 words directly in the inverted index (instant lookup)
      -> combines their doc-id lists
      -> ranks results by relevance (BM25), best match first
      -> tolerates typos ("lordd of teh rings" still matches)
```

---

## What Elasticsearch Actually Stores Per Document

Elasticsearch stores the **complete original document**, not just a pointer back to Postgres. This changes how you think about the system.

You send this:

```json
{
  "id": 42,
  "title": "The Hobbit",
  "author": "J.R.R. Tolkien",
  "description": "Bilbo Baggins is a hobbit who enjoys a comfortable, unambitious life...",
  "published_year": 1937
}
```

Elasticsearch stores **two things** for this one document:

```
1) _source  — the ENTIRE original JSON, stored as-is (compressed)
   { "id": 42, "title": "The Hobbit", "author": "J.R.R. Tolkien", ... }

2) inverted index entries — words extracted FROM that JSON, pointing back to doc 42
   "hobbit"      -> [..., 42, ...]
   "bilbo"       -> [..., 42, ...]
   "tolkien"     -> [..., 42, ...]
   "comfortable" -> [..., 42, ...]
```

So for 1 million books, Elasticsearch is holding 1 million full copies of the book data, sitting right next to the search index built from them.

### Why keep the full copy at all (instead of just word → doc-id pointer)?

```
Search request: "hobbit"
        |
        v
  Inverted index lookup: "hobbit" -> [42, 891, ...]
  (tells you WHICH docs match, and gives a relevance score)
        |
        v
  User wants to actually SEE the book — title, author, description
        |
        v
  Elasticsearch fetches the stored _source for doc 42 directly
  (no need to go back to Postgres — the full record is right there)
```

If Elasticsearch only stored the inverted index, a search would tell you "doc 42 matched" but you'd need a separate round trip to Postgres for every result just to display it. Storing the full document avoids that extra hop.

### Where this physically lives

Elasticsearch is built on Apache Lucene. Each shard is a Lucene index made of immutable files called **segments** on disk:

```
Shard 0 (on disk)
+----------------------------------------------------+
| Segment files:                                       |
|   - inverted index (term -> doc id postings)          |
|   - stored fields (_source blob, compressed, per doc) |
|   - doc values (for sorting/aggregations)              |
+----------------------------------------------------+
```

`GET /books/42` doesn't even touch the inverted index — it goes straight to the stored `_source` blob for doc 42. That's why single-document lookups by ID are so fast.

### Storage cost

For 1M books (~1–2 KB of JSON each, ~1–2 GB raw):

```
Raw JSON in Postgres:        ~1-2 GB
Stored in Elasticsearch:     ~2-4 GB
  = _source (~1-2 GB, compressed copy of the same JSON)
  + inverted index structures (~1-2 GB, the word->doc-id lookup tables)
```

Elasticsearch roughly **doubles your storage footprint** — you pay disk space for instant, ranked full-text search. This is why it's normally a second, search-optimized copy sitting alongside Postgres rather than a replacement for it: Postgres holds the one true row, Elasticsearch holds a duplicate shaped for searching.

> Advanced/rare option: `"_source": { "enabled": false }` keeps only the inverted index and saves space, but you lose the ability to return full documents or rebuild/reindex from what's stored. Almost nobody does this in practice.

---

## Should You Fetch A Single Book By ID From Elasticsearch?

For a plain "get me book #42" lookup, use your primary database's own indexing (Postgres's primary key), **not** Elasticsearch.

```
SQL primary key lookup                    Elasticsearch _id lookup
------------------------                  -------------------------
SELECT * FROM books                       GET /books/42
WHERE id = 42
        |                                          |
        v                                          v
B-tree index lookup                       Term lookup on hidden _id field
(O(log n), extremely fast,                -> fetch stored _source blob
guaranteed up-to-date)                    (fast, but data may be up to
                                           ~1s stale after a write, and
                                           only exists if you synced it)
```

Both are fast. The real difference is correctness and complexity:

- **Postgres is your source of truth.** A write there is immediately visible. Elasticsearch is only *near*-real-time (~1s refresh delay) — a lookup right after a write could theoretically return stale data.
- **One less system in the request path.** A plain "fetch by ID" means one DB call, no extra network hop to a second service.
- **Elasticsearch's real strength (BM25 scoring, fuzzy matching, tokenization) isn't used at all** for a raw ID lookup — you'd be running an extra piece of infrastructure for nothing.

### When fetching by ID from Elasticsearch *does* make sense

```
User searches "hobbit"
        |
        v
  Elasticsearch full-text search -> returns matching doc IDs + scores
        |
        v
  You already have the full _source for each result right there
  (no extra Postgres round-trip needed to show titles/authors)
```

If you're already in Elasticsearch because the user just ran a search, use the `_source` you already fetched — don't go back to Postgres for it.

### Rule of thumb

| Access pattern | Use |
|---|---|
| "Get book by ID" as a standalone lookup (`/books/42`, a foreign key join, etc.) | Postgres, primary key index |
| "Get book by ID" right after a full-text search already returned that ID | Elasticsearch, since you're already there |
| "Search books by title/author/keyword" | Elasticsearch |

Keep Elasticsearch reserved for the search experience it's actually good at, and let the relational database keep doing what it already does perfectly — direct, consistent, indexed lookups by key.

---

## Keeping Elasticsearch In Sync Going Forward

The 1M-row bulk load is a **one-time initial import**. After that, Postgres keeps being the source of truth, and new/edited/deleted books need to reach Elasticsearch too. Common approaches:

- **App-level dual write** — API writes to Postgres, then also calls `es.index()`. Simplest, but a crash between the two writes can leave them out of sync.
- **CDC (change data capture)** — a tool like Debezium watches Postgres's write-ahead log and streams every change into Elasticsearch automatically. More moving parts, but never misses a write.
- **Scheduled reindex** — a cron job re-runs the bulk import periodically. Simplest to reason about, but search results can be minutes/hours stale.

---

## Interview Answer

> Elasticsearch is a distributed search engine built on Lucene. It stores the full original document (`_source`) plus an inverted index built from its text fields, so searches are relevance-ranked lookups against the inverted index instead of table scans. For large datasets, an index is split into shards spread across nodes so search runs in parallel; the primary database stays the source of truth, and Elasticsearch holds a synced, search-optimized copy. Use it for full-text/fuzzy/faceted search — keep simple ID lookups on the primary database's own index.

---

## Related Example

A runnable NestJS example implementing full-text search, fuzzy matching, faceted filters, and autocomplete against a real Elasticsearch instance lives in `shared-example/src/search/` (see its `README.md` for setup and curl examples).
