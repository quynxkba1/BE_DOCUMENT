# RabbitMQ API Workflow

This explains what happens when the client calls:

```http
POST /rabbitmq/email-jobs
```

Example request:

```bash
curl -X POST http://localhost:3000/rabbitmq/email-jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"send_welcome_email","userId":123,"email":"alice@example.com"}'
```

---

## 1. Request reaches the NestJS controller

The route is defined in `rabbitmq.controller.ts`:

```typescript
@Controller('rabbitmq')
export class RabbitmqController {
  @Post('email-jobs')
  publishEmailJob(
    @Body() job: EmailJob,
  ): Promise<{ queued: true; job: EmailJob }> {
    return this.rabbitmqService.publishWelcomeEmailJob(job);
  }
}
```

Because the controller prefix is `rabbitmq` and the method route is `email-jobs`, the full route is:

```text
POST /rabbitmq/email-jobs
```

Nest parses the JSON body and passes it as `job`.

---

## 2. Controller calls the RabbitMQ service

The controller does not talk to RabbitMQ directly.

It delegates to:

```typescript
this.rabbitmqService.publishWelcomeEmailJob(job);
```

This keeps HTTP routing separate from message-broker logic.

---

## 3. Service opens or reuses a RabbitMQ channel

Inside `publishWelcomeEmailJob`, the service calls:

```typescript
const channel = await this.getChannel();
```

`getChannel()` checks whether a channel already exists:

```typescript
if (this.channel) {
  return this.channel;
}
```

If no channel exists yet, it connects to RabbitMQ:

```typescript
const url = process.env.RABBITMQ_URL ?? 'amqp://localhost';

const connection = await amqp.connect(url);
const channel = await connection.createChannel();
```

So the default broker URL is:

```text
amqp://localhost
```

That means the app expects RabbitMQ to be reachable on the local machine unless `RABBITMQ_URL` is set.

---

## 4. Service makes sure the queue exists

Before sending the message, the service declares the queue:

```typescript
await channel.assertQueue(this.queueName, { durable: true });
```

In this example:

```text
queueName = email_jobs
```

`durable: true` means the queue can survive a RabbitMQ broker restart.

Important:

```text
durable queue + persistent message = better crash safety
```

Using only one of them is not enough for reliable persistence.

---

## 5. Service sends a persistent message

The service publishes the job to the queue:

```typescript
channel.sendToQueue(
  this.queueName,
  Buffer.from(JSON.stringify(job)),
  { persistent: true },
);
```

This does three things:

1. Converts the job object to JSON.
2. Converts the JSON string to bytes with `Buffer.from(...)`.
3. Sends the bytes to the `email_jobs` queue.

`persistent: true` tells RabbitMQ to persist the message to disk when possible.

---

## 6. API returns a response

After the message is sent to RabbitMQ, the service returns:

```typescript
return { queued: true, job };
```

The HTTP response looks like:

```json
{
  "queued": true,
  "job": {
    "type": "send_welcome_email",
    "userId": 123,
    "email": "alice@example.com"
  }
}
```

This means:

```text
The API accepted the job and placed it on the RabbitMQ queue.
```

It does not mean an email has already been sent.

---

## Full Publish Flow

```text
Client
  -> POST /rabbitmq/email-jobs
  -> RabbitmqController.publishEmailJob()
  -> RabbitmqService.publishWelcomeEmailJob()
  -> RabbitmqService.getChannel()
  -> amqp.connect('amqp://localhost')
  -> connection.createChannel()
  -> channel.assertQueue('email_jobs', { durable: true })
  -> channel.sendToQueue('email_jobs', Buffer, { persistent: true })
  -> return { queued: true, job }
```

---

## What Happens To The Message?

After `sendToQueue`, the message lives in RabbitMQ's `email_jobs` queue.

```text
RabbitMQ
  -> queue: email_jobs
  -> message: {"type":"send_welcome_email","userId":123,"email":"alice@example.com"}
```

The message waits there until a consumer receives and acknowledges it.

This is different from Redis Pub/Sub:

```text
Redis Pub/Sub:
  message is forwarded to active subscribers and then forgotten

RabbitMQ:
  message is stored in a queue until it is consumed and ACKed
```

---

## Consumer Flow

The service also contains `consumeEmailJobs`.

That method is not automatically started by the HTTP endpoint. It shows how a worker would consume jobs from the queue.

Consumer setup:

```typescript
await channel.assertQueue(this.queueName, { durable: true });
await channel.prefetch(10);

await channel.consume(
  this.queueName,
  async (message) => {
    if (!message) return;

    await this.handleMessage(channel, message, handleJob);
  },
  { noAck: false },
);
```

Important details:

- `prefetch(10)` means this consumer receives at most 10 unacked messages at a time.
- `noAck: false` means manual acknowledgement is enabled.
- The message is not removed from the queue until the consumer sends `ack`.

---

## Successful Consumer Processing

If the worker processes the job successfully:

```typescript
await handleJob(job);
channel.ack(message);
```

RabbitMQ then removes the message from the queue.

```text
Consumer processed job
  -> ACK
  -> RabbitMQ deletes message
```

---

## Failed Consumer Processing

If the worker fails:

```typescript
channel.nack(message, false, true);
```

The arguments mean:

```text
message       = the failed message
false         = do not nack multiple messages
true          = requeue the message
```

So the failed message goes back to the queue and can be processed again.

```text
Consumer failed job
  -> NACK with requeue=true
  -> RabbitMQ puts message back into queue
  -> another attempt can process it later
```

---

## Important Failure Behavior

If the API server crashes after sending the message to RabbitMQ:

```text
Message remains in RabbitMQ queue
```

If a consumer crashes before sending `ack`:

```text
RabbitMQ can requeue the unacked message
```

If the consumer sends `ack` and then crashes:

```text
RabbitMQ has already removed the message
```

For that reason, real consumers should:

- finish the important work first
- then send `ack`
- be idempotent, because retries can process the same message more than once

