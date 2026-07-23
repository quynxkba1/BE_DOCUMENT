# Answers — Basic Security

---

## 1. What is SQL injection and how do you prevent it?

### What it is

SQL injection occurs when user-supplied input is concatenated directly into a SQL query, allowing an attacker to alter the query's logic.

### Vulnerable example

```javascript
// DANGEROUS — never do this
const query = `SELECT * FROM users WHERE email = '${email}' AND password = '${password}'`;
```

If the attacker submits:
- `email` = `' OR '1'='1' --`
- `password` = (anything)

The query becomes:
```sql
SELECT * FROM users WHERE email = '' OR '1'='1' --' AND password = '...'
```

`'1'='1'` is always true, and `--` comments out the password check. The attacker logs in as the first user in the table.

### Prevention: parameterized queries / prepared statements

The database driver separates the SQL structure from the user data. User input is **never interpreted as SQL**.

```javascript
// PostgreSQL with pg driver
const result = await db.query(
  'SELECT * FROM users WHERE email = $1 AND password_hash = $2',
  [email, passwordHash]
);

// MySQL with mysql2 driver
const [rows] = await db.execute(
  'SELECT * FROM users WHERE email = ? AND password_hash = ?',
  [email, passwordHash]
);
```

Even if the attacker submits `' OR '1'='1`, the DB treats it as a literal string value, not SQL syntax.

### Prevention: ORMs

ORMs like Prisma, Sequelize, and TypeORM use parameterized queries by default.

```typescript
// Prisma — safe by default
const user = await prisma.user.findUnique({ where: { email } });
```

**Warning:** raw query escape hatches in ORMs can still be vulnerable:
```typescript
// DANGEROUS — raw interpolation in Prisma
await prisma.$queryRaw`SELECT * FROM users WHERE email = ${email}`;  // safe (tagged template)
await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${email}'`);  // ❌ vulnerable
```

### Follow-up Q&A

**Q: What is a second-order SQL injection?**

The attacker stores malicious input in the database (first order), which is later retrieved and used unsafely in a new query (second order). The initial storage is safe, but the later use is not.

```javascript
// User registers with username: admin'--
// It is safely stored in the DB.
// Later, the app runs:
const query = `UPDATE users SET role = 'user' WHERE username = '${storedUsername}'`;
// The stored value is now injected
```

**Q: What are other common injection attacks beyond SQL injection?**

- **NoSQL injection** — injecting operators into MongoDB queries (`{ "$gt": "" }`).
- **Command injection** — injecting shell commands into `exec()` calls.
- **LDAP injection** — manipulating LDAP queries via unsanitized input.
- **Template injection** — injecting expressions into server-side templates.

The defense is always the same: never trust user input, use parameterized APIs, and validate/sanitize at system boundaries.

---

## 2. What is HTTPS and why is it important?

### What HTTPS is

HTTPS = HTTP + **TLS** (Transport Layer Security, the successor to SSL). TLS wraps the HTTP connection in a cryptographic layer.

### What TLS provides

| Property | Meaning | Without it |
|---|---|---|
| **Encryption** | Data in transit is scrambled — unreadable to third parties | Anyone on the network can read passwords, tokens, credit card numbers |
| **Authentication** | The server's certificate proves it is who it claims to be | An attacker can impersonate your server |
| **Integrity** | Data cannot be modified in transit without detection | An attacker can alter responses (e.g. inject scripts, change bank account numbers) |

### TLS handshake (simplified)

```
1. Client → Server: "Hello, I support TLS 1.3. Here are cipher suites I support."
2. Server → Client: "Here is my certificate (public key + identity, signed by a CA)."
3. Client verifies the certificate with a trusted Certificate Authority (CA).
4. Client and server derive a shared session key.
5. All further communication is encrypted with the session key.
```

### Why HTTPS matters in practice

- Users on public WiFi (coffee shop, airport) — anyone on the same network can perform a **packet capture** and read all HTTP traffic.
- **Man-in-the-middle (MITM) attacks** — without certificate verification, an attacker can intercept and relay traffic while reading or modifying it.
- Browser warnings — modern browsers flag HTTP sites as "Not Secure," breaking user trust.
- SEO — Google ranks HTTPS sites higher.
- Required for modern browser features (service workers, geolocation, camera access).

### Follow-up Q&A

**Q: What is a man-in-the-middle (MITM) attack?**

The attacker positions themselves between the client and server, intercepting and optionally modifying traffic. On an HTTP connection, this is trivial — the attacker reads everything in plaintext. On HTTPS, the client validates the server's certificate; without a valid cert, the browser shows a warning and refuses to connect.

**Q: What is HSTS (HTTP Strict Transport Security)?**

An HTTP response header that tells browsers to **only connect via HTTPS** for a specified duration, even if the user types `http://`.

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

