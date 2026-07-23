# Why Heavy Tasks (Video Upload, Email) Should Use a Queue

---

## The Core Problem: HTTP Requests Have a Clock Running

When a client calls your API, it opens a connection and waits. That connection has limits:

- A **client-side timeout** — browser: ~30s, mobile apps vary, nginx default: 60s
- A **server-side timeout** — your framework, load balancer, reverse proxy
- A **held server resource** (thread or event loop slot) for the entire duration

```
Client                  API Server              External Service
  │                         │                         │
  │── POST /upload ─────────▶│                         │
  │                         │── process video ────────▶│
  │                         │   (takes 3 minutes)      │
  │       waiting...        │                         │
  │                         │                         │
  │◀── 504 Gateway Timeout ─│  (connection died at 60s)│
  │                         │   but work continues??   │
```

The client gets a timeout error. You don't know if the job succeeded. The server may keep working on something nobody is waiting for anymore.

---

## Five Reasons to Use a Queue

### 1. HTTP Is Not Designed for Long-Running Work

An HTTP connection is meant to return a response quickly:

```
open connection → process → close connection
```

"Process" is supposed to be milliseconds to low seconds. Video encoding takes minutes. Sending 10,000 emails takes minutes. These do not fit the model.

A queue **decouples accepting the work from doing the work**:

```
Client                  API Server         Queue           Worker
  │                         │               │                │
  │── POST /upload ─────────▶│               │                │
  │                         │── enqueue ────▶│                │
  │◀── 202 Accepted ─────────│  (takes 2ms)  │                │
  │   (job is queued,        │               │── pick up ────▶│
  │    not done yet)         │               │   encode video │
  │                         │               │   (3 minutes)  │
  │                         │               │◀── done ───────│
```

The client gets `202 Accepted` immediately. The heavy work happens independently in the background.

---

### 2. A Slow Task Blocks Everyone Else

**Node.js (single-threaded event loop)** — CPU-bound work blocks all other requests:

```
Request 1: POST /upload-video  → ties up event loop for 30 seconds
Request 2: GET /users          → has to wait 30 seconds
Request 3: GET /health         → load balancer thinks the server is dead
```

Node.js is good at handling many requests when most work is **I/O-bound**.

I/O-bound means your code asks another system to do work, then waits for the result:

```
request DB query      -> wait for database
request HTTP call     -> wait for external API
request file read     -> wait for disk
request email send    -> wait for SMTP / SendGrid
```

When Node reaches an `await` for I/O, the current request pauses, but the event loop is free to handle other requests.

Example:

```typescript
app.get('/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json(users);
});
```

At this line:

```typescript
await db.query(...)
```

Node sends the SQL query to the database and yields control back to the event loop.

Timeline:

```
t=0ms   Request A comes in: GET /users
t=1ms   Node sends SQL query to DB
t=2ms   Request A is waiting for DB

t=3ms   Request B comes in: GET /health
t=4ms   Node handles Request B
t=5ms   Node returns "ok"

t=20ms  DB returns result for Request A
t=21ms  Node continues Request A
t=22ms  Node returns users
```

The important point:

> Waiting for I/O does not consume the JavaScript thread.

CPU-bound work is different. CPU-bound means JavaScript itself is actively calculating on the main thread.

Examples:

```
large JSON parsing
image processing
video processing
PDF generation
compression / encryption
sorting a huge array
big for-loops
```

Example:

```typescript
app.get('/report', (req, res) => {
  const result = calculateHugeReport();
  res.json(result);
});

function calculateHugeReport() {
  let total = 0;

  for (let i = 0; i < 10_000_000_000; i++) {
    total += i;
  }

  return total;
}
```

Node cannot pause this loop to handle other requests.

Timeline:

```
t=0s    Request A comes in: GET /report
t=0s    Node starts huge calculation

t=1s    Request B comes in: GET /health
        waits

t=2s    Request C comes in: GET /users
        waits

t=10s   calculation finishes
t=10s   Node finally handles Request B
t=10s   Node finally handles Request C
```

This is what "not yielding back to the event loop" means.

Comparison:

| Work type | Example | Event loop stays free? |
|---|---|---|
| I/O-bound | `await db.query()` | Yes |
| I/O-bound | `await fetch()` | Yes |
| I/O-bound | `await fs.promises.readFile()` | Mostly yes |
| CPU-bound | huge loop | No |
| CPU-bound | big `JSON.parse()` | No |
| CPU-bound | image/video processing in JS | No |

Important detail: `async` does not automatically make code non-blocking.

This still blocks:

```typescript
app.get('/slow', async (req, res) => {
  const result = calculateHugeReport(); // CPU-bound, blocks
  res.json(result);
});
```

Better options for CPU-heavy work:

```
Use a queue + worker process
Use Node worker_threads
Use a separate service
Use native tools like ffmpeg in a separate process
```

Short version:

```
I/O wait = Node can handle other requests.
CPU calculation = Node's main thread is busy, so other requests wait.
```

