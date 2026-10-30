# Contributing

Layer-Engine is ESM-only JavaScript for Node.js 24. Public types are JSDoc plus generated declarations; TypeScript is not used as the implementation language.

## Local workflow

1. Install the exact toolchain from `.nvmrc` and `packageManager`.
2. Run `npm ci --ignore-scripts` for a lockfile-reproducible install.
3. Keep changes scoped and add contract tests for public behavior and failure behavior.
4. Run `npm run check` for ordinary changes and `npm run release:check` for release-sensitive changes.
5. Run `npm run api:snapshot` only after reviewing the SemVer effect of declaration changes.

Code follows `syntax-v1`: descriptive domain names, action comments inside non-trivial functions, explicit branches, and stable visual blocks. Do not copy APIs from the old Layer project.

## Compatibility and security

Public exports, `.layer.js` grammar, protocol schemas, stable error codes, CLI output, database migrations, and persisted browser schemas follow [the compatibility policy](docs/policies/semver-and-migrations.md). Never rewrite a released migration or silently apply last-write-wins.

Do not add `eval`, `new Function`, raw HTML bindings, unrestricted outbound URLs, unbounded collections, install lifecycle scripts, mutable dependency ranges, or secrets in fixtures. Security issues follow [SECURITY.md](SECURITY.md), not the public contribution flow.

## Review expectations

A change is ready when its success and failure contracts are tested, generated declarations build, package dry-runs contain only intended files, documentation matches behavior, and the worktree contains no generated release artifacts.

## Maintainer source synchronization

The public GitHub repository has independent history. Private GitVerse history must never be merged or pushed into it. See [the two-checkout workflow](docs/runbooks/public-source.md). Application projects under `apps/` are not framework contributions.
