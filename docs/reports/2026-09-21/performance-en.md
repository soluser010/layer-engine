---
title: Performance report
description: Measured local load, soak, worker, and event stream results.
audience: advanced
order: 220
status: release-candidate
updated: 2026-09-24
---

# Performance report

> Historical report from September 2026. Node version, SHA and measurements apply only to that environment; this is not validation of the current candidate. See the installation guide for current requirements.

## Goal

This report records measured performance of the current Layer‑Engine release candidate on the local stable stand. The numbers describe this machine and configuration; they are not a production capacity guarantee or a claim of 100,000 concurrent users.

## Environment and method

| Parameter | Value |
| --- | --- |
| Measurement date | September 21, 2026 |
| OS | Windows, local OpenServer stand |
| Node.js | 24.12.0 |
| Logical processors | 12 |
| Memory | 31.9 GiB |
| PostgreSQL | 14.2, legacy-compatible |
| Redis | 5.0.14.1, legacy-compatible |
| Caddy | 2.11.4 |
| HTTP load | `autocannon@8.0.0`, 60 seconds per profile |
| Application API | unified `POST /api` |

HTTP throughput used one development worker with real PostgreSQL and Redis. A localhost-only bypass disabled token-bucket rate limiting while intentionally preserving the default per-operation `concurrency: 32` guard. Saturated `429` responses therefore show overload protection, not an internal server failure. The report uses autocannon p97.5 as a conservative p95 upper bound.

## HTTP operations

| Profile | Connections | Successful req/s | p50 | p95* | p99 | 5xx / timeout | Guard 429 | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Smoke query | 20 | 3,378.80 | 5 ms | 7 ms | 8 ms | 0 / 0 | 0 | passed |
| Read query | 25 | 3,298.37 | 7 ms | 9 ms | 11 ms | 0 / 0 | 0 | passed |
| Read query | 50 | 3,112.91 | 14 ms | 25 ms | 35 ms | 0 / 0 | 3,365 of 190,370 | saturated |
| Command | 10 | 1,514.74 | 6 ms | 8 ms | 9 ms | 0 / 0 | 0 | passed |
| Command | 25 | 1,519.24 | 15 ms | 20 ms | 21 ms | 0 / 0 | 0 | passed |
| Command | 50 | 394.46 | 7 ms | 90 ms | 93 ms | 0 / 0 | 129,116 of 152,788 | saturated |
| Mixed 70/20/10 | 100 | 2,145.60 | 15 ms | 377 ms | 389 ms | 0 / 0 | 30,739 of 159,561 | saturated |

`Successful req/s` counts HTTP 200 only. This distinction matters for saturated profiles because total transport throughput includes quickly rejected 429 responses. `Mixed 70/20/10` means 70% query, 20% command, and 10% sync.

## 30-minute soak

| Connections | Duration | Requests | Throughput | p50 / p95* / p99 | Errors / timeout / non-2xx |
| ---: | ---: | ---: | ---: | --- | --- |
| 25 mixed | 1,800.7 s | 4,638,715 | 2,577.58 req/s | 7 / 17 / 18 ms | 0 / 0 / 0 |

Maximum RSS was 265.9 MiB from a 234.2 MiB minimum, while maximum heap was 98.3 MiB. Average system CPU was 17.8%, maximum system CPU was 29.7%, and maximum system memory was 55.5%. The runner did not observe a safety-stop condition.

## Single-worker resources

| Profile | Maximum RSS | Maximum heap | Maximum ELU | Maximum system CPU | Maximum system memory |
| --- | ---: | ---: | ---: | ---: | ---: |
| Smoke query, 20 | 261.1 MiB | 95.6 MiB | 92.9% | 24.6% | 51.3% |
| Read query, 25 | 265.0 MiB | 91.8 MiB | 96.0% | 27.3% | 51.1% |
| Read query, 50 | 265.4 MiB | 94.2 MiB | 97.3% | 87.4% | 53.4% |
| Command, 10 | 264.3 MiB | 97.9 MiB | 97.7% | 56.9% | 54.1% |
| Command, 25 | 264.7 MiB | 97.9 MiB | 98.0% | 43.0% | 55.5% |

