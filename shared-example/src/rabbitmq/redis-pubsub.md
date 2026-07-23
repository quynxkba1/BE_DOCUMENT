# Redis Pub/Sub — How It Works & Critical Failure Scenarios

---

## How Redis Pub/Sub Works

Redis Pub/Sub is a **fire-and-forget messaging pattern**. Publishers send messages to a channel; subscribers receive them — but only if they are **actively connected at the moment the message is published**.

### The three actors

```
Publisher  ──publish──▶  Redis Channel  ──deliver──▶  Subscriber
```

- **Publisher** — sends a message to a named channel. It has no knowledge of who is listening.
- **Channel** — a named logical pipe inside Redis. It holds no messages; it only routes.
- **Subscriber** — opens a persistent connection to Redis and listens on one or more channels.

### What actually happens step by step

```
1. Subscriber connects to Redis and sends: SUBSCRIBE notifications
   Redis responds: ["subscribe", "notifications", 1]
   The subscriber's TCP connection stays open — it is now in "subscribe mode".

2. Publisher connects separately and sends: PUBLISH notifications '{"type":"order","id":55}'
   Redis immediately delivers the message to every active subscriber on "notifications".
   Redis responds to the publisher: (integer) 1   ← number of subscribers that received it

3. Subscriber receives: ["message", "notifications", '{"type":"order","id":55}']
   The subscriber processes it.
```

The channel itself **stores nothing**. Redis is just a router.

### Node.js example

```typescript
import Redis from 'ioredis';

// --- subscriber.ts ---
const subscriber = new Redis();

await subscriber.subscribe('notifications');

subscriber.on('message', (channel, message) => {
  const payload = JSON.parse(message);
  console.log(`[${channel}]`, payload);
});

// --- publisher.ts ---
const publisher = new Redis();

await publisher.publish('notifications', JSON.stringify({
  type: 'order_created',
  orderId: 55,
  userId: 123,
}));
```

### Pattern subscriptions (PSUBSCRIBE)

Subscribers can use glob patterns to listen to multiple channels at once.

```
PSUBSCRIBE order.*          → matches order.created, order.updated, order.cancelled
PSUBSCRIBE user.*.events    → matches user.123.events, user.456.events
```

```typescript
await subscriber.psubscribe('order.*');

subscriber.on('pmessage', (pattern, channel, message) => {
  // pattern = "order.*", channel = "order.created", message = "{...}"
});
```

---

## Where Does a Published Message Live?

**Nowhere. Redis Pub/Sub stores nothing.**

When `PUBLISH` is called, Redis performs one synchronous pass in the same event loop tick:

```
PUBLISH notifications '{"orderId":55}'

Redis internal flow:
  1. Look up the in-memory subscriber list for channel "notifications"
  2. Copy the message bytes directly into each active subscriber's TCP output buffer
  3. Discard the message — never written to memory or disk
  4. Return (integer) N  ← count of subscribers that received it
```

The message exists only **during the brief moment Redis is copying it into each subscriber's socket buffer** — microseconds. After that it is gone.

### The exact lifecycle of a published message

```
t+0μs   Publisher calls PUBLISH
t+1μs   Redis finds subscriber list → [conn_A, conn_B]
t+2μs   Redis writes bytes to conn_A's output buffer  ← message "exists" here
t+3μs   Redis writes bytes to conn_B's output buffer  ← and here
t+4μs   Redis drops the message — no reference kept
t+5μs   Publisher receives (integer) 2
t+6μs   Message no longer exists anywhere in Redis
```

If `conn_A`'s buffer is full (slow consumer), Redis skips it (or disconnects it) — that subscriber never gets the message. No error is surfaced to the publisher.

### What is the subscriber TCP connection?

A TCP connection is a long-lived network link between two programs so they can send bytes to each other reliably and in order.

In a Redis Pub/Sub setup:

```
Subscriber server/process  <--- TCP connection --->  Redis Docker container
```

When the subscriber code runs:

```typescript
const subscriber = createRedisClient('subscriber');
await subscriber.subscribe('order.events');
```

the Redis client opens a TCP connection to Redis, usually:

```
host: localhost
port: 6379
```

That connection stays open while the subscriber is listening.

When a publisher sends:

```typescript
await publisher.publish('order.events', payload);
```

Redis forwards the message through the open TCP connection to the subscriber.

