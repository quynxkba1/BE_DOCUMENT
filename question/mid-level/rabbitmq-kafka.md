# RabbitMQ and Kafka — How They Work & When To Use Each

---

## Why Learn RabbitMQ and Kafka?

RabbitMQ and Kafka are both used to move messages between services, but they solve different problems.

At a high level:

```
RabbitMQ = message broker / task queue
Kafka    = distributed event log / event streaming platform
```

Both are very different from Redis Pub/Sub.

Redis Pub/Sub forwards messages only to currently connected subscribers and stores nothing. RabbitMQ and Kafka can store messages, handle consumer failure, and support retry-like behavior.

---

## RabbitMQ — The Mental Model

RabbitMQ is a **message broker**. A producer sends a message to RabbitMQ, RabbitMQ routes it to a queue, and a consumer reads from that queue.

```
Producer  ──publish──▶  Exchange  ──route──▶  Queue  ──deliver──▶  Consumer
```

### The main actors

- **Producer** — sends messages.
- **Exchange** — receives messages from producers and decides where to route them.
- **Queue** — stores messages until a consumer processes them.
- **Binding** — rule connecting an exchange to a queue.
- **Consumer** — reads messages from a queue and processes them.
- **Ack** — confirmation from consumer that processing finished successfully.

### What actually happens step by step

```
1. Producer publishes message to an exchange.
2. RabbitMQ uses bindings/routing keys to choose a queue.
3. RabbitMQ stores the message in the queue.
4. RabbitMQ delivers the message to a consumer.
5. Consumer processes the message.
6. Consumer sends ACK.
7. RabbitMQ removes the message from the queue.
```

The key difference from Redis Pub/Sub:

> RabbitMQ stores the message until it is acknowledged or removed.

---

## RabbitMQ Example Use Case

Imagine an order service needs to send emails after an order is created.

```
Order Service
  -> publish "order.created"
  -> RabbitMQ queue: email_jobs
  -> Email Worker consumes job
  -> Email Worker sends email
  -> Email Worker ACKs message
```

If the email worker crashes before ACK, RabbitMQ can requeue the message and deliver it again.

This makes RabbitMQ good for **background jobs** and **task processing**.

---

## RabbitMQ Exchanges

RabbitMQ does not publish directly to queues in the usual model. Producers publish to an exchange.

The exchange decides which queue receives the message.

| Exchange type | Meaning | Example |
|---|---|---|
| Direct | Route by exact routing key | `order.created` -> `email_queue` |
| Fanout | Send to all bound queues | Broadcast event to many services |
| Topic | Route by pattern | `order.*`, `user.#` |
| Headers | Route by message headers | Rare in most backend apps |

### Direct exchange

```
Producer publishes:
  exchange = order.exchange
  routingKey = order.created

Binding:
  order.exchange + order.created -> email_queue

Result:
  message goes to email_queue
```

### Fanout exchange

```
Producer publishes order.created

Exchange sends copy to:
  email_queue
  analytics_queue
  audit_queue
```

This is similar to Pub/Sub, but each queue can store its own copy.

---

## RabbitMQ Acknowledgement Lifecycle

```
t=0s   Producer publishes message
t=1s   RabbitMQ stores message in queue
t=2s   Consumer receives message
t=3s   Consumer starts processing
t=4s   Consumer finishes successfully
t=5s   Consumer sends ACK
t=6s   RabbitMQ deletes message from queue
```

If the consumer crashes before ACK:

```
t=0s   Consumer receives message
t=1s   Consumer starts processing
t=2s   Consumer crashes
t=3s   RabbitMQ detects closed connection
t=4s   RabbitMQ requeues unacked message
t=5s   Another consumer receives it
```

So RabbitMQ usually gives **at-least-once delivery**.

That means:

- A message should not be lost if the consumer crashes before ACK.
- A message may be processed more than once.
- Consumers should be idempotent.

---

## RabbitMQ Failure Scenarios

### Consumer crashes while processing

If manual acknowledgements are used and the consumer has not sent ACK yet:

```
Message is requeued and can be delivered again.
```

If auto-ack is enabled:

```
RabbitMQ considers the message done as soon as it is delivered.
If the consumer crashes during processing, the message is lost.
```

