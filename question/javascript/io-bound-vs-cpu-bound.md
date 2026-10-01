# I/O-Bound vs CPU-Bound Work in Node.js

Node.js is single-threaded (one event loop). Whether a slow operation hurts
**just the request that triggered it** or **every user on the server**
depends entirely on whether that operation is I/O-bound or CPU-bound.

---

## Case 1 — I/O-bound: a slow network call (`await`)

```js
app.post('/api/register', async (req, res) => {
  try {
    // 1. Save user to DB (~50ms)
    const user = await Database.createUser(req.body);

    // 2. Send welcome email (~2000-3000ms, sometimes 30s+) ⚠️
    await EmailService.sendWelcomeEmail(user.email);

    // 3. Return response
    return res.status(200).json({ message: 'Đăng ký thành công!' });
  } catch (error) {
    return res.status(500).json({ error: 'Có lỗi xảy ra' });
  }
});
```

### What does NOT happen

`await EmailService.sendWelcomeEmail(...)` waits on **network I/O**. Node's
event loop is not blocked while waiting — it's free to process other users'
unrelated requests (login, browsing, etc.) completely normally. This is the
whole point of Node's non-blocking I/O model. If this were a synchronous
30-second CPU loop instead, every user on the server would freeze — that's
not what happens here.

### What DOES happen if `EmailService` takes 30 seconds

**1. That one request hangs open for 30+ seconds**

```
t=0ms     client sends POST /api/register
t=50ms    Database.createUser() resolves — user row is ALREADY created
t=50ms    EmailService.sendWelcomeEmail() starts...
t=30050ms ...finally resolves
t=30050ms res.status(200) finally sent
```

**2. The client/proxy times out before the server responds — but the
registration already succeeded**

Browsers, mobile HTTP clients, and reverse proxies (nginx, ALB, Cloudflare)
almost always have a timeout shorter than 30s (often 10–15s):

```
t=10000ms   client's HTTP timeout fires → user sees "Something went wrong"
t=30050ms   server finally sends 200 — but nobody's listening anymore
```

The user believes registration **failed**, but `Database.createUser()`
already succeeded at t=50ms. If they retry, you now have a duplicate
submission — best case it hits a unique constraint on email and confuses
them ("email already registered" — but I never registered!), worst case
(no unique constraint) you get a duplicate user row.

**3. Concurrent requests pile up and hold resources open**

If 100 users register in the same minute while the email service is stuck
at 30s, all 100 requests stay alive at once — 100 open sockets, 100 pending
`req`/`res` objects in memory. This stops being free once:

- The outbound HTTP client to `EmailService` has a connection pool limit
  (`http.Agent`'s `maxSockets`) — later calls queue behind earlier ones,
  compounding the delay further.
- You're near the process's file-descriptor/memory limits.

**4. The dangerous variant — wrapping both steps in a DB transaction**

```js
// A common mistake: wrapping the email send inside the same transaction
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: req.body });
  await EmailService.sendWelcomeEmail(user.email); // still inside the transaction!
});
```

Now the DB connection (and any row locks) stays held from the connection
pool for the full 30 seconds. Connection pools are small (often 10–20
connections). A handful of concurrent slow registrations can exhaust the
entire pool — and now **every unrelated query in the whole app** (login,
browsing, anything hitting the DB) queues up waiting for a free connection.
One slow dependency (email) takes down the entire application, not just
`/register`.

### Fix — move non-critical I/O off the request path

```js
app.post('/api/register', async (req, res) => {
  try {
    const user = await Database.createUser(req.body);

    // Fire-and-forget via a queue — don't make the user wait for this
    await queue.publish('user.registered', { email: user.email });

    return res.status(200).json({ message: 'Đăng ký thành công!' });
  } catch (error) {
    return res.status(500).json({ error: 'Có lỗi xảy ra' });
  }
});

// Separate consumer — runs independently, retries on failure,
// has zero effect on request latency
queue.consume('user.registered', async ({ email }) => {
  await EmailService.sendWelcomeEmail(email);
});
```

Response time is now ~50ms. The client never times out, there's no
duplicate-registration confusion, and a slow/down email provider can't hold
open sockets or (in the transaction variant) starve the DB pool for the
rest of the app.

---

## Case 2 — CPU-bound: synchronous processing (e.g. file upload + resize)

```js
app.post('/api/upload', async (req, res) => {
  const buffer = await getFileBuffer(req);        // I/O — doesn't block
  const resized = resizeImageSync(buffer);         // CPU-bound, synchronous — BLOCKS
  const compressed = compressSync(resized);        // CPU-bound, synchronous — BLOCKS
  await saveToStorage(compressed);
  return res.status(200).json({ url: '...' });
});
```

This is a fundamentally different (and worse) problem than the email case —
the event loop genuinely **is** blocked, affecting every user, not just the
one uploading.

### Why this is different

`await EmailService.sendWelcomeEmail()` waits on the network — Node parks
that request and keeps serving others. A synchronous CPU-bound operation
(`resizeImageSync`, `JSON.parse` on a huge file, a hand-rolled
hash/compression loop, PDF parsing, video frame processing) runs **on the
single main thread with nothing else able to run until it returns** — not
even accepting new TCP connections.

### The failure mode, concretely

```
t=0ms     User A uploads a 50MB image, resize takes 4000ms synchronously
t=0-4000ms   EVERY other request — User B's login, User C's health check,
             User D's completely unrelated /products request — all queue up
             behind this one synchronous call. Nothing else runs at all.
t=4000ms  User A's response finally sent, event loop resumes normal work
```

This isn't "one slow request" like the email case — the entire server
freezes for all users, including the load balancer's health check, which
can mark the instance unhealthy and kill it mid-request.

### Fix 1 — offload CPU work to Worker Threads (keeps it in-process)

```js
// worker.js — runs on a separate thread, has its own event loop
import { parentPort, workerData } from 'worker_threads';
import sharp from 'sharp';

const resized = await sharp(workerData.buffer).resize(800).toBuffer();
parentPort.postMessage(resized);
```

```js
// main handler — main thread stays free to serve other requests
app.post('/api/upload', async (req, res) => {
  const buffer = await getFileBuffer(req);
  const resized = await runInWorker('./worker.js', { buffer }); // main thread not blocked
  await saveToStorage(resized);
  return res.status(200).json({ url: '...' });
});
```

The main thread just waits on a message from the worker (I/O-like,
non-blocking) while the actual CPU work happens on a different OS thread.

### Nuance — not every "CPU-heavy" library actually blocks

Some popular libraries already offload to native thread pools under the
hood, so they don't block the event loop even though they look
CPU-intensive:

- `sharp` (image resizing) — uses `libvips` via `libuv`'s thread pool.
- `bcrypt`/`argon2` (password hashing) — the async variants run off-thread.

Always prefer the promise-based/async API over a `*Sync` variant — the sync
variant is the one that actually blocks.

### Fix 2 — for genuinely heavy work, don't do it in the API process at all

```js
app.post('/api/upload', async (req, res) => {
  const fileKey = await streamToStorage(req);         // just stream bytes to S3, no processing
  await queue.publish('file.uploaded', { fileKey, userId: req.user.id });
  return res.status(202).json({ status: 'processing', fileKey });  // 202, not 200
});

// separate worker process/service — scaled independently, own CPU budget
queue.consume('file.uploaded', async ({ fileKey }) => {
  const resized = await resizeImage(fileKey);
  await notifyUser(fileKey, resized);  // websocket, webhook, or poll endpoint
});
```

`202 Accepted` tells the client "I got it, it's processing" — the client
polls a status endpoint or listens on a websocket for completion, instead
of holding a connection open. This also lets the CPU-hungry workers scale
on separate machines/containers from the API servers, so a burst of
uploads doesn't starve the API's ability to serve normal requests.

### Fix 3 — stream the upload, don't buffer the whole file in memory

```js
// BAD: loads entire file into memory before processing — risky for large files
const buffer = await getFileBuffer(req);

// GOOD: stream directly to storage, constant memory regardless of file size
req.pipe(uploadStream);
```

Buffering a full large file in memory (multiplied by concurrent uploads) is
a separate way to degrade/crash the process, independent of the
CPU-blocking issue.

---

## Summary: the two failure modes side by side

| | I/O-bound (slow email) | CPU-bound (sync image resize) |
|---|---|---|
| What's blocked | Just that one request's response | The **entire event loop** — all users |
| Why | Network wait — event loop is free to do other work | Synchronous computation occupies the only thread |
| Fix | Move to background queue, respond early | Worker threads (in-process) or separate worker service (out-of-process) — never do it synchronously inline |
| Also watch for | Duplicate submissions from client timeout/retry | Memory from buffering large files — stream instead |

**Rule of thumb:** `await` on network/DB/queue calls never blocks other
users by itself — the real risks are duplicate work from client-side
timeouts and resource pools (connections, sockets) held open too long. Any
synchronous CPU-heavy code, however, blocks *everyone* for its entire
duration — it must run in a worker thread or a separate process, never
inline in the request handler.
