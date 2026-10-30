# SemVer and migration guarantees

## Release channels

- `0.x` is an explicit development channel. Breaking changes require changelog and migration notes even though SemVer permits them.
- `1.0.0` establishes the first stable public contract after all external release gates pass.
- Stable versions use `major.minor.patch`. Release candidates use `-rc.N` and are never promoted by retagging; stable artifacts are rebuilt from the stable tag.

## Public compatibility surface

The compatibility surface includes package exports and generated declarations, protocol envelopes and stable error codes, `.layer` syntax, component/runtime contracts, CLI commands and machine-readable output, persisted IndexedDB schema, PostgreSQL migrations, event/cursor semantics, Service Worker version manifests, and plugin manifest contracts.

- Patch: compatible fixes, documentation, performance, and additive diagnostics.
- Minor: additive APIs, optional schema fields, new capabilities with explicit fallback, and deprecations.
- Major: removed/renamed APIs, stricter accepted input, incompatible persisted data, changed defaults with observable security or behavior impact, and protocol breaks.

Deprecations remain functional for at least one stable minor and emit a documented diagnostic before removal in a major. Security fixes may tighten unsafe input in a patch release; the advisory must explain the compatibility impact.

## Protocol and event evolution

`protocol` is independent from npm package versions. Unknown protocol major versions fail closed. Additive optional fields keep the same protocol version; changed required semantics require a new protocol version with an overlap window. Durable events are immutable after commit. Cursor recovery either replays an ordered suffix or returns an explicit snapshot requirement.

## PostgreSQL

Released migration identifiers and checksums are immutable. Production changes use expand/migrate/contract:

1. Expand with backward-compatible tables, columns, or indexes.
2. Deploy code that can read old and new representations.
3. Backfill in bounded resumable batches with observed load.
4. Switch reads only after verification.
5. Contract in a later release after the rollback window closes.

Every migration declares preconditions, expected locks, timeout, rollback note, and backup requirement. Destructive DDL is never an automatic application-start migration. Application rollback is supported only while the database remains compatible with the previous version.

## IndexedDB and Service Worker

IndexedDB migrations are sequential and transactional. Stores or fields are not silently deleted; destructive cleanup requires export/purge policy and a major-version migration note. Failed upgrades leave the previous schema usable. User identity namespaces remain isolated.

Service Worker assets are content-addressed and verified before activation. A waiting version becomes active only after drafts/outbox are saved, except a declared `minVersion` security update. At least one verified rollback cache is retained within quota policy.

## Plugins and applications

Plugins declare an engine range and capabilities. A host rejects incompatible or undeclared capabilities before setup. Applications pin exact framework versions in production and upgrade through release notes, migration checks, browser matrix, and rollback rehearsal.
