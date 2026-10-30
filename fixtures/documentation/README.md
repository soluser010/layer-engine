# Documentation fixtures

These fixtures are executable companions to the public RU/EN documentation.
They keep the minimal and production-oriented operation examples aligned with
the compiler and server registry without becoming application templates.

- `minimal/` demonstrates one public query with the smallest explicit contract.
- `full/` demonstrates a session command with validation, authorization,
  transaction, offline replay, audit metadata, limits, and cache invalidation.
- `verify.mjs` compiles the shared contracts, registers their server handlers,
  seals the registries, and confirms inspection never exposes a handler.

Run them through the normal documentation gate:

```text
npm run docs:check
```
