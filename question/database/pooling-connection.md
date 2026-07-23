# Database Connection Experiments in NestJS

This document explains three database connection approaches in NestJS:

1.  New connection every request
2.  Singleton connection
3.  Connection pool

Stack:

-   NestJS
-   PostgreSQL
-   node-postgres (`pg`)

------------------------------------------------------------------------

# Experiment 1 --- New Connection Every Request

## Idea

Every API request:

    HTTP Request
          |
          v
    Create PostgreSQL connection
          |
          v
    Run query
          |
          v
    Close connection

## Code

``` ts
import { Injectable } from '@nestjs/common';
import { Client } from 'pg';

@Injectable()
export class DatabaseService {

  async findUser(id: string) {

    const client = new Client({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'password',
      database: 'test',
    });

    await client.connect();

    const result = await client.query(
      `
      SELECT *
      FROM users
      WHERE id = $1
      `,
      [id]
    );

    await client.end();

    return result.rows[0];
  }
}
```

## Flow

    Request 1
       |
       +-- connect()
       +-- query
       +-- close()


    Request 2
       |
       +-- connect()
       +-- query
       +-- close()

## Problems

-   Creating connections is expensive
-   Too many TCP connections
-   Database overload
-   Higher latency

------------------------------------------------------------------------

# Experiment 2 --- Singleton Connection

## Idea

Create exactly one database connection when NestJS starts.

    Application starts

            |
            v

    Create one DB connection


    Request 1
         |
         v
     same connection


    Request 2
         |
         v
     same connection

## Code

``` ts
import {
 Injectable,
 OnModuleInit,
 OnModuleDestroy
} from '@nestjs/common';

import { Client } from 'pg';


@Injectable()
export class DatabaseService
implements OnModuleInit, OnModuleDestroy {

 private client: Client;


 async onModuleInit(){

   this.client = new Client({
     host:'localhost',
     port:5432,
     user:'postgres',
     password:'password',
     database:'test'
   });

   await this.client.connect();
 }


 async findUser(id:string){

   const result =
     await this.client.query(
       `
       SELECT *
       FROM users
       WHERE id=$1
       `,
       [id]
     );

   return result.rows[0];
 }


 async onModuleDestroy(){
   await this.client.end();
 }

}
```

## Flow

Startup:

    NestJS starts

    DatabaseService created

    client.connect()

          |
          v

    ONE PostgreSQL connection

## Problem

One connection can only process limited work.

Example:

    Connection

    Query A
    ---------------------


    Query B waiting


    Query C waiting

High traffic creates a queue.

------------------------------------------------------------------------

# Experiment 3 --- Connection Pool

## Idea

Maintain multiple reusable database connections.

Example:

    Pool size = 10


    +---------+
    | Pool    |
    +---------+

    conn 1
    conn 2
    conn 3
    ...
    conn 10

## Code

``` ts
import {
 Injectable,
 OnModuleDestroy,
 OnModuleInit
}
from '@nestjs/common';

import { Pool } from 'pg';


@Injectable()
export class DatabaseService
implements OnModuleInit, OnModuleDestroy {

 private pool: Pool;


 async onModuleInit(){

   this.pool = new Pool({

     host:'localhost',
     port:5432,
     user:'postgres',
     password:'password',
     database:'test',

     max:10,

     idleTimeoutMillis:30000

   });

 }


 async findUser(id:string){

   const result =
     await this.pool.query(
       `
       SELECT *
       FROM users
       WHERE id=$1
       `,
       [id]
     );

   return result.rows[0];

 }


 async onModuleDestroy(){

   await this.pool.end();

 }

}
```

## Flow

    Connections:

    C1
    C2
    C3
    ...
    C10

Requests:

    Request 1 --> C1

    Request 2 --> C2

    Request 3 --> C3

    Request 11 --> wait

------------------------------------------------------------------------

# Comparison

  Approach                     Connections       Performance             Production
  ---------------------------- ----------------- ----------------------- ------------
  New connection per request   Many              Bad                     No
  Singleton connection         One               Medium/Bad under load   Sometimes
  Connection Pool              Controlled many   Good                    Yes

------------------------------------------------------------------------

# Production Pattern

The common NestJS production architecture:

    NestJS Application

            |
            |

    Singleton Database Service

            |
            |

    Connection Pool

            |
            |

    PostgreSQL

Example:

    PrismaService
    (single instance)

            |
            |

    Prisma internal pool

            |
            |

    PostgreSQL

The recommended approach:

-   One database service instance
-   Pool manages multiple connections
-   Reuse connections
-   Avoid creating connections inside request handlers

------------------------------------------------------------------------

# Connection Limit vs Max Connections

Two settings that look similar but live on different sides of the wire.

## `connection_limit` (app-side, e.g. Prisma URL param)

    postgresql://user:pass@host:5432/db?connection_limit=5

