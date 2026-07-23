# Database Scaling Solutions

Source: [5 giải pháp Scaling Database](https://viblo.asia/p/5-giai-phap-scaling-database-OeVKBMD25kW)

Core principle from the article: **scaling adds complexity, cost, and new failure modes — don't reach for it until a real bottleneck is measured.** Find the bottleneck first (slow query logs, `pg_stat_activity`, APM), then apply the cheapest fix that solves it. Order below is roughly cheapest-to-implement → most complex, which is also the order you should try them in.

```
1. Cache          — cheap, first thing to try
2. Index          - cheap, huge win for O(n) -> O(log n)
3. Session storage — moves a specific hot table off the DB
4. Replication     — read scaling, more moving parts
5. Sharding        — write scaling, most complex, last resort
```

---

## 1. Cache database queries

Store the result of an expensive/repeated query in memory (Redis) instead of hitting Postgres every time.

```
Request -> check Redis -> hit?  -> return cached value
                        -> miss? -> query Postgres -> store in Redis -> return
```

```ts
@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  async getFeaturedProducts() {
    const cacheKey = 'products:featured';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const products = await this.prisma.product.findMany({
      where: { featured: true },
    });

    await this.redis.set(cacheKey, JSON.stringify(products), 'EX', 60 * 60); // 1h TTL
    return products;
  }
}
```

| Pros | Cons |
|---|---|
| Removes repeated load from DB entirely | Data can go stale — needs a TTL/invalidation strategy |
| App can survive brief DB outages by serving cached data | Choosing what to cache and for how long is a real design problem |
| Simple to add on top of existing queries | Cache stampede if TTL expires under heavy traffic (mitigate with locks/jitter) |

Use for: data that's read far more often than it changes — product catalogs, config, leaderboards, "top N" queries.

---

## 2. Database indexes

A B-tree index turns a linear scan into a logarithmic lookup.

```
No index: search 10,000 rows -> up to 10,000 comparisons  (O(n))
Index:    search 10,000 rows -> ~14 comparisons            (O(log n))
```

```sql
CREATE INDEX idx_orders_user_id ON orders (user_id);
```

Already covered in depth in [[indexes-fundamentals]] and [[indexes-types]] — composite indexes, partial indexes, covering indexes, when the planner ignores an index, etc.

| Pros | Cons |
|---|---|
| Often the single biggest win for the least effort | Extra disk space per index |
| No architecture change required | Slows down writes (index must be maintained on every INSERT/UPDATE/DELETE) |
| | Wrong/missing composite order still causes a scan — must match query patterns |

This is almost always step one before reaching for anything below — check `EXPLAIN ANALYZE` before you cache or replicate.

---

## 3. Move session storage off the database

If sessions are stored as rows in Postgres, every logged-in request is a DB read/write. Move them to something built for ephemeral key-value access.

**Option A — Redis-backed sessions**

```ts
// main.ts
import RedisStore from 'connect-redis';
import session from 'express-session';
import Redis from 'ioredis';

const redisClient = new Redis(process.env.REDIS_URL);

app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);
```

**Option B — stateless JWT (no server-side session store at all)**

```ts
@Injectable()
export class AuthService {
  login(user: User) {
    return {
      accessToken: jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, {
        expiresIn: '15m',
      }),
    };
  }
}
```

| Pros | Cons |
|---|---|
| Removes a hot, high-write table from Postgres entirely | Redis: in-memory, so a crash without persistence (AOF/RDB) loses active sessions |
| Redis/Memcached reads are much faster than a DB round trip | JWT: can't easily revoke a single token before expiry (needs a blocklist) |
| JWT removes server-side storage entirely | JWT payload is visible (base64, not encrypted) — don't put secrets in it |

---

## 4. Master-slave (primary-replica) replication

One primary handles all writes. Data is replicated to one or more read replicas; reads are routed there instead.

```
Writes ──────────► Primary
                       │  (streaming replication)
                       ▼
             ┌─────────┴─────────┐
             ▼                   ▼
         Replica 1           Replica 2
             ▲                   ▲
             └──────── Reads ────┘
```

```ts
@Injectable()
export class OrderService {
  constructor(
    @Inject('DB_PRIMARY') private readonly primary: PrismaClient,
    @Inject('DB_REPLICA') private readonly replica: PrismaClient,
  ) {}

  createOrder(data: CreateOrderDto) {
    return this.primary.order.create({ data }); // writes -> primary
  }

  getOrderHistory(userId: number) {
    return this.replica.order.findMany({ where: { userId } }); // reads -> replica
  }
}
```

| Pros | Cons |
|---|---|
| Spreads read load across multiple machines | Replication lag — a replica read right after a write can return stale data |
| Primary is freed to focus on writes | More infrastructure to run and monitor (replication health, failover) |
| Replicas can be placed near users in different regions to cut read latency | Doesn't help write throughput — all writes still go through one primary |

Doesn't scale writes — for that you need sharding (below).

---

## 5. Database sharding

Split the dataset across multiple independent database servers, each holding a subset of the data ("shards"). Unlike replication, each shard has data the others don't.

```
users 1–1,000,000       -> Shard A (its own Postgres instance)
users 1,000,001–2,000,000 -> Shard B (its own Postgres instance)
users 2,000,001–3,000,000 -> Shard C (its own Postgres instance)
```

```ts
@Injectable()
export class UserShardRouter {
  private readonly shardCount = 4;

  private shardFor(userId: number): PrismaClient {
    const shardIndex = userId % this.shardCount;
    return this.shardClients[shardIndex];
  }

  findUser(userId: number) {
    return this.shardFor(userId).user.findUnique({ where: { id: userId } });
  }
}
```

| Pros | Cons |
|---|---|
| Scales both reads and writes horizontally — add more shards, add more capacity | A cross-shard query (e.g. "top spenders across all users") requires fan-out + merge, or a separate analytics store |
| An outage on one shard doesn't take down the whole system | Resharding (rebalancing) live data is a major operation |
| Each shard holds less data — smaller indexes, faster queries per shard | JOINs across shards don't exist — schema/queries must be designed around the shard key |
| | Highest operational complexity of all five — last resort per the article |

---

## Partitioning vs. sharding — don't confuse these

Both split "one big table" into smaller pieces by row, but at different levels:

| | Partitioning | Sharding |
|---|---|---|
| Where the pieces live | **Same** database instance | **Different** database instances/servers |
| Who's aware of it | The database engine — app still queries one logical table | The application — must route each query to the correct shard |
| Solves | Table too big to scan/index efficiently, slow retention deletes | Single server can't handle total write/storage/connection load |
| Example | `swap_events` partitioned by month on one Postgres server | `users` split across 4 separate Postgres servers by `user_id % 4` |

Full mechanics (range/hash/list partitioning, partition pruning, `DROP TABLE` for instant retention) are in [[database-partitioning]] — read that alongside this file, since partitioning is usually the step you take *before* sharding becomes necessary: a single well-partitioned table on one beefy server can go a long way before you need to split across machines at all.

---

## Putting it together — decision order

```
Bottleneck found (EXPLAIN ANALYZE / pg_stat_activity / APM)
    │
    ├── Same expensive read query, repeated a lot?
    │       └── 1. Cache it (Redis / materialized view)
    │
    ├── Seq Scan on a large table?
    │       └── 2. Add an index (see indexes-fundamentals.md)
    │
    ├── One table (e.g. sessions) dominating writes/connections?
    │       └── 3. Move it off Postgres (Redis session store / JWT)
    │
    ├── Table is huge but fits on one server, mostly time-based access?
    │       └── Partition it (database-partitioning.md)
    │
    ├── Read traffic overwhelming a single instance?
    │       └── 4. Add read replicas
    │
    └── Write traffic / total data too big for one server, all else exhausted?
            └── 5. Shard
```

KISS: implement the simplest thing that resolves the *measured* bottleneck, not the most impressive-sounding architecture.