**Thread-based servers (Java, Go)** — each request holds a thread. If you have 100 threads and 100 video uploads are running at once, the 101st request is rejected. The entire API is down for everyone.

A worker process runs **separately from your API process**. It can be slow, CPU-hungry, or even crash and restart — none of that affects your API's ability to respond to other requests.

---

### 3. Retries and Failure Handling Are Built Into Queues

When an API handler crashes mid-task, you have no idea what was completed:

```
API handler (no queue):
  send email to user_1 ✓
  send email to user_2 ✓
  send email to user_3 → server crashes
  send email to user_4 ✗  (never sent, nobody knows)
```

With a queue and acknowledgement:

```
Worker (with queue):
  dequeue job: send email to user_3
  attempt to send → network error
  do NOT acknowledge → message returns to queue
  retry after 30s (with exponential backoff)
  send email to user_3 ✓ on retry
  acknowledge → message permanently removed from queue
```

Queues like RabbitMQ, SQS, and BullMQ will **redeliver** a message if the worker crashes before acknowledging. No silent data loss.

---

### 4. Workers Scale Independently of the API

Video encoding is CPU-intensive. Email sending is I/O-bound. Neither scales the same way as your REST API tier.

```
Without queue:
  Scale API servers up to handle video load
  → Your GET /users endpoint now runs on expensive video-encoding machines
  → Wasteful and coupled

With queue:
  API servers:    3 small instances   (handle HTTP only)
  Video workers:  2 large instances   (scale up during peak hours)
  Email workers:  5 small instances   (scale up for marketing blasts)
  Each tier scales independently to its actual workload
```

You can scale workers to zero overnight and spin them back up in the morning — the queue just holds the jobs until workers are ready.

---

### 5. The Queue Acts as a Buffer Under Load

Without a queue, a traffic spike hits your API directly:

```
Black Friday — 10,000 users upload photos simultaneously
→ API tries to process all 10,000 at once
→ Memory exhausted
→ Server crashes
→ 10,000 failed uploads with no retries
```

With a queue:

```
Black Friday — 10,000 users upload photos simultaneously
→ API enqueues all 10,000 jobs in ~2ms each → all return 202 Accepted
→ Workers process at their steady throughput (e.g. 50/minute)
→ Queue depth: 10,000 → 9,950 → 9,900 → draining steadily
→ All 10,000 eventually processed, no crashes
→ Queue depth metric alerts you to spin up more workers if needed
```

---

## The Pattern in Practice

### Video upload flow

```
POST /api/videos/upload

1. API receives the file
2. Stream raw file to S3           (fast — just bytes)
3. Enqueue job: { videoId, s3Key } (takes ~1ms)
4. Return 202 Accepted: { jobId: "abc123", status: "queued" }

Worker (separate process):
  - Pick up job from queue
  - Download from S3
  - Encode video with ffmpeg       (3 minutes, CPU-intensive)
  - Upload transcoded versions to S3
  - Update DB: video.status = 'ready'
  - Send push notification to user
  - Acknowledge job → removed from queue

Client checks progress:
  GET /api/jobs/abc123 → { status: "processing" }
  GET /api/jobs/abc123 → { status: "ready", url: "https://..." }
```

### Is uploading video to S3 I/O-bound or CPU-bound?

Uploading video to S3 is mostly **I/O-bound**.

Why:

```
Your server reads bytes from client/network
Your server sends bytes to S3/network
Then waits for S3/network response
```

Most of the time is spent waiting on network I/O, not calculating on CPU.

Example:

```typescript
await s3Client.send(new PutObjectCommand({
  Bucket: 'videos',
  Key: 'video.mp4',
  Body: fileStream,
}));
```

At `await`, Node can yield back to the event loop while the upload is in progress.

But there are important details:

| Work | Type |
|---|---|
| Reading file from disk | I/O-bound |
| Network transfer to S3 | I/O-bound |
| Calculating checksum/hash | CPU-bound |
| Compressing video | CPU-bound |
| Encoding/transcoding video | CPU-bound |
| Parsing a huge multipart body into memory | Memory-heavy, can become CPU/GC-heavy |

Best practice:

```
Upload raw video to S3 = OK in API if streamed properly.
Transcode/process video = put in queue/worker.
```

Good flow:

```
Client uploads video
  -> API streams file to S3
  -> API creates DB record
  -> API enqueues video processing job
  -> API returns 202 Accepted

Worker
  -> downloads video from S3
  -> runs ffmpeg transcoding
  -> uploads processed versions to S3
  -> updates DB status
```

Important warning: uploading to S3 is I/O-bound, but it can still hurt your API if you buffer the whole video in memory.

Bad:

```typescript
const buffer = await file.arrayBuffer(); // whole video in memory
await uploadToS3(buffer);
```

Better:

```typescript
await uploadStreamToS3(fileStream);
```

Short answer:

```
Uploading video to S3 is I/O-bound.
Video processing/transcoding is CPU-bound.
Large in-memory buffering is memory-heavy and can damage server performance.
```

