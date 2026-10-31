---
title: Application performance
description: Measure your application's capacity and choose workers, limits and caching.
audience: advanced
order: 220
status: documented
updated: 2026-10-28
---

# Application performance

## Goal

Measure useful load for your application on its target server. A user count alone does not describe operation rates, open streams, data sizes or SQL cost.

## Short example

Use bounded pagination for a message list, declare operation cost and choose caching explicitly:

```js
const queryPolicyData = {
    rateLimitBucket: 'messages-read',
    cost: 1,
    timeoutMs: 10000,
    concurrency: 32,
    cache: {ttlMs: 5000, scope: 'tenant', tags: ['messages']}
};
```

This is part of a server operation definition, not a separate configuration setting. A mutation must record invalidation for the same tenant/tag in its transaction; see [Redis cache](database-runtime.md). Do not enable caching if the response depends on a narrower identity than its declared scope.

## Method

1. Create an isolated database/schema and test accounts. Start with a read operation, then commands and a mixed scenario.
2. Measure one worker first. Increase concurrency in steps using the same data and duration.
3. Separately measure open event streams, publishing, reconnect and offline replay.
4. Compare 1/2/4 workers with the same PostgreSQL connection budget. Observe CPU, memory, network, SQL plans, indexes and connections.
5. Run a safe profile for longer. Check memory growth and infrastructure recovery.

| Metric | Purpose |
| --- | --- |
| Successful 2xx/sec | Useful work; 429 must not inflate this number |
| p50 / p95 / p99 | Typical and tail request latency |
| Separate 4xx / 5xx / timeout | Protective refusal differs from a defect |
| CPU / RSS / heap / event-loop delay | Worker resource saturation |
| PostgreSQL connections and SQL duration | Whether the database is the shared limit |
| Redis hit ratio and data age | Whether caching helps without incorrect responses |
| Event latency / duplicates / gaps | Delivery matters more than open TCP counts |

## Expected result and explanation

You obtain a load/latency table, measured saturation and headroom for your own application. Caddy distributes requests across independent workers, but does not accelerate slow SQL or remove shared database locks. `maximum: 'auto'` is bounded by CPU, memory and connection budget; it does not promise linear speedup.

## Common errors

- Counting transport throughput including 429 as useful capacity.
- Projecting another application's or a local Windows machine's result directly onto Linux production.
- Increasing concurrency without checking pool budget and p99.
- Disabling a public deployment's limiter for benchmark numbers.
- Caching user-specific responses with `scope: 'global'`.

## Failure contract

Stop escalation when errors, latency or memory keep growing; the application's SLO defines its limits. For an initial local run, reasonable stop thresholds are CPU 85% for three intervals, memory 75%, error rate 1%, p99 2.5 seconds. Losing a confirmed command or event is a defect regardless of throughput.

Next: [Databases](database-runtime.md), [Application testing](testing.md), [Deployment](deployment-diagnostics.md).
