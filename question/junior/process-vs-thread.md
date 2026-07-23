# Process, Thread, Multithreading, Background Job

---

## Process

A process is an independent running program with its own isolated memory space, given to it by the OS.

```
Process A                    Process B
┌─────────────────┐         ┌─────────────────┐
│ Own memory       │         │ Own memory       │
│ Own file handles │         │ Own file handles │
│ Own env vars     │         │ Own env vars     │
└─────────────────┘         └─────────────────┘
        │                            │
        └──── can't see each other's memory directly ────┘
              (must use IPC: pipes, sockets, shared memory)
```

- Isolated — a crash in one process can't corrupt another's memory.
- Expensive to create (`fork()`/`spawn()`) and expensive to switch between (OS has to swap the entire memory context).
- To communicate between processes: IPC (inter-process communication) — pipes, sockets, shared memory segments, message queues.

---

## Thread

A thread is a unit of execution inside a process. Multiple threads in the same process share the same memory space.

```
Process
┌───────────────────────────────────┐
│  Shared memory (heap, globals)     │
│                                     │
│  Thread 1    Thread 2    Thread 3  │
│  (own stack) (own stack) (own stack)│
└───────────────────────────────────┘
```

- Cheap to create and switch between compared to processes (no full memory-context swap).
- Because memory is shared, threads can read/write the same variables directly — fast, but dangerous: two threads writing the same variable at once causes a race condition. This is why threaded code needs locks/mutexes/semaphores to coordinate.
- If one thread crashes hard enough (segfault), it can take the whole process down with it — unlike separate processes.

---

## Multithreading

Simply: a process running more than one thread at once.

- **On a multi-core CPU**: threads can run truly in parallel — thread 1 on core 1, thread 2 on core 2, simultaneously. This is real parallelism.
- **On a single core**: the OS rapidly time-slices between threads (context switching) — this gives concurrency (things appear to progress together) but not true parallelism (only one instruction executes at any instant).
- The hard part of multithreading isn't creating threads, it's synchronization — avoiding race conditions, deadlocks, and making sure shared state stays consistent. This is a large part of why "just add more threads" is a genuinely hard engineering problem in languages like Java, C++, Go.

---

## Background Job

This one is different from the other three — it's not an OS-level primitive, it's an application-level concept. A "background job" just means: work that happens outside the main synchronous request/response flow, so the caller isn't blocked waiting for it.

Critically: a background job can be implemented with any of the mechanisms above, or none of them:

| Implementation | Example |
|---|---|
| Async code on the same single thread | Node's event loop — no new thread or process, just non-blocking I/O and callbacks |
| A separate thread in the same process | A Java app spawning a `Thread` to do work off the main request thread |
| A separate OS process | A cron script, or forking a child process |
| A separate machine entirely | BullMQ/Sidekiq/Celery worker — a different process (often a different container) pulling jobs from a shared queue (Redis/RabbitMQ) |

"Background job" describes *where the work sits relative to your main flow* — it says nothing about *how* it achieves that. BullMQ jobs are "background" in the sense that they don't block whoever called `.add()`, but by default they still run on the same single JS thread as everything else in that Node process.

---

## How Node.js Fits Into All This

```
Node.js process
┌─────────────────────────────────────────────────┐
│  V8 (JS execution) — single thread                │
│    runs your code, event loop, callbacks           │
│                                                     │
│  libuv thread pool (default: 4 threads)            │
│    handles: file I/O, DNS lookups, crypto, zlib     │
│    (things the OS can't do async natively)          │
│                                                     │
│  OS-level async I/O (epoll/kqueue)                  │
│    handles: network sockets, timers — no threads    │
│    needed at all, OS notifies the event loop         │
└─────────────────────────────────────────────────┘
```

- Your JavaScript always runs on **one thread**. There is no implicit multithreading of your code, ever.
- Concurrency in Node comes from non-blocking I/O: when you `await db.query(...)`, the thread isn't blocked — it goes and processes other work, and the event loop resumes your code when the DB responds. This is concurrency, not parallelism — only one piece of your JS runs at any instant.
- Node does use real OS threads under the hood (libuv's pool) for specific blocking operations it can't make natively async at the OS level — but your application code doesn't run there, only certain built-in Node APIs do.
- To get true parallel execution of your own code, you need to explicitly opt in:
  - `worker_threads` — real OS threads, each with its own V8 instance and isolated memory (no shared-memory footguns by default; communicate via message passing).
  - `child_process` (fork/spawn) — a fully separate OS process, same isolation tradeoffs as any process.
  - Horizontal scaling — multiple Node processes/containers, each single-threaded internally, coordinated via a shared queue (this is what BullMQ + multiple worker replicas gives you).

---

## Tying It Back to BullMQ

- BullMQ's `Worker` = a "background job" abstraction at the application level.
- By default, its job processor runs as async code on Node's single JS thread — concurrency via the event loop, not parallelism.
- If you want actual parallel CPU execution, you explicitly opt into BullMQ's sandboxed processors (`child_process` under the hood) or `useWorkerThreads: true` — at which point you're using real OS threads/processes, not just "background job" semantics.
- The most common production pattern (separate worker service/container, scaled horizontally) is background job = separate process, which sidesteps Node's single-thread limitation entirely by just running more single-threaded processes in parallel.