### Email send flow

```
POST /api/orders/:id/confirm

1. API saves the order to DB
2. Enqueue job: { type: "order_confirmation", orderId, userId }
3. Return 200 OK with order data

Email worker:
  - Pick up job
  - Fetch order + user details from DB
  - Render HTML email template
  - Call SMTP / SendGrid API
  - Acknowledge job
  - If SMTP fails → do NOT ack → queue retries after 30s
```

---

## Summary Table

| Concern | Synchronous in API | Queue + Worker |
|---|---|---|
| Client waits | For the entire job duration | Only for enqueue (~1ms) |
| Timeout risk | High — minutes of work | None — client already got 202 |
| Server resource usage | Holds thread or event loop slot | API is free; worker runs separately |
| Retry on failure | Manual, error-prone | Built into the queue |
| Scalability | Scale everything together | Scale workers independently |
| Backpressure under load | Server crashes | Queue absorbs the burst |

> **Rule of thumb:** if a task takes more than ~2 seconds, depends on an external service, or must not be lost on failure — put it in a queue. The API's job is to accept work and respond fast. The worker's job is to do the work reliably.

---

## Follow-up Questions

**Q: What HTTP status code should you return when you accept a job for async processing?**

`202 Accepted` — it means "I received your request and it will be processed, but it is not done yet." Do not return `200 OK` because that implies the operation is complete. Include a `jobId` in the response so the client can poll for the result.

**Q: How does the client know when the async job is done?**

Three approaches:
- **Polling** — client calls `GET /jobs/:id` every few seconds until status is `completed`.
- **Webhook** — when the job finishes, the server sends an HTTP POST to a URL the client registered upfront.
- **WebSocket / SSE** — the server pushes a real-time notification to the client when done. Best user experience but requires a persistent connection.

**Q: What is the difference between a message queue and Pub/Sub?**

| | Message Queue | Pub/Sub |
|---|---|---|
| Delivery | One consumer processes each message | All subscribers receive every message |
| Storage | Message stored until acknowledged | Fire-and-forget (Redis Pub/Sub) or stored (Kafka) |
| Use case | Task distribution, work queue | Event broadcast, notifications |
| Example | BullMQ, RabbitMQ, SQS | Redis Pub/Sub, Kafka topics, SNS |

For video encoding you want a **queue** — only one worker should encode each video. For "notify all dashboards that a new order arrived" you want **Pub/Sub**.

**Q: What happens if the worker crashes in the middle of processing a job?**

A well-designed queue does not remove the message until the worker sends an **acknowledgement (ack)**. If the worker crashes before acking, the queue waits for a timeout (called the **visibility timeout** in SQS, **ack timeout** in RabbitMQ) and then redelivers the message to another worker. This guarantees **at-least-once delivery** — the job will be retried.

**Q: What is a Dead Letter Queue (DLQ)?**

If a job fails repeatedly (e.g. 5 retries), you do not want it looping forever and blocking other jobs. A Dead Letter Queue is a separate queue where failed jobs are moved after exhausting retries. Engineers can inspect the DLQ, fix the bug, and replay the jobs manually.

```
Normal Queue → Worker fails 5 times → Dead Letter Queue → Engineer investigates
```

**Q: What is idempotency and why does it matter for queue workers?**

Because queues guarantee **at-least-once delivery**, a worker may process the same job more than once (network glitch before ack, worker crash after processing but before acking). If processing the job twice sends the user two emails or charges them twice, that is a bug.

An **idempotent** worker produces the same result regardless of how many times it runs for the same job:

```typescript
// Idempotent: check before sending
const alreadySent = await db.query(
  'SELECT 1 FROM sent_emails WHERE job_id = $1', [jobId]
);
if (alreadySent) return; // safe to skip

await sendEmail(...);
await db.query('INSERT INTO sent_emails (job_id) VALUES ($1)', [jobId]);
```

**Q: What tools implement job queues in Node.js?**

| Tool | Backed by | Features |
|---|---|---|
| **BullMQ** | Redis | Priority, delays, retries, DLQ, concurrency, UI dashboard |
| **pg-boss** | PostgreSQL | Good if you already use Postgres; no extra infra |
| **RabbitMQ** | Standalone broker | Multi-language, complex routing, very mature |
| **AWS SQS** | Managed AWS | Serverless, no infra to maintain, scales automatically |

BullMQ is the most common choice for Node.js projects that already use Redis.

**Q: What is the difference between `202 Accepted` and a webhook callback?**

`202 Accepted` is the **initial response** — it tells the client the job was queued. A **webhook** is the eventual notification sent when the job finishes. They work together:

```
1. Client: POST /videos/upload     → Server: 202 Accepted { jobId }
2. (worker processes in background for 3 minutes)
3. Server: POST https://client.com/webhook { jobId, status: "ready", url: "..." }
```

The client must register its webhook URL with the server in advance (often as part of the request or in account settings).
