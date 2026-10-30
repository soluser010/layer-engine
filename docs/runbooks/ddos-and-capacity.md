# DDoS, abuse, and capacity

Layer-Engine rate limits protect application resources; they do not absorb volumetric attacks. Production requires an external CDN/WAF and provider-level network protection.

## Layered controls

- Edge: TLS/bot filtering, connection and request-rate controls, geographic/ASN policy when justified, origin authentication, and emergency deny rules.
- Caddy: header/body/time limits, slow-client protection, route allowlist, and bounded upstream connections.
- Node: 256 KiB JSON limit, depth/item/page/batch limits, operation timeout, concurrency semaphore, and graceful event-stream caps.
- Redis: atomic buckets by IP, credential, session, user, tenant, operation, and cost. Failures use the documented fail-closed/degraded policy.
- PostgreSQL: bounded pools, statement/lock timeout, indexed pagination, cost-aware operations, and cancellation on request deadline.

## Signals

Alert on edge reject rate, origin bypass attempts, 408/413/429 rates, authentication failures, event-stream count, operation concurrency, queue/event lag, Redis latency/errors, PostgreSQL pool wait and slow statements, heap/CPU, and outbound provider spend.

## Response

Confirm the edge is the only public origin path. Tighten the narrowest effective WAF/rate bucket, reduce expensive operation concurrency, disable optional presence/media transformations, and preserve authenticated core operations where capacity allows. Do not globally disable CSRF, authorization, validation, or audit to regain throughput.

Scale only after checking the bottleneck: more Node instances cannot fix a saturated database, Redis, network link, or third-party quota. After the event, remove temporary rules deliberately and turn observed attack characteristics into a repeatable load/threat test.
