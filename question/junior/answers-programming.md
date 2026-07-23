# Answers — Programming Basics

---

## 1. What is the difference between a process and a thread?

### Process

A **process** is an independent program in execution. It has its own isolated memory space — code, heap, stack, and file descriptors. The OS treats each process separately.

- Crashing one process does not affect others.
- Inter-process communication (IPC) requires explicit mechanisms: pipes, sockets, shared memory.
- Higher creation and context-switch overhead.

### Thread

A **thread** is a unit of execution within a process. Multiple threads share the same memory space of their parent process.

- Faster to create and context-switch than a process.
- Threads can communicate by reading/writing shared memory — but this requires synchronization (locks, mutexes) to avoid race conditions.
- A bug in one thread (e.g. memory corruption, unhandled exception) can crash the entire process.

### Comparison

| | Process | Thread |
|---|---|---|
| Memory | Isolated (own address space) | Shared with other threads in the process |
| Crash isolation | Yes — crashes are contained | No — one thread crash can kill the process |
| Communication | IPC (sockets, pipes) | Shared memory (fast, but needs synchronization) |
| Creation cost | High | Low |
| Use case | Browser tabs, microservices | Parallel work within one service |

### Real example

A web browser:
- Each **tab** is a separate process — a crash in one tab does not bring down the browser.
- Within each tab, multiple **threads** handle rendering, JavaScript execution, and network I/O concurrently.

### Follow-up Q&A

**Q: What is a race condition?**

Two or more threads read and write shared state concurrently without proper synchronization, producing unpredictable results.

```
Thread 1: reads counter = 5
Thread 2: reads counter = 5
Thread 1: writes counter = 6
Thread 2: writes counter = 6  ← should be 7, but Thread 2 used stale value
```

Solved with a mutex (lock): only one thread can modify the counter at a time.

**Q: What is a deadlock?**

Two threads each hold a lock that the other needs, so both wait forever.

```
Thread 1 holds Lock A, waits for Lock B
Thread 2 holds Lock B, waits for Lock A
→ Both blocked forever
```

Prevention strategies: always acquire locks in the same order, use timeouts, or use lock-free data structures.

**Q: How does Node.js handle concurrency if it is single-threaded?**

Node.js uses an **event loop** with non-blocking I/O. When a thread makes a database call or file read, it registers a callback and immediately returns to handle other work. The OS completes the I/O in the background and notifies Node when it is done. This is efficient for I/O-bound work but poor for CPU-bound work (which blocks the event loop). For CPU-bound tasks, Node provides `worker_threads`.

---

## 2. What is async/await and how does it differ from callbacks?

### The problem: callback hell

When async operations depend on each other, nested callbacks become deeply indented and hard to read or reason about.

```javascript
getUser(id, (err, user) => {
  if (err) return handleError(err);
  getOrders(user.id, (err, orders) => {
    if (err) return handleError(err);
    getInvoice(orders[0].id, (err, invoice) => {
      if (err) return handleError(err);
      // finally do something with invoice
    });
  });
});
```

Each level adds indentation. Error handling must be repeated at every level. Adding or removing a step requires restructuring the entire chain.

### Promises — the first improvement

```javascript
getUser(id)
  .then(user => getOrders(user.id))
  .then(orders => getInvoice(orders[0].id))
  .then(invoice => console.log(invoice))
  .catch(err => handleError(err));
```

Flatter, with a single `.catch`. But chaining `.then` can still be hard to read for complex flows.

### Async/await — the modern approach

`async/await` is **syntactic sugar over Promises**. Under the hood, it is the same thing — but it looks and reads like synchronous code.

```javascript
async function loadInvoice(id) {
  try {
    const user = await getUser(id);
    const orders = await getOrders(user.id);
    const invoice = await getInvoice(orders[0].id);
    return invoice;
  } catch (err) {
    handleError(err);
  }
}
```

- `async` marks a function as returning a Promise.
- `await` pauses execution of the async function until the Promise resolves — without blocking the event loop.
- `try/catch` handles errors in the same way as synchronous code.

### Running operations in parallel

Sequential `await` runs operations one after another:

```javascript
const a = await fetchA();  // wait for A
const b = await fetchB();  // then wait for B — total time = A + B
```

`Promise.all` runs them concurrently:

```javascript
const [a, b] = await Promise.all([fetchA(), fetchB()]);
// total time ≈ max(A, B)
```

### Follow-up Q&A

**Q: What happens if you forget `await` before a Promise?**

You receive the unresolved `Promise` object instead of the value.

```javascript
const user = getUser(id);   // missing await
console.log(user);          // logs: Promise { <pending> }
console.log(user.name);     // undefined — name is on the resolved value, not the Promise
```