For important work, avoid auto-ack.

### Queue has many messages

RabbitMQ stores messages in the queue. Consumers process them at their own speed.

If producers are faster than consumers, the queue grows.

This is normal, but too much backlog can cause memory/disk pressure.

### Consumer is slow

RabbitMQ supports `prefetch`.

Prefetch controls how many unacked messages a consumer can receive at once.

Example:

```
prefetch = 10
```

RabbitMQ will not send more than 10 unacked messages to that consumer.

This prevents one slow consumer from receiving too much work.

### RabbitMQ broker crashes

Messages survive broker restart only if they are configured durably:

- durable queue
- persistent message

If either is missing, messages may be lost on broker crash.

---

## Kafka — The Mental Model

Kafka is a **distributed append-only log**.

Producers append events to a topic. Consumers read from that topic using offsets.

```
Producer  ──append──▶  Topic Partition Log  ──read──▶  Consumer
```

Kafka does not remove a message just because one consumer read it.

Instead, Kafka stores events for a configured retention period.

```
Topic: order.events

Partition 0:
  offset 0: order.created
  offset 1: order.paid
  offset 2: order.shipped
```

Consumers track their position with offsets.

---

## Kafka Main Concepts

- **Producer** — writes events to Kafka.
- **Topic** — named stream of events, such as `order.events`.
- **Partition** — ordered log inside a topic.
- **Offset** — position of a message inside a partition.
- **Consumer** — reads events from topics.
- **Consumer group** — group of consumers sharing work.
- **Commit** — records that a consumer group has processed up to an offset.
- **Retention** — how long Kafka keeps events.

---

## Kafka Topic and Partition Example

```
Topic: order.events

Partition 0:
  offset 0 -> order.created for orderId=1001
  offset 1 -> order.paid for orderId=1001

Partition 1:
  offset 0 -> order.created for orderId=1002
  offset 1 -> order.cancelled for orderId=1002
```

Ordering is guaranteed **inside one partition**, not across the whole topic.

If you need all events for the same order to stay in order, use `orderId` as the message key.

```
key = orderId
```

Kafka will send the same key to the same partition.

---

## Kafka Consumer Groups

A consumer group lets multiple consumers share work.

```
Topic: order.events
Partitions: P0, P1, P2

Consumer group: notification-service

consumer-1 reads P0
consumer-2 reads P1
consumer-3 reads P2
```

Within one consumer group, each partition is consumed by only one consumer at a time.

If you have another service:

```
Consumer group: analytics-service
```

it gets its own independent offsets and can read the same events separately.

This means Kafka supports durable fan-out:

```
order.events topic
  -> notification-service group
  -> analytics-service group
  -> audit-service group
```

Each group receives the event independently.

---

## Kafka Message Lifecycle

```
t=0s   Producer sends event to Kafka topic
t=1s   Kafka appends event to a partition
t=2s   Kafka assigns an offset
t=3s   Consumer reads event
t=4s   Consumer processes event
t=5s   Consumer commits offset
t=6s   Kafka keeps event until retention expires
```

The important detail:

> Kafka does not delete the event when a consumer commits an offset.

The commit only means:

```
This consumer group has processed up to this offset.
```

The event remains in Kafka until retention removes it.

---

## Kafka Failure Scenarios

### Consumer crashes before committing offset

```
Consumer reads offset 10
Consumer processes message
Consumer crashes before commit
Consumer restarts
Consumer reads offset 10 again
```

The event may be processed again.

Kafka commonly gives **at-least-once delivery** when offsets are committed after processing.

### Consumer commits before processing

```
Consumer reads offset 10
Consumer commits offset 10
Consumer crashes before processing
```

Now Kafka thinks the consumer group is already past that message.

The message may be skipped.

For important processing:

```
process first, commit after success
```

### Consumer is slow

Kafka keeps events in the topic log. A slow consumer falls behind by increasing lag.

```
lag = latest offset - committed offset
```

High lag means the consumer is behind.

Kafka is designed to handle large backlogs better than RabbitMQ in many event-streaming cases.

### Kafka broker crashes

Kafka topics are usually replicated.

If one broker fails, another broker can serve the partition if replication is configured correctly.

Important settings include:

- replication factor
- min in-sync replicas
- producer acknowledgement setting

