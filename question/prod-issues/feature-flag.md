# Feature Flags — Decoupling Deploy from Release

> Reference: [viblo.asia](https://viblo.asia/p/feature-flag-developer-am-tham-dua-tinh-nang-moi-cho-nguoi-dung-nhu-the-nao-6J3Zgx6qlmB)

---

## The core idea: decouple *deploy* from *release*

```
Without feature flags:
  deploy new code → 100% of users get the new logic instantly
  bug found → must revert code (redeploy) + maybe revert DB

With feature flags:
  deploy new code (flag OFF) → 0% of users affected, code just sits there inert
  flip flag to 10% → watch metrics
  no problems → flip to 25% → 50% → 100%
  problem found → flip flag OFF → back to old behavior in seconds, no redeploy
```

The code for both old and new behavior ships together in the same deploy;
the flag decides which path runs, per request. This turns "we shipped
something wrong to prod" from an incident requiring a code (and possibly
DB) rollback into flipping a switch.

---

## Common flag types / strategies

| Type | Purpose |
|---|---|
| **Release toggle** | Hide an unfinished feature behind a flag so it can be merged/deployed early without being visible to users |
| **Percentage rollout** | Gradually expose a feature to a growing % of users (10% → 25% → 100%) while monitoring metrics |
| **Kill switch** | Instantly disable a feature (or a risky dependency call) in production without a deploy |
| **Permission/targeting flag** | Enable a feature only for specific users/segments (internal staff first, beta testers, a specific region) |
| **A/B test flag** | Split traffic between two behaviors to compare business metrics, not just "is it broken" |

---

## Percentage rollout — how the "10%" is actually computed

Needs **consistent bucketing** — the same user should always land in the
same bucket, not randomly flip between old/new behavior on every request:

```ts
import { createHash } from 'crypto';

function isInRollout(userId: string, featureKey: string, percentage: number): boolean {
  const hash = createHash('md5').update(`${featureKey}:${userId}`).digest('hex');
  const bucket = parseInt(hash.slice(0, 8), 16) % 100; // stable 0-99 bucket for this user+feature
  return bucket < percentage;
}

// In a NestJS service
async createOrder(userId: string, dto: CreateOrderDto) {
  if (isInRollout(userId, 'new-checkout-flow', 10)) {
    return this.newCheckoutLogic(dto);
  }
  return this.oldCheckoutLogic(dto);
}
```

Hashing `userId + featureKey` means user #42 is *always* in the same
bucket for this specific feature, across every request — no flickering
between old/new behavior — but a *different* bucket for a different
feature, so rollouts don't correlate with each other.

---

## Where the flag's value actually lives

The percentage/state needs to be **external, dynamic state**, not a
hardcoded value in the codebase — otherwise changing it still requires a
deploy, defeating the purpose:

```ts
// Backed by Redis, a DB table, or a dedicated flag service — read at
// request time, not baked into the build
const percentage = await this.flagsService.getRolloutPercentage('new-checkout-flow');
```

Dedicated platforms (LaunchDarkly, or self-hostable options like
**Unleash** and **GrowthBook**) provide a dashboard to flip
percentages/targeting live, without touching CI/CD — useful so an
on-call engineer (or a PM) can kill a feature instantly at 2am without a
code deploy.

---

## What to watch at each rollout stage

Same p50/p95/p99 tracking discussed in `api-latency-optimize.md` — this is
the actual purpose of percentile dashboards during a gradual rollout:

```
10%  → watch error rate + p95/p99 latency for the flagged cohort specifically
       (not the global average — a regression affecting only 10% of users
       can hide inside a global average)
25%  → confirm the same metrics hold as blast radius grows
100% → fully rolled out, safe to start cleaning up the old code path
```

---

## The critical connection to safe migrations

A feature flag makes **code** rollback free. It does **not** make a
**destructive schema change** free — if the migration underneath the
flagged feature did `DROP COLUMN` or `ALTER TYPE`, flipping the flag off
doesn't undo that.

This is why feature-flagged rollouts are meant to be paired with
**expand-only migrations** (see `database-migration-cicd-workflow.md`):

```
Deploy: schema is purely ADDITIVE (new column/table) + code behind a flag
   ↓
Flag at 10% → 25% → 50% → 100%, monitoring metrics at each step
   ↓
Problem at any point → flip flag to 0% → done. Zero code redeploy, zero DB
                        rollback, because nothing was ever dropped/renamed
   ↓
Only once the feature is fully rolled out and stable do you do the
"contract" step (drop old columns/code paths no longer needed) — by which
point you're not rolling back anything, you're cleaning up a feature
that's already proven safe.
```

---

## Summary: feature flag vs. reverse migration

| | Feature flag rollout | Reverse migration |
|---|---|---|
| Fixes a logic bug | Instant — flip flag off | Requires redeploy of code |
| Fixes a schema problem | No — only works if schema change was additive | Yes — that's specifically what it's for |
| Speed to recover | Seconds | Minutes (write/review/apply a new migration) |
| Requires planning ahead | Yes — must be built with a flag from the start | No — can be done reactively after the fact |

## See also

- `database/database-migration-cicd-workflow.md` — expand-contract, safe deploy ordering
- `mid-level/api-latency-optimize.md` — p50/p95/p99 tracking used to evaluate a rollout