**Q: What is the difference between `Promise.all` and `Promise.allSettled`?**

- `Promise.all` — rejects immediately if **any** Promise rejects. The other Promises still run but their results are ignored.
- `Promise.allSettled` — waits for **all** Promises to finish, regardless of whether they resolve or reject. Returns an array of `{ status: 'fulfilled'|'rejected', value|reason }`.

Use `Promise.allSettled` when you want results from all operations even if some fail.

**Q: What is `Promise.race`?**

Resolves or rejects as soon as the **first** Promise settles. Useful for timeouts:

```javascript
const result = await Promise.race([
  fetchData(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
]);
```

---

## 3. What is the difference between stack and heap memory?

### Stack

The stack stores **function call frames** and **local primitive variables**. It is automatically managed — memory is allocated when a function is called and freed when it returns.

Characteristics:
- LIFO (Last In, First Out) structure.
- Fixed size (typically 1–8 MB per thread).
- Very fast — just increment/decrement a pointer.
- Stack overflow occurs when too many calls are nested (infinite recursion).

### Heap

The heap stores **dynamically allocated objects**. Memory is managed by the garbage collector (in GC languages like JavaScript, Java, Python) or manually (in C/C++).

Characteristics:
- Large and flexible in size.
- Slower to allocate than stack (GC overhead, fragmentation).
- Objects live until no references to them remain (in GC languages).

### Code example

```javascript
function add(a, b) {
  // a, b, and result are local primitives → stored on the stack
  const result = a + b;
  return result;
}  // stack frame for add() is freed here

const user = { name: "Alice", age: 30 };
// The object { name: "Alice", age: 30 } lives on the heap
// The variable `user` is a reference (pointer) on the stack
```

### Comparison

| | Stack | Heap |
|---|---|---|
| Contents | Call frames, local primitives | Objects, arrays, closures |
| Management | Automatic (LIFO) | Garbage collector (or manual) |
| Size | Small (~MB) | Large (limited by available RAM) |
| Speed | Very fast | Slower (GC pauses, fragmentation) |
| Lifetime | Until function returns | Until no references remain |

### Follow-up Q&A

**Q: What is a memory leak?**

A memory leak occurs when objects are allocated on the heap but never released because references to them still exist, even though they are no longer needed.

```javascript
// Classic Node.js memory leak: attaching listeners without removing them
const emitter = new EventEmitter();
setInterval(() => {
  emitter.on('data', handler);  // adds a new listener every second, never removed
}, 1000);
```

Over time, the heap grows until the process runs out of memory.

**Q: How does garbage collection work?**

Most modern GCs use **mark-and-sweep**:
1. **Mark phase** — starting from root references (global variables, stack variables), traverse all reachable objects and mark them.
2. **Sweep phase** — free all unmarked objects (unreachable = no longer needed).

Modern GCs also use generational collection (young/old generations) because most objects die young.

**Q: What causes a stack overflow?**

Infinite or excessively deep recursion — each function call pushes a frame onto the stack, and the stack has a fixed limit.

```javascript
function infinite() {
  return infinite();  // never terminates → stack overflow
}
```

---

## 4. Explain OOP: encapsulation, inheritance, polymorphism.

### Encapsulation

Hiding internal state and exposing only a controlled interface. External code interacts through methods, not directly with fields. This protects invariants.

```typescript
class BankAccount {
  private balance: number;  // hidden — cannot be set arbitrarily

  constructor(initialBalance: number) {
    this.balance = initialBalance;
  }

  deposit(amount: number): void {
    if (amount <= 0) throw new Error('Amount must be positive');
    this.balance += amount;
  }

  getBalance(): number {
    return this.balance;
  }
}

const account = new BankAccount(100);
account.deposit(50);
console.log(account.getBalance());  // 150
// account.balance = -9999;         // ❌ TypeScript error — field is private
```

Without encapsulation, any code could set `balance` to a negative number, violating the business rule.

### Inheritance

A class inherits properties and methods from a parent class, enabling code reuse.

```typescript
class Animal {
  constructor(protected name: string) {}

  move(): void {
    console.log(`${this.name} moves`);
  }
}

class Dog extends Animal {
  bark(): void {
    console.log(`${this.name} barks`);
  }
}

const dog = new Dog('Rex');
dog.move();   // inherited from Animal: "Rex moves"
dog.bark();   // own method: "Rex barks"
```

Caution: deep inheritance hierarchies create tight coupling. Prefer **composition** ("has-a") over inheritance ("is-a") when possible.

### Polymorphism

