# ACID Properties

ACID is a set of guarantees that database transactions must satisfy to be reliable.

---

## Bank transfer example: move $100 from Alice to Bob

```sql
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE user_id = 'alice';
  UPDATE accounts SET balance = balance + 100 WHERE user_id = 'bob';
COMMIT;
```

---

## Atomicity

**All operations in a transaction succeed, or none of them do. No partial state.**

If the server crashes after debiting Alice but before crediting Bob, the entire transaction is rolled back. Alice does not lose $100.

---

## Consistency

**A transaction brings the database from one valid state to another valid state.**

Business rules and constraints are never violated. If a constraint says `balance >= 0`, a transaction that would make Alice's balance negative is rejected entirely.

---

## Isolation

**Concurrent transactions do not see each other's intermediate state.**

Isolation levels (from weakest to strongest):

| Level | Problem prevented |
|---|---|
| Read Uncommitted | Nothing — can read uncommitted changes (dirty reads) |
| Read Committed | No dirty reads |
| Repeatable Read | No dirty reads, no non-repeatable reads |
| Serializable | Fully isolated — behaves as if transactions run sequentially |

Higher isolation = stronger guarantees but more lock contention and lower throughput.

---

## Durability

**Once committed, the transaction is permanent — it survives a crash.**

The database writes to a **Write-Ahead Log (WAL)** before confirming the commit. On recovery, uncommitted transactions are rolled back; committed ones are replayed from the log.

---

## Follow-up Q&A

**Q: What is a dirty read?**

Reading data that another transaction has written but not yet committed. Prevented by Read Committed isolation level and above.

**Q: What is a non-repeatable read?**

Reading the same row twice within the same transaction and getting different values because another transaction modified and committed it in between. Prevented by Repeatable Read isolation and above.

**Q: What is a phantom read?**

Running the same query twice and getting a different number of rows because another transaction inserted or deleted rows in between. Prevented only by Serializable isolation.