High ELU confirms that a single Node process approaches its useful boundary. This is the purpose of the multi-process runtime: independent workers behind Caddy use additional cores instead of relying on one event loop.

## Event Stream without WebSocket

| Profile | Opened / attempted | Connection errors | Event delivery | Gaps | Duplicates | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| SSE 50 | 50 / 50 | 0% | 263.86 ms | 0 | 0 | passed |
| SSE 200 | 200 / 200 | 0% | 219.35 ms | 0 | 0 | passed |
| SSE 500 | 309 / 500 | 38.2% | 130.98 ms for open streams | 0 | 0 | local saturation |

The 500-stream profile records the boundary of the current single-process development host. All 309 open streams received the event without gaps or duplicates. Production capacity must be measured again through Caddy with multiple workers and the target Linux host network limits.

The production repeat used the portable HTTPS bundle, Caddy `least_conn`, four Node workers, the PostgreSQL event journal, and Redis fan-out:

| Profile | Opened / attempted | Open time | Delivery to all | Cursor replay | Gaps | Duplicates | Event ID mismatch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SSE 50 | 50 / 50 | 285 ms | 272 ms | 3 ms | 0 | 0 | 0 |
| SSE 200 | 200 / 200 | 348 ms | 204 ms | 12 ms | 0 | 0 | 0 |
| SSE 500 | 500 / 500 | 860 ms | 207 ms | 26 ms | 0 | 0 | 0 |

Every profile committed a new transactional event, waited for it on every stream, checked its sequence and event ID, closed the population, and opened a new stream from the previous cursor. The gate therefore covers connections, cross-process Redis fan-out, durable PostgreSQL replay, and client recovery after reconnect.

## Multi-process, autoscale, and recovery

| Profile | Configuration | Initial | Peak | After quiet period | Scale-up | Pressure | Scale-down | Rejected |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Fixed 1 | `1/1` | 1 worker | 1 worker | 1 worker | — | — | — | — |
| Fixed 2 | `2/2` | 2 workers | 2 workers | 2 workers | — | — | — | — |
| Fixed 4 | `4/4` | 4 workers | 4 workers | 4 workers | — | — | — | — |
| Auto | `2/auto` | 2 workers | 3 workers | 2 workers | 15.58 s | 40.19 s / 419 requests | 125.57 s | 0 |

The production launcher started separate Node processes and Caddy `least_conn` distributed requests across them. In the automatic profile, the supervisor added `worker-3`, atomically reloaded Caddy, and after 24 quiet intervals removed the upstream, drained the worker, and returned to the configured minimum of two processes.

The first run exposed a metric defect: p95 event-loop delay was compared with a 20 ms quiet threshold while the monitor itself used a 20 ms resolution, preventing quiet intervals from accumulating. The monitor resolution is now 10 ms, and the repeated complete run proved the `2 → 3 → 2` cycle. The integration gate also proved command idempotency, revision conflict handling, tenant isolation, SSE replay, Redis fallback/reconnect, and PostgreSQL readiness loss/recovery through a test-owned TCP fault proxy.

## Production Caddy cluster throughput

A separate gate ran the portable production bundle, HTTPS Caddy `least_conn`, real PostgreSQL/Redis, and fixed 1, 2, and 4 worker configurations. The read profile executed cached `chat.messages.list`; the command profile executed transactional `test.identity.record.create`. Each worker received 16 read connections or 4 command connections, and every profile ran for 20 seconds.