- Lives in the **application** (Prisma / pg.Pool / TypeORM)
- Caps how many connections **this app instance** will open to the database
- Enforced by the client library, not the database
- Each instance has its own pool

Example:

    App instance A → pool of 5 connections
    App instance B → pool of 5 connections
    App instance C → pool of 5 connections
                     ────────────
                     15 total open to DB

## `max_connections` (server-side, PostgreSQL)

    # postgresql.conf
    max_connections = 100

- Lives in the **database server**
- Hard ceiling on total simultaneous connections **across the entire instance**
- Applies to every database, every user, every client combined
- Reject new connections with `sorry, too many clients already` once reached

## How they interact — parking building analogy

    max_connections = 100 parking spots (whole building)

    connection_limit per app = how many spots each tenant reserves

        Tenant A (app 1): 20 spots
        Tenant B (app 2): 20 spots
        Tenant C (DBeaver): 10 spots
        Tenant D (CI):     10 spots
                            ─────
                            60 used → 40 spots free

If tenants reserve more spots than the building has → conflict.

## Conflict cases

**Case 1: `connection_limit > max_connections`**

    App: connection_limit = 200
    DB:  max_connections = 100

App tries to open 101st connection → DB rejects → app errors.

**Case 2: multiple apps sum exceed `max_connections`**

    10 pods × connection_limit=20 = 200
    DB max_connections = 100

Half the pods can't get connections → cascading failures.

## Prisma default

If you don't set `connection_limit`, Prisma computes:

    connection_limit = min(num_physical_cpus × 2 + 1, 10)

- 4-core machine → 9
- 8-core machine → 10 (capped)

## Rule of thumb for sizing

    connection_limit = (max_connections − reserved) / total_app_instances

Where "reserved" leaves room for:
- Admin sessions (~5)
- GUI tools (~10-20)
- Migrations / CI (~10)
- Superuser reserved (`superuser_reserved_connections`, default 3)

Example:

    max_connections = 100
    reserved = 25
    app instances = 5
    → connection_limit = (100 - 25) / 5 = 15

## TL;DR comparison

  Property              connection_limit          max_connections
  --------------------- ------------------------- ----------------------------
  Location              Application (Prisma)      PostgreSQL server config
  Scope                 One app instance          Entire PostgreSQL instance
  Enforced by           Client library            Database server
  Exceed → what?        Query queues in pool      Connection rejected
  Typical value         5-20                      100-500
  Change requires       App restart               DB restart

------------------------------------------------------------------------

# What Causes Too Many Database Connections

Root-cause grouping of connection exhaustion in production.

## 1. Not using a connection pool

    Every HTTP request → new Client() → connect() → query → end()

- Fresh TCP + auth handshake every time
- 1000 req/s → 1000 new connections/s
- Anti-pattern (Experiment 1 above)

## 2. Too many app instances × pool size

    5 pods × connection_limit=50 = 250 connections
    max_connections = 100
    → rejected connections, app crashes

Common when scaling Kubernetes replicas without re-sizing the pool.

## 3. Connection leaks

    const client = await pool.connect();
    await client.query(...);
    // forgot: client.release() ← leak

- Pool exhausts → new requests wait → timeout
- Usually a missing `try/finally` around release

## 4. Long-running transactions

    await tx.begin();
    await callSlowExternalAPI();   // 30s — connection held
    await tx.commit();

- Connection stays checked out during the entire wait
- 10 slow txs = 10 pool slots gone

## 5. N+1 query pattern

    const users = await db.query('SELECT * FROM users');
    for (const u of users) {
      u.posts = await db.query('SELECT ... WHERE user_id=$1', [u.id]);
    }

- 1000 users → 1000 extra queries
- Not more connections, but pool saturates from query volume

## 6. Serverless / Lambda cold starts

    Each Lambda invocation = new container = new pool
    1000 concurrent × pool=5 = 5000 connections

- Fix: PgBouncer in front to multiplex

## 7. Missing indexes → slow queries

    Query takes 5s instead of 5ms
    Connection held 1000× longer
    Pool saturates at low RPS

## 8. Direct database URL access (dev/prod)

- No pooling, no auth boundary
- Each client tool opens its own idle connections

## Diagnostic query

    SELECT state, count(*), max(now() - state_change) as longest
    FROM pg_stat_activity
    GROUP BY state;

