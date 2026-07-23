# Thread vs Worker vs Process

---

## The Core Idea

When your computer runs a program, the OS needs to track what it is running. There are three levels:

```
Process  → an independent running program (its own memory, its own resources)
Thread   → a unit of execution inside a process (shares memory with siblings)
Worker   → a Node.js-specific abstraction over a thread for parallel JS execution
```

Think of it like a restaurant:

```
Process  = the entire restaurant (its own kitchen, staff, cash register)
Thread   = a chef inside the kitchen (shares the same kitchen tools)
Worker   = a chef hired specifically for one long task (e.g. only makes desserts)
```

---

## 1. Process

A **process** is a running instance of a program. The OS gives it:

```
- Its own memory space (heap, stack)
- Its own file descriptors
- Its own environment variables
- Its own PID (process ID)
```

### Key properties

```
✓ Fully isolated — one process cannot read another's memory
✓ If one process crashes, others are unaffected
✗ Expensive to create (OS must allocate memory, copy state)
✗ Communication between processes requires IPC (pipes, sockets, shared memory)
```

### Real example

When you run `node app.js`, that is one process. When you run it again in another terminal, that is a second **separate** process. They cannot share variables directly.

```
Terminal 1: node app.js  → PID 1234 (its own memory)
Terminal 2: node app.js  → PID 5678 (its own memory)

PID 1234 cannot read a variable from PID 5678.
They communicate via HTTP, sockets, or message queues (like Kafka).
```

### In Node.js — child_process

```javascript
const { fork } = require('child_process')

// Spawns a completely new Node.js process
const child = fork('worker.js')

// Send message via IPC (Inter-Process Communication)
child.send({ task: 'compress-file', path: '/data/big.csv' })

child.on('message', (result) => {
  console.log('Child finished:', result)
})
```

```
Parent process (PID 100)
  ├── child process (PID 101) ← fork()
  └── child process (PID 102) ← fork()

Each child has its own memory. Communication is via message passing.
```

---

## 2. Thread

A **thread** is a unit of execution **inside a process**. Multiple threads share the same memory space.

```
One process can have many threads:

Process (PID 100) — memory: 500MB
  ├── Thread 1 (main thread)     → handles HTTP requests
  ├── Thread 2 (worker thread)   → runs database queries
  └── Thread 3 (worker thread)   → processes images

All three threads share the SAME 500MB memory.
Thread 1 can read a variable that Thread 2 wrote.
```

### Key properties

```
✓ Cheap to create (no new memory allocation — shares parent memory)
✓ Fast communication — shared memory, no serialization needed
✓ Good for I/O parallelism
✗ Shared memory = race conditions (two threads write same variable → corruption)
✗ If one thread crashes hard enough, it can bring down the whole process
✗ Requires synchronization (mutex, lock) to safely share data
```

### Race condition example

```javascript
// Two threads both increment the same counter:
let counter = 0

// Thread 1:                Thread 2:
counter = counter + 1       counter = counter + 1
// Both read 0, both write 1 → result is 1, not 2
// This is a race condition
```

Languages like Java and Go use threads heavily and have built-in tools (mutex, synchronized) to handle this.

### Node.js and threads

Node.js runs JavaScript on a **single thread** (the event loop). This is intentional — no shared memory means no race conditions. But it means CPU-heavy work blocks everything.

---

## 3. Worker (Node.js Worker Threads)

A **Worker Thread** in Node.js is a thread you create specifically to run JavaScript in parallel, without blocking the main event loop.

Introduced in Node.js 12 via the `worker_threads` module.

```javascript
const { Worker, isMainThread, parentPort } = require('worker_threads')

if (isMainThread) {
  // Main thread: spawn a worker for heavy computation
  const worker = new Worker(__filename)
  worker.on('message', (result) => console.log('Result:', result))
  worker.postMessage({ numbers: [1, 2, 3, 4, 5] })
} else {
  // Worker thread: runs the same file but in a separate thread
  parentPort.on('message', ({ numbers }) => {
    const sum = numbers.reduce((a, b) => a + b, 0)
    parentPort.postMessage(sum)
  })
}
```