The same interface behaves differently depending on the underlying type. A single call to `speak()` triggers different behavior for a `Dog` vs a `Cat`.

```typescript
class Animal {
  speak(): void {
    console.log('...');
  }
}

class Dog extends Animal {
  speak(): void { console.log('Woof'); }
}

class Cat extends Animal {
  speak(): void { console.log('Meow'); }
}

const animals: Animal[] = [new Dog(), new Cat(), new Dog()];
animals.forEach(a => a.speak());
// Output: Woof, Meow, Woof
// The caller does not need to know the specific type.
```

This enables extensibility — add a `Bird` class without changing the loop.

### Fourth pillar: Abstraction

Hiding implementation complexity behind a simple interface. Users of a class know what it does, not how it does it.

```typescript
interface PaymentProcessor {
  charge(amount: number): boolean;
}

class StripeProcessor implements PaymentProcessor {
  charge(amount: number): boolean {
    // complex Stripe API calls hidden here
    return true;
  }
}
```

### Follow-up Q&A

**Q: What is the difference between inheritance and composition? Which is preferred?**

- **Inheritance** ("is-a"): `Dog extends Animal`. Creates tight coupling — changes to the parent affect all children.
- **Composition** ("has-a"): `Car has an Engine`. The `Car` class holds an `Engine` instance and delegates to it.

The principle "favor composition over inheritance" exists because inheritance makes code rigid and hard to change. Composition is more flexible.

**Q: What is the Liskov Substitution Principle (LSP)?**

A subclass should be substitutable for its parent class without breaking the program. If code works with an `Animal`, it should work with a `Dog` without knowing it is a `Dog`. Violating LSP — for example, a `Square extends Rectangle` that breaks the `setWidth/setHeight` contract — is a sign of incorrect inheritance.

**Q: What is an abstract class vs an interface?**

| | Abstract class | Interface |
|---|---|---|
| Can have implementation | Yes (partial) | No (only signatures) |
| State (fields) | Yes | No (in most languages) |
| Multiple inheritance | No (single parent) | Yes (implement many) |
| Use when | Shared base behavior + some required overrides | Defining a contract; decoupling |

---

## 5. What is the difference between acceptance test and functional test?

### Functional test

Verifies that the **code does what the specification says** — from a technical perspective. Written by developers, often at unit or integration level.

> "Given input X, does the system produce output Y?"

```javascript
// Functional test: does the discount calculation work correctly?
test('applies 10% discount for orders over $100', () => {
  const order = createOrder([{ price: 120 }]);
  expect(order.totalAfterDiscount()).toBe(108);
});
```

This tests that a specific function or module behaves correctly according to the technical spec.

### Acceptance test

Verifies that the **system meets business requirements** from the user's perspective. Written against user stories. Often automated as end-to-end (E2E) tests.

> "Did we build the right thing? Does it satisfy the business need?"

```gherkin
# Acceptance test using Gherkin / BDD syntax
Feature: Checkout discount
  Scenario: User receives discount on large orders
    Given I have items worth $120 in my cart
    When I proceed to checkout
    Then I should see a total of $108 with a 10% discount applied
```

This tests the whole system from the user's point of view — UI, API, database, and all.

### Comparison

| | Functional test | Acceptance test |
|---|---|---|
| Question | "Did we build it correctly?" | "Did we build the right thing?" |
| Written by | Developer | Product owner, QA, developer together |
| Level | Unit, integration | End-to-end, system |
| Speed | Fast | Slow (full system) |
| Failure means | Code bug | Wrong feature or business logic |

### The testing pyramid

```
        /\
       /  \   Acceptance / E2E tests  (few, slow, high confidence)
      /----\
     /      \ Integration tests       (moderate)
    /--------\
   /          \ Unit tests            (many, fast, isolated)
  /____________\
```

More unit tests at the base (cheap, fast), fewer acceptance tests at the top (expensive, slow but high business confidence).

### Follow-up Q&A

**Q: What is a unit test vs an integration test?**

- **Unit test** — tests a single function/class in isolation. External dependencies (DB, APIs) are replaced with mocks/stubs.
- **Integration test** — tests multiple components working together, often against a real database or external service.

**Q: What is TDD (Test-Driven Development)?**

Write the test first, watch it fail (red), write the minimum code to make it pass (green), then refactor (clean). The cycle is red → green → refactor. Benefits: forces thinking about the interface before implementation, produces naturally testable code.

**Q: When would you use mocking?**

When you want to test one unit in isolation without spinning up real dependencies. Mock the database to test business logic, mock an external payment API to test the checkout flow without charging real cards. The risk is that mocks can drift from reality — prefer integration tests for critical paths.
