# GraphQL API — Fundamentals & Practical Patterns

Source: [API GraphQL - Kiến thức đầy đủ và chi tiết](https://viblo.asia/p/api-graphql-kien-thuc-day-du-va-chi-tiet-3kY4gM2qLAe)

---

## What GraphQL actually is

GraphQL is a **query language for APIs**, not a database technology. It sits
between the client and the backend; the backend still talks to SQL/NoSQL/etc.
underneath. See [sql-vs-nosql.md](./sql-vs-nosql.md) for the database-layer
comparison — this doc is about the API layer.

| | REST | GraphQL |
|---|---|---|
| Endpoints | Many (`/users`, `/users/:id/orders`) | One (`/graphql`) |
| Response shape | Fixed by the server | Chosen by the client, per request |
| Over/under-fetching | Common (extra fields, or N follow-up calls) | Client asks for exactly what it needs, including relations, in one round trip |
| Contract | Implicit (docs, versioning) | Explicit, strongly-typed schema |

---

## Minimal example: plain Express + Apollo Server

Before looking at the NestJS module in this repo, it's worth seeing GraphQL
with zero framework magic — just `express` + `@apollo/server`. Every concept
below (schema, resolvers, mounting at `/graphql`) is the same thing NestJS
does for you automatically; this version just makes each step explicit.

```javascript
const express = require('express');
const http = require('http');
const cors = require('cors');
const { ApolloServer } = require('@apollo/server');
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer');
const { expressMiddleware } = require('@as-integrations/express5');

// 1. In-memory "database"
let books = [
  { id: '1', title: 'The Hobbit', author: 'J.R.R. Tolkien' },
  { id: '2', title: 'Dune', author: 'Frank Herbert' },
];

// 2. Schema (typeDefs) — describes the shape of your data & operations
const typeDefs = `#graphql
  type Book {
    id: ID!
    title: String!
    author: String!
  }

  type Query {
    books: [Book!]!
    book(id: ID!): Book
  }

  type Mutation {
    addBook(title: String!, author: String!): Book!
  }
`;

// 3. Resolvers — functions that actually fetch/compute the data for each field
const resolvers = {
  Query: {
    books: () => books,
    book: (_parent, { id }) => books.find((b) => b.id === id),
  },
  Mutation: {
    addBook: (_parent, { title, author }) => {
      const newBook = { id: String(books.length + 1), title, author };
      books.push(newBook);
      return newBook;
    },
  },
};

async function start() {
  const app = express();
  const httpServer = http.createServer(app);

  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers,
    // Ensures the HTTP server shuts down cleanly when the process stops
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });
  await apolloServer.start();

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(apolloServer)
  );

  const PORT = 4000;
  httpServer.listen(PORT, () => {
    console.log(`GraphQL server ready at http://localhost:${PORT}/graphql`);
  });
}