This prevents **SSL stripping attacks**, where an attacker downgrades an HTTPS connection to HTTP before the secure channel is established.

**Q: What is certificate pinning?**

An application hardcodes or ships with the exact certificate (or its public key hash) it expects from the server. Even if an attacker obtains a certificate signed by a trusted CA (via a compromised CA or a rogue CA), the app rejects it because it does not match the pinned cert. Common in mobile apps for high-security use cases.

---

## 3. How do you store passwords securely?

### What NOT to do

| Approach | Why it is wrong |
|---|---|
| Plain text | A DB breach immediately exposes all passwords |
| MD5 / SHA1 / SHA256 | Too fast — GPUs can compute billions per second; vulnerable to brute-force and rainbow tables |
| Encrypted (reversible) | If the encryption key is compromised, all passwords are decrypted |

### What TO do: adaptive password hashing

Use an algorithm specifically designed for password storage:
- **bcrypt** — the most widely used; built-in salt; configurable cost factor.
- **Argon2** — winner of the Password Hashing Competition (2015); configurable memory, CPU, and parallelism costs. Preferred for new systems.
- **scrypt** — memory-hard; also good but less widely supported in libraries.

### How bcrypt works

```javascript
const bcrypt = require('bcrypt');

// Registration — hash the password
const saltRounds = 12;  // cost factor: higher = slower to compute
const hash = await bcrypt.hash(plainPassword, saltRounds);
// hash looks like: $2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
// The hash includes: algorithm version, cost factor, salt, and digest — all in one string.

// Login — verify the password
const isValid = await bcrypt.compare(inputPassword, storedHash);
```

The salt is **generated automatically and stored inside the hash string**. No need to store it separately.

### Why adaptive hashing matters

The cost factor (work factor) can be increased over time as hardware gets faster.

| Year | bcrypt rounds reasonable for login |
|---|---|
| 2010 | 10 |
| 2020 | 12 |
| 2026 | 12–14 |

Increasing rounds from 12 to 13 doubles the computation time on the attacker's side, buying time even as GPUs improve.

### What a rainbow table attack is and why salting defeats it

A rainbow table is a precomputed dictionary of `password → hash` pairs. If you hash `"password123"` with SHA256, it always produces the same digest. An attacker looks up the hash in their table and instantly finds the password.

A **salt** is a random value added to the password before hashing. `"password123" + "xK9mP2"` produces a different hash than `"password123" + "aR3vZ7"`. Even two users with the same password get different hashes. Rainbow tables become useless because they would need to be recomputed for every possible salt.

### Follow-up Q&A

**Q: Why is MD5 bad for passwords even if you add a salt?**

MD5 is designed to be fast — a modern GPU can compute ~10 billion MD5 hashes per second. Even with a salt preventing rainbow tables, an attacker can brute-force a salted MD5 hash in seconds to minutes for common passwords. bcrypt/Argon2 are designed to be slow (milliseconds per hash), making brute-force impractical.

**Q: What is Argon2 and why is it preferred over bcrypt?**

Argon2 won the Password Hashing Competition in 2015. It allows configuring:
- **Memory cost** (argon2 is memory-hard — requires large RAM, defeating GPU/ASIC attacks).
- **CPU cost** (number of iterations).
- **Parallelism** (number of threads).

bcrypt only has a CPU cost factor and is not memory-hard, making it more susceptible to GPU-accelerated attacks than Argon2.

**Q: What is pepper and how is it different from salt?**

A **pepper** is a server-side secret value added to passwords before hashing — stored in environment variables or a secrets manager, not in the database. Salt is stored in the database alongside the hash. If the database is breached but the server code is not, the pepper prevents cracking even with the salt.

```javascript
const hash = await bcrypt.hash(password + process.env.PASSWORD_PEPPER, 12);
```