### Key properties

```
✓ Separate JS execution context (no shared mutable state by default)
✓ Can share raw memory via SharedArrayBuffer (opt-in, explicit)
✓ Lighter than child_process (no new OS process, same memory space)
✓ Good for CPU-heavy JS tasks (parsing, compression, crypto)
✗ Cannot share regular JS objects — must serialize via postMessage
✗ Overhead per message (serialization/deserialization)
✗ More complex than just writing async/await
```

### Worker vs child_process in Node.js

```
Worker Thread (worker_threads):
  → same OS process, new JS thread
  → lower overhead
  → can share raw memory via SharedArrayBuffer
  → good for: CPU-heavy JS (image processing, parsing large JSON)

child_process.fork():
  → new OS process
  → higher overhead, full isolation
  → communicates via IPC (serialized messages)
  → good for: running separate scripts, crash isolation
```

---

## Side-by-Side Comparison

| | Process | Thread | Worker (Node.js) |
|---|---|---|---|
| **Memory** | Own isolated memory | Shared with siblings | Own JS heap, same OS process |
| **Crash isolation** | Full — crash doesn't affect others | Partial — can crash whole process | Full JS isolation, no shared state |
| **Creation cost** | High (OS allocates memory) | Low (shares existing memory) | Medium (new V8 isolate) |
| **Communication** | IPC, sockets, Kafka | Shared memory (fast, risky) | postMessage (serialized) |
| **Race conditions** | Not possible (separate memory) | Yes — requires locks/mutex | No (no shared JS state) |
| **Use case** | Run separate programs | Parallel work in same program | CPU-heavy JS in Node.js |
| **Node.js API** | `child_process.fork()` | N/A (JS is single-threaded) | `worker_threads` |
| **Example** | `node server.js` × 4 CPUs | Java web server with thread pool | Resize image without blocking API |

---

## How Node.js Actually Works

Understanding this is critical for backend interviews.

### The Event Loop (single thread)

```
Node.js runs all your JavaScript on ONE thread — the event loop.

Request 1 arrives → JS handler runs → calls db.query() → yields to event loop
Request 2 arrives → JS handler runs → calls redis.get() → yields to event loop
db.query() finishes → event loop picks it up → runs callback for Request 1

This is why async/await works: the thread yields while waiting for I/O,
so other requests can run. No threads needed for I/O concurrency.
```

### The hidden thread pool (libuv)

```
Node.js DOES use threads internally, but you never see them:

Event Loop (JS thread)
      │
      ├──► libuv thread pool (4 threads by default)
      │         → file system reads (fs.readFile)
      │         → DNS lookups
      │         → crypto operations (bcrypt, pbkdf2)
      │         → some native addons
      │
      └──► OS async APIs
                → network sockets (epoll/kqueue — no thread needed)
                → timers
```

So when you call `fs.readFile()`, Node.js hands it to a libuv thread. Your JS thread is free to handle other requests. The callback runs back on the JS thread when the file is ready.

### What actually blocks Node.js

```javascript
// These BLOCK the event loop (all requests freeze):
const result = JSON.parse(hugeMegabyteString)  // CPU work on JS thread
while (true) {}                                 // infinite loop
crypto.pbkdf2Sync(password, salt, 100000, 64)  // Sync crypto

// These do NOT block (async I/O):
await db.query('SELECT ...')    // goes to libuv / OS
await redis.get('key')          // network I/O
await fs.promises.readFile()    // goes to libuv thread pool
```

### When to use Worker Threads

```javascript
// BAD: CPU work on the main thread blocks all requests
app.get('/report', async (req, res) => {
  const data = await db.query('SELECT * FROM swap_events LIMIT 1000000')
  const csv = rows.map(r => Object.values(r).join(',')).join('\n')  // blocks 2s!
  res.send(csv)
})

// GOOD: offload to a worker thread
app.get('/report', async (req, res) => {
  const data = await db.query('SELECT * FROM swap_events LIMIT 1000000')
  const csv = await runInWorker('csv-converter.js', data)  // non-blocking
  res.send(csv)
})
```