start();
```

### What each piece is doing, and its NestJS equivalent in this repo

| Plain Apollo | What it does | Equivalent in `src/graphql-api/` |
|---|---|---|
| `typeDefs` (SDL string) | Declares the schema by hand — **schema-first** | `@ObjectType`/`@Field` classes in `models/*.ts` — **code-first**; `autoSchemaFile` generates the SDL for you (see below) |
| `resolvers` object (`Query.books`, `Mutation.addBook`, ...) | One function per field, grouped by type | `@Query()`/`@Mutation()` methods inside `UserResolver`/`OrderResolver` — same job, decorator-based instead of a plain object |
| `new ApolloServer({ typeDefs, resolvers })` | Builds the executable schema + server | `GraphQLModule.forRootAsync({ driver: ApolloDriver, ... })` in `graphql-api.module.ts` — NestJS constructs this for you from your decorated classes |
| `app.use('/graphql', ..., expressMiddleware(apolloServer))` | Mounts Apollo onto the Express app at a path | Same middleware, mounted automatically by `@nestjs/apollo` — default path `/graphql` (see "Where is code for this configuration" below) |
| `ApolloServerPluginDrainHttpServer` | Clean shutdown hook | Handled internally by `@nestjs/apollo` |
| `books` array | In-memory store | `PrismaService` → Postgres, via `prisma.user.findMany()` etc. |

The `@as-integrations/express5` package in the snippet is the same adapter
`@nestjs/apollo` uses under the hood to bridge Apollo Server (framework
-agnostic) onto an Express app — it's a direct dependency of this repo's
`shared-example` app for that reason, not something added just for this demo.

**Schema-first vs code-first, concretely:** in the snippet, `typeDefs` and
`resolvers` are two separate things you must keep in sync by hand — add a
field to `Book` in `typeDefs` and forget to implement it in `resolvers`, and
you get a runtime error. In this repo's code-first setup, the `@Field()`
decorator *is* the schema declaration, so there's only one place to edit.

---

## Schema & Types

The schema is the contract: what types exist, what fields they have, what
queries/mutations are allowed. This repo defines it **code-first** — Prisma
model → `@ObjectType` class → schema auto-generated on boot
(`src/graphql-api/models/*.ts`, wired in `graphql-api.module.ts` via
`autoSchemaFile`).

```typescript
@ObjectType()
export class Order {
  @Field(() => ID) id: number;
  @Field(() => Float) totalAmount: number;
  @Field(() => User) user: User; // resolved on demand, see below
}
```

---

## Query / Mutation / Subscription

- **Query** — read data. `src/graphql-api/resolvers/order.resolver.ts`:
  `orders(userId, status, since, limit, offset)`, `order(id)`.
- **Mutation** — write data. `createUser`, `createOrder`,
  `updateOrderStatus`, `login`.
- **Subscription** — real-time push on server-side events (e.g. "notify me
  when a new swap event arrives"). Not implemented in this repo, but it's
  the natural fit for the DEX scanner's live swap feed described in
  [dex-scanner-high-throughput.md](../dex-scanner/dex-scanner-high-throughput.md) —
  a subscription would push new `SwapEvent`s to subscribed clients instead
  of polling.

```graphql
query {
  orders(status: "paid", limit: 5) {
    id
    totalAmount
    user { name email }
  }
}

mutation {
  createOrder(input: { status: "pending", totalAmount: 42.5 }) {
    id
  }
}
```

---

## Resolvers

A resolver is one function per field, responsible for producing that field's
value. `Query`/`Mutation` resolvers fetch the root object; `@ResolveField`
resolvers fetch fields on demand — only when a client's query actually asks
for them.

```typescript
// src/graphql-api/resolvers/order.resolver.ts
@ResolveField(() => User)
user(@Parent() order: Order, @Context() ctx: GraphQLContext): Promise<User | null> {
  return ctx.loaders.userById.load(order.userId);
}
```

This is the core mental shift from SQL: a `JOIN` always fetches the related
rows. A GraphQL field resolver only runs if the client's selection set asks
for it.

---

## Fragments & Variables (client-side patterns)

**Fragments** — reusable field selections, avoid repeating the same fields
in multiple queries:

```graphql
fragment OrderFields on Order {
  id
  status
  totalAmount
}

query {
  orders(status: "paid") { ...OrderFields }
  order(id: 1) { ...OrderFields }
}
```

**Variables** — parameterize a query instead of string-interpolating values
into it (avoids injection-style bugs and enables query caching by shape):

```graphql
query OrdersByStatus($status: String, $limit: Int) {
  orders(status: $status, limit: $limit) {
    id
    totalAmount
  }
}
```
```json
{ "status": "paid", "limit": 5 }
```

---

## Directives: `@include` / `@skip`

Built into the GraphQL spec (no server code needed) — conditionally include
a field based on a variable, useful when one query serves multiple UI states:

```graphql
query User($withOrders: Boolean!) {
  user(id: 1) {
    name
    orders @include(if: $withOrders) {
      id
      status
    }
  }
}
```

---

## The N+1 problem and DataLoader

Naively resolving `orders { user { name } }` for a list of N orders fires
one `SELECT` per order — the classic N+1 problem, and the single biggest
GraphQL performance pitfall in practice.

`src/graphql-api/loaders.ts` fixes this with `DataLoader`: a fresh
`userById`/`ordersByUserId` pair is created **per request**
(`graphql-api.module.ts`'s `context` factory), and resolvers call `.load(id)`
instead of querying Prisma directly. `DataLoader` batches every `.load()`
call made within the same event-loop tick into a single `findMany({ where:
{ id: { in: [...] } } })`.

```typescript
userById: new DataLoader(async (ids: readonly number[]) => {
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return ids.map((id) => byId.get(id) ?? null); // must match input order/length
}),
```

---

## Pagination

Without limits, `users`/`orders` queries could return an unbounded result
set. Both queries in this repo take `limit`/`offset` args (default `20`/`0`):

```graphql
query {
  orders(status: "paid", limit: 10, offset: 20) { id }
}
```

This is offset pagination — simple, but degrades on very large tables (the
DB still has to skip `offset` rows). Cursor-based pagination (`after: $cursor`)
is the usual upgrade for large, high-throughput datasets like the DEX
scanner's `SwapEvent` table.

---

## Query depth limiting

A single GraphQL endpoint can't rely on "one query = bounded cost" the way
a REST endpoint per-resource can — a client can nest relations arbitrarily
deep (`orders { user { orders { user { ... } } } }`) and generate an
expensive, potentially recursive query. `graphql-api.module.ts` registers
`graphql-depth-limit` as a validation rule:

```typescript
validationRules: [depthLimit(5)],
```

Queries nested more than 5 levels are rejected before any resolver runs.

---

## Authentication & Authorization

`src/graphql-api/auth/gql-auth.guard.ts` implements a `Bearer <jwt>` guard
using Nest's `GqlExecutionContext` to reach the underlying HTTP request from
within a resolver's execution context:

```typescript
@UseGuards(GqlAuthGuard)
@Mutation(() => Order)
async createOrder(@Args('input') input: CreateOrderInput, @CurrentUser() currentUser: AuthUser) {
  return this.prisma.order.create({ data: { ...input, userId: currentUser.sub } });
}
```

Notes on this pattern:
- Auth is enforced per-mutation with `@UseGuards`, not globally — `login`,
  `createUser`, and read queries stay open.
- The mutation trusts the token's `sub` (user id) for `userId`, not any
  value the client could pass in the input — the standard "don't let the
  client tell you who it is" rule.
- The `login` mutation here is intentionally a **demo**: it looks up a user
  by email with no password check, purely to illustrate the guard/token
  flow. A real system would verify a hashed password or delegate to an IdP.

---

## Caching

Not implemented here, but worth knowing: unlike REST (cacheable per-URL by
CDNs/browsers out of the box), a single `/graphql` POST endpoint isn't
cacheable that way. Typical approaches: Apollo Client's normalized
in-memory cache on the frontend, or a server-side cache (Redis) keyed by
query+variables hash for expensive/repeated queries.

---

## Where this lives in the repo

`src/graphql-api/` — code-first NestJS + Apollo Server module:

- `models/` — `@ObjectType` classes (`User`, `Order`, `AuthPayload`)
- `dto/` — `@InputType` classes for mutations
- `resolvers/` — `UserResolver`, `OrderResolver`, `AuthResolver`
- `loaders.ts` — per-request `DataLoader`s (N+1 fix)
- `auth/` — JWT sign/verify, `GqlAuthGuard`, `@CurrentUser()` decorator
- `graphql-api.module.ts` — schema generation, depth limiting, context wiring

See the "GraphQL API" section in the project [README](../../shared-example/README.md)
for runnable `curl`/Apollo Sandbox examples.

---

## Follow-up Q&A

**Q: Does GraphQL replace the database?**

No. GraphQL replaces (or sits alongside) REST at the API layer. The
resolvers still query Postgres, MongoDB, another service, or in this repo's
case, Prisma → Postgres.

**Q: Why do blockchain indexers (e.g. The Graph) use GraphQL specifically?**

On-chain data is naturally graph-shaped (accounts → transactions → pools →
swaps), and consumers (dapps) want flexible, precise nested queries without
running their own indexing backend. An indexer processes raw chain events
into a queryable store, then exposes it via GraphQL — the same layered
pattern as `dex-scanner` (indexer) + `graphql-api` (query layer) in this
repo, just not yet wired together.

**Q: Is DataLoader specific to GraphQL?**

No — it's a generic batching/caching utility. It's disproportionately
associated with GraphQL because GraphQL's per-field resolver model makes
N+1 queries the default failure mode, so nearly every non-trivial GraphQL
server needs it.
