# How JavaScript Works

JavaScript is single-threaded but achieves concurrency by splitting work between the **engine** (V8) and the **host environment** (browser Web APIs / Node's libuv). This note covers the runtime model (call stack, heap, event loop) and the compilation pipeline inside V8 (parsing → bytecode → JIT machine code).

Source: [Hiểu hơn về cách hoạt động của JavaScript](https://viblo.asia/p/hieu-hon-ve-cach-hoat-dong-cua-javascript-djeZ1m4RZWz)

---

## 1. The runtime pieces

| Component | Role |
|---|---|
| **JS Engine** | Parses and executes JS (V8 in Chrome/Node) |
| **Memory Heap** | Unstructured region where objects/variables are allocated; reclaimed by the Garbage Collector once unreachable |
| **Call Stack** | LIFO structure — a function call pushes a frame, returning pops it. Single stack ⇒ JS can only do one thing at a time |
| **Web APIs / libuv** | Not part of the JS engine. Provided by the host (browser or Node) — handles `setTimeout`, network I/O, file I/O, timers |
| **Callback Queue (macrotask queue)** | FIFO queue where completed async callbacks (e.g. `setTimeout`) wait |
| **Job Queue (microtask queue)** | Holds Promise `.then`/`catch`/`finally` continuations and `queueMicrotask`. Higher priority than the callback queue |
| **Event Loop** | Watches the call stack; once it's empty, drains the microtask queue completely, then pulls one task from the macrotask queue |

### Why `setTimeout(fn, 0)` doesn't run "first"

```js
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));
console.log('sync');

// Output: sync, promise, timeout
```

1. `sync` runs immediately — it's on the call stack.
2. `setTimeout`'s callback is handed to the host (Web API/libuv), which queues it on the **macrotask** queue only after ~0ms elapses.
3. The Promise callback goes on the **microtask** queue.
4. Once the call stack is empty, the event loop drains **all** microtasks before touching the macrotask queue — so `promise` always beats `timeout`.

---

## 2. Compilation inside V8

JavaScript has no separate ahead-of-time compile step you invoke yourself (no `javac` equivalent). Compilation happens live, inside the engine, in tiers, while the program is already running.

```
Source text
  → Scan (tokens)
  → Parse (AST) — lazy: function bodies are only fully parsed on first call
  → Ignition compiles AST → bytecode, execution starts immediately
  → Ignition interprets bytecode, recording type/shape feedback per call site
  → Hot functions promoted to TurboFan
  → TurboFan uses collected feedback to speculatively compile → native machine code
  → If a speculative assumption breaks → deoptimize back to Ignition bytecode
```

| Stage | Component | Produces | Executed by |
|---|---|---|---|
| Parse | Parser | AST | — |
| Compile (baseline) | **Ignition** | Bytecode | Software interpreter (slow but starts instantly) |
| Compile (optimizing) | **TurboFan** | Native machine code | CPU directly (fast, but only for "hot" functions) |

> Correction to the original article: it claims V8 "compiles JS into machine code... eliminating intermediate bytecode." This is inaccurate for the current pipeline (V8 ≥ 5.9). V8 explicitly *introduced* Ignition bytecode in 2016 to cut memory usage versus its older all-machine-code approach. The real flow is bytecode-first, machine-code-only-for-hot-paths, as described above.

### Bytecode vs machine code

| | Bytecode | Machine code |
|---|---|---|
| Who runs it | A software interpreter (Ignition) | The CPU directly |
| Portable across CPUs? | Yes | No — tied to one instruction set |
| Speed | Slower (per-instruction interpretation overhead) | Fast — no translation layer |
| When V8 produces it | Every function, on first call | Only functions the profiler marks "hot" |

### Hidden classes and inline caching (why TurboFan can optimize)

- V8 assigns objects a **hidden class** (shape) based on their properties and the order those properties were added. Two objects with identical property-add order share a hidden class; different order ⇒ different hidden class, even if the final shape looks the same.
- **Inline caching**: after a few calls at a call site see the same hidden class, V8 skips the generic property lookup and jumps straight to the known memory offset.
- **TurboFan** compiles a hot function using the feedback vector Ignition collected (observed types/shapes), and speculatively strips out checks that were never needed in practice.
- **Deoptimization**: if a later call violates that assumption (new property, different type), V8 discards the machine code, reconstructs interpreter state, and falls back to Ignition bytecode. Repeated deopts on the same function make V8 stop trying to optimize it.

### Practical implications

1. Keep object property order consistent across instances of the "same" shape.
2. Assign all properties in the constructor rather than adding them dynamically afterward.
3. Avoid polymorphic call sites (same function called with wildly different argument shapes) — it defeats inline caching.
4. Use dense arrays with sequential integer keys; sparse/non-integer-key arrays fall back to slower dictionary-mode storage.
5. These optimizations matter for hot, tight loops — not typical I/O-bound backend request handlers, where DB/network latency dominates regardless of hidden-class stability.

---

## 3. One-line mental model

Source text is parsed once into an AST; Ignition turns that into bytecode and starts running it immediately while quietly recording what types/shapes show up; hot functions get promoted to TurboFan, which uses that recorded feedback to gamble on skipping generic checks and emit real machine code — and if the gamble turns out wrong, V8 just falls back to the safe, general bytecode path.