---

## RabbitMQ vs Kafka

| Feature | RabbitMQ | Kafka |
|---|---|---|
| Primary model | Queue-based message broker | Distributed event log |
| Best for | Background jobs, task queues, command processing | Event streaming, analytics, audit logs |
| Message storage | Queue until ACK/removal | Topic log until retention expires |
| Consumer progress | Message ACK | Offset commit |
| Replay old messages | Not natural after ACK | Natural within retention |
| Ordering | Queue order, affected by retries/consumers | Guaranteed within partition |
| Scaling consumers | Competing consumers on a queue | Consumer group across partitions |
| Fan-out | Multiple queues bound to exchange | Multiple consumer groups |
| Backpressure | Queue grows; prefetch controls delivery | Consumer lag grows |
| Typical delivery | At-least-once with manual ACK | At-least-once with commit after processing |
| Message lifetime | Usually removed after processing | Kept after processing until retention |

---

## RabbitMQ vs Kafka vs Redis Pub/Sub

| Feature | Redis Pub/Sub | RabbitMQ | Kafka |
|---|---|---|---|
| Stores messages | No | Yes, in queues | Yes, in log |
| Retry after consumer crash | No | Yes, if not ACKed | Yes, if offset not committed |
| Replay | No | Limited/manual | Yes, within retention |
| Consumer groups | No | Competing consumers on queue | Native consumer groups |
| Best use case | Real-time signals where loss is okay | Reliable jobs/tasks | Durable event streams |
| Example | typing indicator | send email job | order event history |

---

## When To Use RabbitMQ

Use RabbitMQ when:

- You need a reliable task queue.
- A job should be processed by one worker.
- You want message ACK and retry behavior.
- You need routing with exchanges and queues.
- You process commands like `send_email`, `generate_invoice`, `resize_image`.

Example:

```
User uploads image
  -> publish resize_image job
  -> image_worker consumes job
  -> image_worker resizes image
  -> ACK
```

RabbitMQ is a good fit when the message represents **work to do**.

---

## When To Use Kafka

Use Kafka when:

- You need to store an event history.
- Multiple services need to independently consume the same events.
- You need replay.
- You need high-throughput event ingestion.
- You want analytics, audit logs, stream processing, or event-driven architecture.

Example:

```
Order Service publishes order.created

Kafka topic: order.events

Notification Service consumes it
Analytics Service consumes it
Audit Service consumes it
Fraud Service consumes it
```

Kafka is a good fit when the message represents **something that happened**.

---

## Work Queue vs Event Stream

A useful way to decide:

```
RabbitMQ: "Please do this work."
Kafka:    "This thing happened."
```

Examples:

| Message | Better fit | Why |
|---|---|---|
| `send_welcome_email` | RabbitMQ | A worker should perform one task |
| `generate_pdf_invoice` | RabbitMQ | Background job with retry |
| `order.created` | Kafka | Event may be useful to many services |
| `payment.completed` | Kafka | Important business event history |
| `user_is_typing` | Redis Pub/Sub | Temporary signal, loss is acceptable |

---

## Node.js RabbitMQ Example

Using `amqplib`:

```typescript
import amqp from 'amqplib';

const QUEUE = 'email_jobs';

// Producer
async function publishEmailJob() {
  const connection = await amqp.connect('amqp://localhost');
  const channel = await connection.createChannel();

  await channel.assertQueue(QUEUE, { durable: true });

  channel.sendToQueue(
    QUEUE,
    Buffer.from(JSON.stringify({
      type: 'send_welcome_email',
      userId: 123,
    })),
    { persistent: true },
  );

  await channel.close();
  await connection.close();
}

// Consumer
async function consumeEmailJobs() {
  const connection = await amqp.connect('amqp://localhost');
  const channel = await connection.createChannel();

  await channel.assertQueue(QUEUE, { durable: true });
  channel.prefetch(10);

  channel.consume(QUEUE, async (message) => {
    if (!message) return;

    try {
      const job = JSON.parse(message.content.toString());
      await sendEmail(job);

      channel.ack(message);
    } catch (err) {
      channel.nack(message, false, true); // requeue
    }
  }, { noAck: false });
}
```

Important details:

