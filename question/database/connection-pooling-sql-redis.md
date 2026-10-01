# Connection Pooling for SQL (MariaDB/Postgres) and Redis

> Reduce connection overhead by reusing already-open connections instead of
> opening/closing a new one per request. See also `database-optimization-techniques.md`
> §4 (Connection Management) for the Postgres/PgBouncer version of this.

---

## The problem: opening a connection isn't free

```
Without pooling — every request:
  1. Open TCP connection      (network round trip)
  2. Auth handshake            (another round trip, sometimes TLS negotiation too)
  3. Run the actual query      (finally, the useful work)
  4. Close the connection
```

Steps 1, 2, and 4 add latency to *every single request* before any real work
happens — and at high traffic, repeatedly opening/closing connections also
burns CPU on both the client and the DB/Redis server, and can hit the
server's max-connections limit (MariaDB's `max_connections`, Postgres's
`max_connections`, Redis's `maxclients`).

---

## The fix: keep a pool of already-open connections, reuse them

```
With pooling — every request:
  1. Borrow an already-open connection from the pool
  2. Run the query
  3. Return the connection to the pool (don't close it)
```

The expensive handshake happens once per connection, at startup — not once
per request.

---

## MariaDB / MySQL example (Node.js, `mysql2`)

```js
// BAD: opens and closes a raw connection per request
async function getCustomer(id) {
  const conn = await mysql.createConnection(config); // handshake every time
  const [rows] = await conn.query('SELECT * FROM customers WHERE id = ?', [id]);
  await conn.end();
  return rows[0];
}

// GOOD: a pool created once at app startup, reused for every request
const pool = mysql.createPool({
  host: 'localhost',
  connectionLimit: 20,   // max concurrent connections held open
});

async function getCustomer(id) {
  const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
  return rows[0];
}
```

---

## Redis example (`ioredis`)

```js
// BAD: creates a new client (new TCP + auth handshake) per request
async function getCache(key) {
  const client = new Redis(); // new connection every call
  const value = await client.get(key);
  client.quit();
  return value;
}

// GOOD: one client instance, created once, reused for the app's lifetime
const redisClient = new Redis({ host: 'localhost' }); // connects once

async function getCache(key) {
  return redisClient.get(key); // reuses the existing connection
}
```

Redis connections are cheaper than a SQL database's (no per-query
transaction/session state to negotiate), but the handshake cost is still
real — and Redis has its own `maxclients` cap, so uncontrolled connection
creation under load can exhaust it just like a DB.

---

## Why this matters more at high request volume

Every request that skips pooling pays the connection-setup tax on top of
the actual query/cache-lookup time. At high traffic (e.g. an app serving
millions of users with frequent cache lookups), that overhead compounds
into a real, measurable chunk of overall latency. Pooling turns "open
connection + query" into just "query" for nearly every request after the
pool warms up.

---

## Sizing the pool

```
pool size too small  → requests queue up waiting for a free connection,
                        adding latency under load

pool size too large  → wastes memory/connections on the DB server,
                        can hit the server's own max_connections limit,
                        especially with multiple app instances each
                        holding their own pool
```

Rule of thumb: `connectionLimit` per app instance × number of app instances
should stay comfortably under the DB/Redis server's max connection limit.
For Postgres specifically, a dedicated external pooler like **PgBouncer**
is often used in front of the DB so many app instances can share a much
smaller number of real DB connections — see
`database-optimization-techniques.md` §4.