Simple picture:

```
Publisher app
  -> TCP connection to Redis
  -> PUBLISH order.events

Redis Docker
  -> TCP connection to Subscriber app
  -> sends message bytes

Subscriber app
  -> reads bytes
  -> subscriber.on('message', ...)
```

If the subscriber server suddenly stops, its TCP connection to Redis closes. Redis then removes that subscriber from the channel. Any Pub/Sub messages not fully handled by your app are not retried.

### Contrast with systems that do store messages

| System | Where the message lives | Survives crash? |
|---|---|---|
| Redis Pub/Sub | Nowhere — in-flight only | No |
| Redis Streams | In-memory log (AOF/RDB if configured) | Yes |
| RabbitMQ | Queue on broker disk (if durable) | Yes |
| Kafka | Partition log on disk | Yes |
| AWS SQS | S3-backed storage, up to 14 days | Yes |

---

## The Critical Problem: Fire-and-Forget Has No Persistence

> **Redis Pub/Sub does not store messages. If nobody is listening, the message is gone.**

This is the most important thing to understand about Redis Pub/Sub.

### Scenario: Publisher fires, then server stops

```
Timeline
────────────────────────────────────────────────────────────
t=0s   Subscriber connects and listens on "notifications"

t=5s   Publisher sends PUBLISH notifications '{"orderId":55}'
       → Redis delivers to subscriber immediately ✓
       → Subscriber processes the event ✓

t=10s  Subscriber crashes / server restart / network drop
       The subscriber's TCP connection to Redis closes.
       Redis removes it from the delivery list.

t=15s  Publisher sends PUBLISH notifications '{"orderId":56}'
       → Redis looks for active subscribers on "notifications"
       → Finds zero subscribers
       → Returns (integer) 0  ← nobody received it
       → Message is permanently gone 💀

t=20s  Subscriber reconnects and re-subscribes
       It receives nothing about orderId=56.
       The event is silently lost.
────────────────────────────────────────────────────────────
```

### What Redis returns to the publisher

```
PUBLISH notifications "message"
→ (integer) 0    # means ZERO subscribers received it
                 # the publisher gets this feedback but usually ignores it
```

The publisher gets a count back, but most application code does not check it or act on it.

---

## Why This Happens — Redis Pub/Sub Architecture

Redis Pub/Sub is **purely in-memory and stateless per channel**:

1. When a subscriber disconnects, Redis immediately removes it from the channel's subscriber list.
2. Channels have no message queue — they are just a list of active connections to forward to.
3. There is no concept of "pending messages", "unread messages", or "offset".
4. Redis has no way to replay messages to a subscriber that missed them.

This is fundamentally different from a message queue (RabbitMQ, Kafka, SQS) where messages are stored until a consumer acknowledges them.

---

## Comparison: Redis Pub/Sub vs Message Queues

| Feature | Redis Pub/Sub | Redis Streams / Kafka / RabbitMQ |
|---|---|---|
| **Message persistence** | None — fire-and-forget | Yes — stored until consumed |
| **Missed messages** | Lost forever | Deliverable on reconnect |
| **Consumer groups** | No | Yes |
| **Acknowledgement** | No | Yes |
| **Replay** | No | Yes (Kafka, Streams) |
| **Delivery guarantee** | At-most-once | At-least-once or exactly-once |
| **Use case** | Real-time events where loss is OK | Critical events that must be processed |

---

## When Redis Pub/Sub Is Acceptable

Redis Pub/Sub is fine when **losing a message is acceptable**:

- Live chat typing indicators ("user is typing...") — stale data is useless anyway.
- Real-time dashboard metrics — the next metric update will arrive in seconds.
- Cache invalidation signals — a missed invalidation just means a slightly stale cache read.
- Live sports score updates — missing one update is harmless; the next one arrives.
- Notification broadcasts to online users — offline users are handled by a separate notification system (push notifications, email).

---

## Solutions When You Cannot Afford to Lose Messages

### Option 1: Redis Streams (built-in durable Pub/Sub)

Redis Streams persist messages in an ordered log. Subscribers use a **consumer group** and track their position with an offset. They can replay missed messages after reconnecting.