- `durable: true` helps the queue survive broker restart.
- `persistent: true` helps the message survive broker restart.
- `noAck: false` means manual ACK is enabled.
- `prefetch(10)` limits unacked messages per consumer.

---

## Node.js Kafka Example

Using `kafkajs`:

```typescript
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'order-service',
  brokers: ['localhost:9092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'notification-service' });

// Producer
async function publishOrderCreated() {
  await producer.connect();

  await producer.send({
    topic: 'order.events',
    messages: [
      {
        key: '1001',
        value: JSON.stringify({
          type: 'order.created',
          orderId: 1001,
          userId: 42,
          timestamp: new Date().toISOString(),
        }),
      },
    ],
  });

  await producer.disconnect();
}

// Consumer
async function consumeOrderEvents() {
  await consumer.connect();
  await consumer.subscribe({
    topic: 'order.events',
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = JSON.parse(message.value?.toString() ?? '{}');

      await handleOrderEvent(event);

      console.log({
        topic,
        partition,
        offset: message.offset,
      });
    },
  });
}
```

Important details:

- `topic` is the event stream.
- `key` controls partition selection.
- `groupId` identifies which service is consuming.
- Kafka tracks progress with offsets.

---

## Critical Interview Points

### RabbitMQ

Say this:

> RabbitMQ is queue-oriented. A message is usually removed after the consumer acknowledges it. It is good for reliable background jobs and task distribution.

Important words:

- exchange
- queue
- binding
- routing key
- manual acknowledgement
- prefetch
- dead-letter queue
- durable queue
- persistent message

### Kafka

Say this:

> Kafka is log-oriented. Events are appended to partitions and retained for a configured time. Consumers track offsets, and different consumer groups can independently read the same events.

Important words:

- topic
- partition
- offset
- consumer group
- retention
- replication
- lag
- replay

---

## Common Interview Questions

**Q: What is the main difference between RabbitMQ and Kafka?**

RabbitMQ is a message broker based around queues. Kafka is a distributed log based around topics and partitions. RabbitMQ is usually used for tasks/jobs. Kafka is usually used for event streams and replayable event history.

**Q: What happens if a RabbitMQ consumer crashes while processing a message?**

If manual ACK is used and the message was not acknowledged, RabbitMQ can requeue it and deliver it again. If auto-ack was used, the message may be lost.

**Q: What happens if a Kafka consumer crashes while processing a message?**

If the consumer crashes before committing the offset, it will usually read the same message again after restart. If it commits before processing and then crashes, the message may be skipped.

**Q: Why do RabbitMQ and Kafka often provide at-least-once delivery?**

Because they can redeliver messages after failure. This prevents loss, but it means duplicate processing is possible. Consumers should be idempotent.

**Q: What is idempotency in message processing?**

Idempotency means processing the same message more than once still produces the same final result.

Example:

```
Bad:
  charge credit card every time message is received

Good:
  check paymentId first
  if paymentId already processed, skip
```

**Q: What is a dead-letter queue?**

A dead-letter queue stores messages that failed processing too many times or could not be routed/consumed correctly. It lets engineers inspect bad messages instead of retrying forever.

**Q: What is Kafka consumer lag?**

Kafka consumer lag is the distance between the latest offset in a partition and the offset committed by a consumer group.

```
latest offset = 1000
committed offset = 700
lag = 300
```

This means the consumer group is 300 messages behind.

**Q: Can Kafka replace RabbitMQ?**

Sometimes, but not always. Kafka can handle many event-driven workloads, but RabbitMQ is often simpler and more natural for task queues, request routing, retries, and worker-based jobs.

**Q: Can RabbitMQ replace Kafka?**

Sometimes for simple events, but RabbitMQ is not designed as a long-term replayable event log. Kafka is better when many services need to independently consume, replay, and analyze event streams.

---

## Practical Rule of Thumb

Use this in interviews:

```
Redis Pub/Sub:
  transient real-time signal
  losing messages is acceptable

RabbitMQ:
  reliable task queue
  message should be processed by a worker
  remove after ACK

Kafka:
  durable event stream
  many services may consume independently
  keep and replay events
```

Short answer:

> RabbitMQ is best when I care about completing work. Kafka is best when I care about recording and distributing events.

