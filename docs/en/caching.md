---
title: Caching — choosing a mechanism
description: Caching — choosing a mechanism.
audience: intermediate
order: 103
status: documented
updated: 2026-10-31
---

# Caching — choosing a mechanism

[Capability map](capabilities.md)

## What is stored

| Mechanism | Stores | Control | Does not do |
| --- | --- | --- | --- |
| HTTP cache | GET responses | Generated host: HTML `no-cache`, content-hashed assets immutable | Retain component state |
| Service Worker | Verified build resources and shell | Manifest/buildId and update lifecycle | Turn POST API into Cache Storage |
| Query cache | Operation results in a user namespace | `context.api.query({cache, offline})` | Retain DOM or update PostgreSQL |
| Redis query cache | Allowed server operation results | Server metadata `cache`, `cacheInvalidation` | Become the source of truth |
| App store / IndexedDB | UI state / durable drafts | Explicit application writes | Automatically preserve arbitrary components |
| `page.cache` | Route metadata value | `private`, `public`, `no-store` | Currently control per-route HTTP/SW caching |

`no-cache` allows storage with freshness validation; `no-store` prevents storage by the corresponding mechanism. Client `cache.policy: 'no-store'` does not disable Redis server cache or resource precache.

## Client query

| Option | Default | Values / effect |
| --- | --- | --- |
| `cache.policy` | `cache-and-network` | `cache-and-network`, `cache-first`, `network-only`, `no-store` |
| `cache.maxAgeMs` | `30000` | Integer 0–86400000; freshness criterion, not an eviction timer |
| `cache.key` | From operation and normalized payload | String 1–320; complete key at most 512 characters |
| `offline.fallback` | `cache` | `cache` or `reject` |

`cache-and-network` displays stored data and refreshes from the network; `cache-first` avoids network for fresh data; `network-only` reads network and stores success; `no-store` neither reads nor writes query cache. A custom key must distinguish every result-changing parameter. Authorization errors are not replaced with stale data.

[Query and refresh examples](context-api.md), [cache changes and outbox](cache-outbox.md).

## Server query cache

For a query: `cache: {ttlMs: 30000, scope: 'tenant', tags: ['messages']}`. TTL 100–3600000 ms; scope `global`, `tenant`, `user`. Anonymous operations only support global scope. Never globally cache personalized responses. Mutations invalidate tags through transactional `cacheInvalidation`; missing Redis bypasses acceleration without losing authoritative data. [Operation contract](operations-reference.md), [databases](database-runtime.md).

## Practical choice

For chat: shell/resources in SW, message lists in query cache, unsent messages in outbox, drafts in developer IndexedDB. Refresh a query or explicitly update its cache after a message mutation; a server event cannot automatically know the shape of every UI collection.

To retain expanded panels across navigation, store that state separately. `render: 'csr'`, `cache: 'private'` and `offline: 'snapshot'` do not provide page keep-alive.

## Failures

Invalid policy, maxAgeMs or an oversized key are rejected. Quota/missing IndexedDB require clear UI fallback; do not report durable success after losing data. See [IndexedDB](indexeddb.md), [updates](application-updates.md).