```typescript
// Producer
await redis.xadd('notifications', '*', 'type', 'order_created', 'orderId', '55');

// Consumer (persists — reads from last processed ID)
const messages = await redis.xreadgroup(
  'GROUP', 'order-service', 'worker-1',
  'COUNT', 10,
  'BLOCK', 2000,
  'STREAMS', 'notifications', '>'   // '>' means: undelivered messages only
);

// Acknowledge after processing
await redis.xack('notifications', 'order-service', messageId);
```

Messages are stored until explicitly acknowledged. If the consumer crashes before ack, the message is redelivered.

### Option 2: Use a proper message broker

| Broker | Guarantee | When to use |
|---|---|---|
| **RabbitMQ** | At-least-once (with acks) | Task queues, work distribution |
| **Kafka** | At-least-once / exactly-once | Event streaming, audit logs, high throughput |
| **AWS SQS** | At-least-once | Serverless, cloud-native, simple queues |
| **AWS SNS + SQS** | At-least-once fan-out | Multiple consumers, different services |

### Option 3: Outbox pattern (for database + event consistency)

Write the event to a database table ("outbox") in the same transaction as your business data. A separate process reads the outbox and publishes to Redis/Kafka.

```
BEGIN transaction:
  INSERT INTO orders (...)
  INSERT INTO outbox (channel, payload, status='pending')
COMMIT

Background worker:
  SELECT * FROM outbox WHERE status = 'pending'
  PUBLISH to Redis / Kafka
  UPDATE outbox SET status = 'sent'
```

This guarantees the event is never lost even if Redis is down at the moment of the business operation.

---

## Reconnect and Resubscribe Strategy

If you do use Redis Pub/Sub, your subscriber must handle reconnections properly.

### Problem: ioredis does not auto-resubscribe by default after a reconnect

```typescript
// FRAGILE — subscription is lost on disconnect
const subscriber = new Redis();
await subscriber.subscribe('notifications');
// If Redis restarts, the subscriber reconnects but is no longer subscribed
```

### Correct approach: resubscribe on reconnect

```typescript
const subscriber = new Redis({
  retryStrategy: (times) => Math.min(times * 100, 3000),  // exponential backoff
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
});

// Re-subscribe every time the connection is ready (initial + reconnects)
subscriber.on('ready', async () => {
  console.log('Redis ready — subscribing...');
  await subscriber.subscribe('notifications');
});

subscriber.on('message', (channel, message) => {
  process(JSON.parse(message));
});

subscriber.on('error', (err) => {
  console.error('Redis subscriber error:', err);
});
```

Even with auto-reconnect, **messages published during the disconnection window are still lost**. Auto-reconnect only prevents future loss.

---

## Summary: What Actually Happens in the Failure Scenario

```
Publisher fires event
  → Redis checks active subscribers
  → If subscriber is connected: message delivered ✓
  → If subscriber is disconnected OR crashed:
       message is dropped, returns count=0
       no retry, no storage, no error thrown by Redis
  → Publisher server stops: no more messages published

Subscriber reconnects later:
  → Must re-issue SUBSCRIBE command
  → Receives only NEW messages from that point forward
  → All messages during downtime are permanently lost
```

### The key insight for interviews

> Redis Pub/Sub has **at-most-once delivery**. A message is delivered zero or one time. There is no retry, no persistence, no acknowledgement. If your use case requires guaranteed delivery, use Redis Streams, RabbitMQ, Kafka, or SQS instead.

---

## Is Redis a Real Pub/Sub Service?

**Short answer: Redis has pub/sub capability, but it is not a pub/sub service in the same category as dedicated brokers.**

### What Redis Pub/Sub actually is

Redis is primarily an **in-memory data store** (cache, key-value store). Pub/Sub is a feature bolted on top — useful for simple real-time signalling but deliberately minimal. It was never designed to compete with message brokers.

### The missing properties of a real pub/sub service

| Property | Real Pub/Sub (Kafka, RabbitMQ, SNS) | Redis Pub/Sub |
|---|---|---|
| **Message durability** | Messages stored on disk | No storage at all |
| **Guaranteed delivery** | At-least-once or exactly-once | At-most-once (zero guarantees) |
| **Consumer offset / replay** | Yes — rewind and reprocess | No |
| **Consumer groups** | Yes — multiple independent consumers | No |
| **Acknowledgement** | Yes — message redelivered if not acked | No |
| **Backpressure** | Handled by the broker | Disconnects slow consumers |
| **Routing / filtering** | Topic partitions, routing keys | Channel name / glob pattern only |
| **Dead letter queue** | Yes | No |
| **Monitoring / observability** | Built-in metrics | Minimal (`INFO` command only) |