| Profile | Workers | Connections | Successful req/s | Relative to 1 worker | Efficiency | p50 / p95* / p99 | Max CPU | Errors / timeout / non-2xx |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Cached read | 1 | 16 | 7,030.58 | 1.00x | 100.0% | 2 / 3 / 4 ms | 51.4% | 0 / 0 / 0 |
| Cached read | 2 | 32 | 7,557.51 | 1.07x | 53.7% | 4 / 4 / 5 ms | 69.9% | 0 / 0 / 0 |
| Cached read | 4 | 64 | 6,796.07 | 0.97x | 24.2% | 9 / 11 / 11 ms | 79.3% | 0 / 0 / 0 |
| Transactional command | 1 | 4 | 2,029.19 | 1.00x | 100.0% | 1 / 2 / 2 ms | 37.9% | 0 / 0 / 0 |
| Transactional command | 2 | 8 | 2,762.75 | 1.36x | 68.1% | 2 / 3 / 4 ms | 51.6% | 0 / 0 / 0 |
| Transactional command | 4 | 16 | 2,746.08 | 1.35x | 33.8% | 5 / 7 / 8 ms | 60.3% | 0 / 0 / 0 |

Caddy distributed requests across every configured worker, and each profile observed exactly the expected process count. Two workers were the practical optimum on this combined local stand. Four processes shared CPU, PostgreSQL, Redis, and the load generator on one machine, so they did not add capacity. This does not mean four workers will be slower on a dedicated 32-core Linux server; repeat the measurement there with an external load generator.

## Conclusion

- The single-worker development host sustained about 3.3k simple read operations/s or 1.5k transactional test commands/s; the production Caddy bundle produced 7.0k cached reads/s and 2.0k transactional commands/s.
- The default concurrency guard intentionally begins returning 429 at 50 concurrent requests to one operation. Tune it against operation cost, pool budget, and application SLOs.
- POST Fetch Stream was proven at 200 concurrent connections on one development worker and at 500/500 connections through production Caddy with four workers. The production profile delivered one event to all 500 streams in 207 ms without loss or duplicates.
- Fixed 1, 2, and 4 worker profiles proved multi-core use and Caddy distribution. The best throughput on the combined local stand used two workers: 7,557.51 cached reads/s and 2,762.75 transactional commands/s. The automatic profile proved scale-up in 15.58 s and scale-down in 125.57 s. The 30-minute soak passed.
- Performance claims require Linux staging, supported PostgreSQL/Redis versions, an external load generator, and a repeat on the target server.

Machine-readable artifacts are produced by `npm run stable:test:load`, `npm run stable:test:workers`, `npm run stable:test:cluster-load`, and `npm run stable:test:cluster-sse` under local `artifacts/stable-tests/`.

## Reproducibility

| Data | Value |
| --- | --- |
| Verified commit | `8b987f5acdc1a6ab326144d5ec3424e9f48a5282` |
| HTTP baseline | `load-2026-09-21T14-43-44.851Z.json` |
| 30-minute soak | `soak-2026-09-21T15-39-43.385Z.json` |
| Workers and autoscale | `workers-2026-09-21T16-21-27.084Z.json` |
| Production cluster | `cluster-load-2026-09-21T17-05-12.731Z.json` |
| Production SSE | `cluster-sse-2026-09-21T17-29-53.551Z.json` |
| Complete release gate | `npm run release:check` — passed |

Load artifacts remain local and are not included in publishable packages. Keep them with this report until the Linux repeat so the comparison covers methodology, latency, failures, and saturation rather than only peak `req/s`.

## Common mistakes

- Do not treat total transport rate on a saturated profile as useful throughput; separate 429 from 200.
- Do not project local Windows/OpenServer results directly onto Linux production.
- Do not increase operation concurrency without checking the PostgreSQL pool, memory, p99, and error rate.

## Failure contract

The runner stops escalation after CPU exceeds 85% for three intervals, memory exceeds 75%, error rate exceeds 1%, or p99 exceeds 2.5 seconds. An unexpected 5xx, lost or duplicate event, exceeded connection budget, or leaked worker/SSE connection fails the gate.

Next: [Deployment and diagnostics](../../en/deployment-diagnostics.md), [Databases](../../en/database-runtime.md), and [Browser support](../../en/browser-support.md).
