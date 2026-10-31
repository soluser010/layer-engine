---
title: Complete server operation options
description: Complete server operation options.
audience: intermediate
order: 111
status: documented
updated: 2026-10-31
---

# Complete server operation options

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-server.md)

## Registration and boundaries

This reference covers the server registry, not only browser contracts. Working files and full/simplified calls: [operations](operations.md). Register handler/authorize/cache on the server; shared `src/operations.js` cannot contain functions.

| Field | Default | Shape / range | Purpose |
| --- | --- | --- | --- |
| `name` | `required` | Dotted name, ≤160 | Operation name |
| `type` | `required` | query / command / sync / events.open | events.open is the system stream, not a shared browser declaration |
| `inputSchema / outputSchema` | `required` | JSON Schema object / boolean | Strict compilation during registration; prefer bounded objects |
| `handler` | `required` | (payload, context) => value / Promise | Server only; returns result data |
| `auth` | `session` | session / authenticated / bearer / api-key / none | Public access requires explicit none |
| `authorize` | `null` | function / null | Server only; true permits the object action |
| `permissions` | `[]` | unique dotted string[] | All permissions are required |
| `rateLimitBucket` | `operation.default` | lowercase identifier | Limit group, not an API key |
| `cost` | `1` | integer 1–1000 | Request weight for the limiter |
| `timeoutMs` | `command: 15000; other: 10000` | integer 100–120000 | Milliseconds; timeout does not guarantee rollback of external effects |
| `concurrency` | `32` | integer 1–10000 | Operation concurrency limit |
| `transaction` | `false` | boolean | true allowed only for commands |
| `offlineReplay` | `false` | boolean | true requires command and transaction:true |
| `audit` | `enabled:true, category:metadata` | {enabled?: boolean, category?: string} | No sensitive payloads |
| `cache` | `null` | {ttlMs, scope, tags?} | Query only; TTL 100–3600000; 0–16 tags |
| `cacheInvalidation` | `null` | {scope, tags} | Transactional commands only; 1–16 tags |

## Cache and failures

Scope: `global`, `tenant`, `user`; auth:none permits only global. Tags are unique and match `[a-z][a-z0-9:_-]{0,79}`. Never globally cache user-dependent responses. Unknown fields, invalid schemas, invalid combinations and registration after seal are not ignored. Registration failures are startup failures, not user payload errors.

`define` registers a definition, `get` returns an internal record for the server executor, `has` checks a name, `list` provides inspection metadata, `seal` closes registration, `isSealed` checks state. Never expose get() to the browser.

## Handler parameters

Payload has passed inputSchema. The host supplies identity, permissions, tenant and transaction context; payload does not determine ownership. The return value is checked against outputSchema. Represent business rejection using safe protocol errors; do not expose stacks, SQL or secrets.

Next: [client options](context-api.md), [caching](caching.md), [exact signatures](api-reference-server.md).