Look for:
- `idle in transaction` → leak or long tx (cause #3, #4)
- `active` piling up → slow queries (#5, #7)
- Total near `max_connections` → sizing issue (#2)

------------------------------------------------------------------------

# Direct Database URL Access in Dev

A common pattern where the whole team connects to the shared dev DB via URL from GUI tools + local apps + CI.

## Real connection cost per person

    Dev A opens DBeaver         → 5-10 idle connections
    Dev B opens TablePlus       → 5-10 idle connections
    Dev C runs psql + app       → 3-5 connections
    Dev D runs Prisma Studio    → 10 connections
    App running locally         → connection_limit=10
    CI pipeline runs tests      → 5-20 connections
    Migration job               → 1-5 connections
    ─────────────────────────────────────────────────
    Team of 5 devs + app + CI ≈ 60-100 connections

Hits `max_connections=100` **without any real traffic**.

## Why GUI tools eat so many

  Tool             Typical idle connections
  ---------------- --------------------------
  DBeaver          1 per open tab/query editor
  TablePlus        2-5 (structure + data + query)
  Prisma Studio    5-10 (one per model tab)
  pgAdmin          3-8 (dashboard + query tool)

Each stays as `idle` in `pg_stat_activity` until the tool closes.

## Problems

**Silent connection exhaustion**

    Dev pushes code → app fails to start
    Error: "sorry, too many clients already"
    Nobody knows who's holding connections

**Credentials sprawl**

- URL in `.env`, Slack, Notion, saved DBeaver connections
- Ex-employees still have access
- No audit trail

**Manual queries lock rows**

    -- Dev A in DBeaver, forgets to commit
    BEGIN;
    UPDATE users SET email = 'test' WHERE id = 1;
    -- goes to lunch

- Row lock held for hours
- App writes → hangs → pool saturates

**No visibility of who's connected**

    SELECT usename, application_name, state, count(*)
    FROM pg_stat_activity
    GROUP BY 1,2,3;

Shows: `postgres | DBeaver | idle | 47` — but *which* dev?

## Healthy access pattern

                       +--------------+
       Dev laptops --> |   PgBouncer  | --> PostgreSQL
       App instances   |  (multiplex) |     max_connections=100
       CI pipelines    +--------------+
                       Pool mode: transaction
                       Max client conns: 500
                       Max server conns: 20

Alternatives:
- **Per-dev local Postgres** via Docker (best for schema experiments)
- **Read-only bastion access** with audit log
- **Managed pooler** (Neon / Supabase / Prisma Data Proxy)

## Immediate low-effort fixes

1. Bump `max_connections` in dev to 200-300 (RAM permitting)
2. Add PgBouncer in front (~5 min setup)
3. Set `idle_in_transaction_session_timeout = '5min'` — auto-kill abandoned txns
4. Move schema experiments to per-dev Docker Postgres

## Sizing formula

    max_connections = (devs × 10) + (app_instances × pool_size) + (CI × 20) + 20 buffer

Check reality with:

    SELECT count(*) FROM pg_stat_activity;

If >70% of `max_connections` during normal workday → one CI run away from outage.

------------------------------------------------------------------------

# Is `max_connections` Per-Database or Per-Instance?

**Per PostgreSQL instance — NOT per database.**

`max_connections` counts every connection to the entire PostgreSQL server, regardless of which database the client is connected to.

    PostgreSQL server (one process)
    +--- max_connections = 100  <-- ONE global budget
    |
    +--- database: app_prod       -> 40 connections
    +--- database: app_staging    -> 30 connections
    +--- database: analytics      -> 20 connections
    +--- database: postgres       -> 5 connections
                                    -----
                                    = 95 used
                                    -> only 5 slots free server-wide

If `app_prod` opens 100 alone, nothing else can connect.

## Why? A connection = OS process + memory

    1 connection = 1 postgres backend process
                 = ~10 MB RAM
                 = 1 socket
                 = 1 file descriptor

    max_connections = 100 -> ~1 GB RAM reserved

The limit protects the **physical server**, not the logical database.

## Verify

    SELECT count(*) FROM pg_stat_activity;

    SELECT datname, count(*)
    FROM pg_stat_activity
    GROUP BY datname;

Total across all rows = what counts against `max_connections`.

## Per-database caps (optional)

    ALTER DATABASE app_prod CONNECTION LIMIT 60;
    ALTER DATABASE analytics CONNECTION LIMIT 30;

- Optional caps **inside** the server budget
- Cannot exceed `max_connections`

Per-user works the same way:

    ALTER ROLE app_user CONNECTION LIMIT 50;

## Truly separate budgets = separate instances

    +-----------------------+    +-----------------------+
    | PostgreSQL Instance A |    | PostgreSQL Instance B |
    | max_connections = 100 |    | max_connections = 100 |
    | +-- db: app_prod      |    | +-- db: analytics     |
    +-----------------------+    +-----------------------+
        Port 5432                    Port 5433
        Own RAM, own limit           Own RAM, own limit

Each instance = own `postgresql.conf` = own `max_connections`.

## Practical implication

Splitting schemas into multiple logical databases on the **same instance** does NOT give more connection headroom. Only a separate PostgreSQL instance does.

## TL;DR

  Question                              Answer
  ------------------------------------- ---------------------------------------------------
  Is `max_connections` per-database?    No — per PostgreSQL instance
  What is per-database?                 `ALTER DATABASE ... CONNECTION LIMIT` (optional)
  How to get separate budgets?          Run separate PostgreSQL instances
  What counts as one connection?        One TCP socket -> one backend process -> ~10 MB RAM