---

## Scaling Node.js with Multiple Processes

Since Node.js is single-threaded, one process uses only one CPU core. To use all 8 cores:

### Cluster module

```javascript
const cluster = require('cluster')
const os = require('os')

if (cluster.isPrimary) {
  // Primary process: fork one worker per CPU core
  for (let i = 0; i < os.cpus().length; i++) {
    cluster.fork()  // each fork = new OS process running this same file
  }
} else {
  // Worker process: run the HTTP server
  require('./server')
}
```

```
Primary (PID 100) — just manages workers, no HTTP
  ├── Worker (PID 101) → HTTP server on core 1
  ├── Worker (PID 102) → HTTP server on core 2
  ├── Worker (PID 103) → HTTP server on core 3
  └── Worker (PID 104) → HTTP server on core 4

OS load-balances incoming TCP connections across all workers.
```

### PM2 (production standard)

```bash
# Run 4 instances of the app (one per core)
pm2 start app.js -i 4

# Or auto-detect core count
pm2 start app.js -i max
```

PM2 handles clustering, auto-restart on crash, and log aggregation.

---

## In the DEX Scanner Context

```
Current setup:
  One NestJS process (single Node.js process)
    ├── Event loop handles HTTP requests
    ├── KafkaJS consumers (async I/O — event loop handles fine)
    ├── ClickHouse inserts (async I/O — event loop handles fine)
    └── Redis writes (async I/O — event loop handles fine)

Everything is I/O — no CPU work → single process is fine.

When you would need workers/processes in this project:

  Scenario 1: Parse raw blockchain transaction data (CPU-heavy decoding)
    → Worker Thread to decode ABI-encoded logs without blocking the API

  Scenario 2: Generate PDF trade reports for 1M rows
    → Worker Thread or child_process for the CPU-heavy aggregation

  Scenario 3: Scale to handle 100K HTTP requests/sec
    → PM2 cluster: pm2 start main.js -i max
    → Each CPU core runs one NestJS process
    → Kafka consumers in each process read different partitions
       (that's why we have 100 partitions — one per potential consumer)
```

---

## Interview Q&A

**Q: What is the difference between a process and a thread?**

> A process is an independent running program with its own isolated memory. A thread is a unit of execution within a process that shares memory with other threads in the same process. Processes are isolated — a crash in one doesn't affect another. Threads share memory — faster communication but risk race conditions.

**Q: Why is Node.js single-threaded, and is that a limitation?**

> Node.js runs JavaScript on a single thread to avoid the complexity of shared-memory concurrency (race conditions, deadlocks). It's not a limitation for I/O-heavy workloads like web servers — the event loop handles thousands of concurrent requests by yielding while waiting for I/O. It only becomes a limitation for CPU-heavy work, which you solve with Worker Threads or by offloading to a separate service.

**Q: When would you use Worker Threads vs child_process in Node.js?**

> Worker Threads for CPU-heavy JavaScript that needs to run in parallel without blocking the main thread — image processing, large JSON parsing, crypto. child_process for running a completely separate script or when you need crash isolation. Worker Threads are cheaper (same OS process) but less isolated. child_process are heavier but fully independent.

**Q: How do you scale a Node.js server across multiple CPU cores?**

> Use the cluster module or PM2 to spawn one process per CPU core. The primary process manages workers; each worker runs the full HTTP server. The OS distributes incoming connections. This is horizontal scaling within a single machine. Beyond one machine, run multiple servers behind a load balancer (Nginx, AWS ALB).

**Q: What is a race condition and how do you avoid it in Node.js?**

> A race condition occurs when two concurrent operations both read and modify the same data, and the result depends on which finishes first. In Node.js, JavaScript is single-threaded so you cannot have race conditions in regular JS code. You can still have logical race conditions with async/await — two async operations modifying the same database row, for example. Fix with database transactions, Redis locks (`SET NX`), or by making operations idempotent.