### When Redis Pub/Sub is a legitimate pub/sub tool

Redis Pub/Sub is valid for use cases where **the pub/sub contract is "deliver to currently connected subscribers"** — no more, no less:

```
✓ Cache invalidation broadcast      — "hey all nodes, evict key X"
✓ Typing indicators in chat         — stale state is useless
✓ Real-time dashboard metric push   — next tick will correct it
✓ Presence signals (online/offline) — re-synced on reconnect anyway
✓ WebSocket fan-out in multi-server setup
  (e.g. Socket.io uses Redis Pub/Sub as a backplane between Node processes)
```

### When Redis Pub/Sub is the wrong choice

```
✗ Order events that trigger payment or shipping
✗ Audit logs — must not lose a single entry
✗ Email / notification delivery — user must receive it even if offline
✗ Microservice event bus where downstream services must each process every event
✗ Any flow requiring "exactly once" or "at least once" delivery
```

### Verdict for interviews

> Redis **can be used as a lightweight pub/sub mechanism** for fire-and-forget signals. It is **not a replacement for a message broker**. For guaranteed delivery, use Redis Streams (if you want to stay in Redis) or a dedicated broker (Kafka, RabbitMQ, SQS). The key disqualifier is: Redis Pub/Sub stores nothing, so it cannot retry, replay, or guarantee any message reaches a consumer.

---

## Full Working Example

A realistic example: an **Order Service** publishes events; a **Notification Service** and an **Analytics Service** both subscribe. Includes reconnect handling and graceful shutdown.

### Project structure

```
redis-pubsub-example/
├── src/
│   ├── publisher.ts       # Order Service — publishes order events
│   ├── subscriber.ts      # Notification + Analytics subscriber
│   └── redis.ts           # shared Redis client factory
├── package.json
└── tsconfig.json
```

### `src/redis.ts`

```typescript
import Redis from 'ioredis';

export function createRedisClient(name: string): Redis {
  const client = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);
      console.log(`[${name}] Reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });

  client.on('error', (err) => console.error(`[${name}] Redis error:`, err.message));
  client.on('connect', () => console.log(`[${name}] Connected to Redis`));

  return client;
}
```

### `src/publisher.ts`

```typescript
import { createRedisClient } from './redis';

const CHANNEL = 'order.events';

interface OrderEvent {
  type: 'order.created' | 'order.cancelled' | 'order.shipped';
  orderId: number;
  userId: number;
  timestamp: string;
}

async function publishOrderEvent(event: OrderEvent): Promise<void> {
  const publisher = createRedisClient('publisher');

  const payload = JSON.stringify(event);
  const receiverCount = await publisher.publish(CHANNEL, payload);

  // receiverCount = 0 means no subscriber was listening — message is gone
  if (receiverCount === 0) {
    console.warn(`[publisher] WARNING: 0 subscribers received event`, event.type);
    // In production you might write to an outbox table here instead
  } else {
    console.log(`[publisher] Published to ${receiverCount} subscriber(s):`, event.type);
  }

  await publisher.quit();
}

// Simulate publishing three events with a delay between them
async function main() {
  await publishOrderEvent({
    type: 'order.created',
    orderId: 1001,
    userId: 42,
    timestamp: new Date().toISOString(),
  });

  await new Promise((r) => setTimeout(r, 1000));

  await publishOrderEvent({
    type: 'order.shipped',
    orderId: 1001,
    userId: 42,
    timestamp: new Date().toISOString(),
  });
}

main().catch(console.error);
```

### `src/subscriber.ts`

```typescript
import { createRedisClient } from './redis';

const CHANNEL = 'order.events';

// --- Handler types ---
interface OrderEvent {
  type: string;
  orderId: number;
  userId: number;
  timestamp: string;
}

// --- Notification handler ---
function handleNotification(event: OrderEvent): void {
  switch (event.type) {
    case 'order.created':
      console.log(`[notification] Send email to user ${event.userId}: Your order #${event.orderId} was placed.`);
      break;
    case 'order.shipped':
      console.log(`[notification] Send email to user ${event.userId}: Your order #${event.orderId} has shipped.`);
      break;
    case 'order.cancelled':
      console.log(`[notification] Send email to user ${event.userId}: Your order #${event.orderId} was cancelled.`);
      break;
  }
}

