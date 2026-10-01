# Blue-Green Deployment

> Reference: [viblo.asia](https://viblo.asia/p/am-hieu-blue-green-deployment-trong-5-phut-6J3ZgmwP5mB)

---

## What it is

Two identical production environments — **Blue** and **Green** — run in
parallel. At any moment, only one of them is receiving live user traffic;
the other sits idle as a full standby copy.

```
Blue (live, v1)  ← 100% of user traffic
Green (idle)     ← deploy new version here, nobody hits it yet
```

## The problem it solves

A traditional in-place deploy updates the *same* running servers — during
that window, requests can hit a half-updated instance, or the app has to
go down entirely, which is why many teams schedule releases for low-traffic
hours with maintenance windows. Blue-green avoids this because the *live*
environment is never touched during a deploy — only the idle one is.

## The process

```
1. Users hit Blue (current live version).
2. Deploy the new version to Green (completely idle, no user traffic).
3. Test/verify Green thoroughly while Blue keeps serving everyone.
4. Switch the router/load balancer so traffic now points to Green.
5. Blue becomes the standby, ready as an instant fallback for next time.
```

Step 4 is the whole trick: instead of gradually rolling pods/instances
(as in a standard rolling deploy), the cutover is a single routing change
— either instant, or gradual if the router supports weighted traffic.

## Advantages

- **Zero downtime** — the live environment is untouched until the switch.
- **Fast, simple rollback** — if Green has a problem, flip routing back to
  Blue, which is still running the known-good previous version. No
  redeploy needed, similar in spirit to a feature-flag kill switch, but at
  the infrastructure level instead of inside application code.

## Disadvantages

- **Cost** — running two full production environments simultaneously
  roughly doubles infrastructure spend during the deploy window (or
  permanently, if kept always-on for fast rollback).
- **The database is the hard part** — a database usually isn't
  duplicated the same way the app servers are (state can't just be
  thrown away like a stateless app instance). Both Blue and Green
  typically point at the **same** database, which means:

```
If the new version's code depends on a schema change that the OLD
version (still potentially serving traffic, or the rollback target)
doesn't understand, blue-green breaks — you can't safely switch back
to Blue if Blue's code can't run against Green's schema.
```

## Why this is the same expand-contract problem, at a different layer

This is exactly the constraint covered in `database-migration-cicd-workflow.md`:
Blue and Green must both be able to run correctly against **the same,
single schema** during the whole window where either one might be live.
That's only possible if the migration was:

- **Additive only** (expand phase) — Blue (old code) simply ignores new
  columns/tables it doesn't know about; Green (new code) uses them. Either
  environment can be live, or you can flip back to Blue at any time,
  without touching the DB.
- **Never destructive during the overlap window** — a `DROP COLUMN` or
  `RENAME` breaks whichever environment's code still expects the old
  shape. The "contract" step (dropping old things) has to wait until
  you're fully committed to Green and have no intention of flipping back
  to Blue.

So blue-green deployment doesn't remove the need for expand-contract
migrations — it makes the *rollback window* longer and more deliberate,
which makes safe (additive-first) migrations even more valuable, since
"flip back to Blue" has to keep working for as long as Blue is kept warm
as a fallback.

## One real-world implementation approach (AWS-based, from the article)

- **Route 53 weighted DNS records** — an early idea for splitting traffic,
  later abandoned (DNS changes propagate slowly and aren't precise enough
  for instant cutover/rollback).
- **CloudFront + Lambda@Edge** — the actual routing mechanism used, giving
  fine-grained, fast control over which environment (Blue or Green)
  handles a given request.
- **Parameter Store** — holds the flag/state indicating which environment
  is currently "live," read by the edge routing logic.
- **CI/CD (CircleCI)** — automatically deploys new code to whichever
  environment is currently the *inactive* one, never the live one.

## Related strategy: canary release

Distinct from blue-green: instead of a full environment switch, a **small
percentage of traffic** is routed to the new version simultaneously with
the old one — essentially the infrastructure-level version of the
percentage-rollout feature flag covered in `feature-flag.md`. Blue-green
switches *all* traffic at once (after verification); canary releases
gradually shift *a fraction* of traffic while watching metrics.

## Summary comparison

| | Blue-Green | Feature Flag | Canary Release |
|---|---|---|---|
| Layer | Infrastructure (whole environment) | Application code | Infrastructure (traffic %) |
| Switch granularity | All-or-nothing cutover | Per-user/request, gradual % | Gradual %, at the routing layer |
| Rollback speed | Instant (flip router back) | Instant (flip flag off) | Instant (route % back to old) |
| Cost | Double infrastructure during overlap | Minimal — just conditional code | Usually minimal — same fleet, weighted routing |
| DB schema constraint | Must support both versions simultaneously | Must support both versions simultaneously | Must support both versions simultaneously |

All three share the same underlying requirement: **the database schema
must remain compatible with both the old and new code for as long as
either might be handling traffic** — which is exactly what expand-contract
migrations are designed to guarantee.

## See also

- `database/database-migration-cicd-workflow.md` — expand-contract pattern, safe deploy ordering
- `prod-issues/feature-flag.md` — the application-code-level equivalent of gradual/reversible rollout