// --- Analytics handler ---
function handleAnalytics(event: OrderEvent): void {
  console.log(`[analytics] Record event: type=${event.type} orderId=${event.orderId} at=${event.timestamp}`);
}

// --- Main subscriber setup ---
async function main() {
  const subscriber = createRedisClient('subscriber');

  // Re-subscribe on every connection (initial connect + reconnects)
  // Without this, a reconnect silently drops the subscription
  subscriber.on('ready', async () => {
    console.log(`[subscriber] Subscribing to channel: ${CHANNEL}`);
    await subscriber.subscribe(CHANNEL);
  });

  subscriber.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;

    let event: OrderEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      console.error('[subscriber] Failed to parse message:', raw);
      return;
    }

    // Both handlers run for every message (fan-out within the same process)
    handleNotification(event);
    handleAnalytics(event);
  });

  // Graceful shutdown — unsubscribe before closing
  const shutdown = async (signal: string) => {
    console.log(`\n[subscriber] Received ${signal} — shutting down`);
    await subscriber.unsubscribe(CHANNEL);
    await subscriber.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('[subscriber] Waiting for events... (Ctrl+C to stop)');
}

main().catch(console.error);
```

### Running the example

```bash
# Terminal 1 — start the subscriber first
npx ts-node src/subscriber.ts

# Terminal 2 — publish events
npx ts-node src/publisher.ts
```

### Expected output

```
# Subscriber terminal
[subscriber] Connected to Redis
[subscriber] Subscribing to channel: order.events
[subscriber] Waiting for events... (Ctrl+C to stop)
[notification] Send email to user 42: Your order #1001 was placed.
[analytics] Record event: type=order.created orderId=1001 at=2026-06-04T...
[notification] Send email to user 42: Your order #1001 has shipped.
[analytics] Record event: type=order.shipped orderId=1001 at=2026-06-04T...

# Publisher terminal
[publisher] Connected to Redis
[publisher] Published to 1 subscriber(s): order.created
[publisher] Published to 1 subscriber(s): order.shipped
```

### What happens if subscriber is stopped before publishing

```bash
# Stop subscriber (Ctrl+C)
# Then run publisher

[publisher] WARNING: 0 subscribers received event order.created
[publisher] WARNING: 0 subscribers received event order.shipped
# Events are gone — subscriber will never see them
```

This is the fire-and-forget reality. The publisher gets `(integer) 0` back from Redis and the events are permanently discarded.

---

## Follow-up Interview Questions

**Q: How many subscribers can a Redis channel have?**

Practically unlimited — Redis delivers to all active subscribers in O(n) where n is the number of subscribers on that channel. In practice, keep subscriber counts reasonable; at very high scale (thousands of subscribers) the delivery loop itself becomes a bottleneck.

**Q: Can a single Redis connection be both a publisher and a subscriber?**

A connection in subscribe mode can only issue `SUBSCRIBE`, `UNSUBSCRIBE`, `PSUBSCRIBE`, `PUNSUBSCRIBE`, and `PING`. It cannot publish or run other commands. Use two separate connections — one for subscribing, one for publishing/other operations. This is standard practice with ioredis.

**Q: Does PUBLISH block until all subscribers have received the message?**

No. Redis delivers synchronously to all subscribers in the same event loop tick, but from the publisher's perspective it is a single fast operation. The publisher does not wait for subscribers to process the message — only for Redis to forward it.

**Q: What happens if a subscriber is slow to process messages?**

Redis has an internal output buffer for each client connection. If the subscriber cannot read fast enough, the buffer grows. When the buffer exceeds `client-output-buffer-limit`, Redis **forcibly disconnects the slow subscriber**. Messages buffered but not yet read are lost. Mitigation: process messages quickly (offload heavy work to a separate queue/worker), or use Redis Streams which handle backpressure naturally.

**Q: How do you implement fan-out to multiple services with guaranteed delivery?**

Use **Redis Streams with consumer groups**. Each service creates its own consumer group on the same stream. Each group independently tracks its read position. A message published to the stream is delivered to each group exactly once (within that group, one consumer processes it).

```
Stream: notifications
  Consumer group A (order-service)  → each message processed once by order-service
  Consumer group B (email-service)  → same messages, independently consumed by email-service
```
