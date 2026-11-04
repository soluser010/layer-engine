# Contributing

Layer-Engine is ESM-only JavaScript for Node.js 24. Public types are JSDoc plus generated declarations; TypeScript is not used as the implementation language.

## Local workflow

1. Install the exact toolchain from `.nvmrc` and `packageManager`.
2. Run `npm ci --ignore-scripts` for a lockfile-reproducible install.
3. Keep changes scoped and add contract tests for public behavior and failure behavior.
4. Run `npm run check` for ordinary changes and `npm run release:check` for release-sensitive changes.
5. Run `npm run api:snapshot` only after reviewing the SemVer effect of declaration changes.

Code follows `syntax-v1`: descriptive domain names, action comments inside non-trivial functions, explicit branches, and stable visual blocks. Use the documented Layer-Engine APIs.

## Compatibility and security

Public exports, `.layer.js` grammar, protocol schemas, stable error codes, CLI output, database migrations, and persisted browser schemas follow [the compatibility policy](docs/policies/semver-and-migrations.md). Never rewrite a released migration or silently apply last-write-wins.

Do not add `eval`, `new Function`, raw HTML bindings, unrestricted outbound URLs, unbounded collections, install lifecycle scripts, mutable dependency ranges, or secrets in fixtures. Security issues follow [SECURITY.md](SECURITY.md), not the public contribution flow.

## Review expectations

A change is ready when its success and failure contracts are tested, generated declarations build, package dry-runs contain only intended files, documentation matches behavior, and the worktree contains no generated release artifacts.

## Maintainer source synchronization

The public GitHub repository has independent history. Private GitVerse history must never be merged or pushed into it. Maintainers transfer reviewed source snapshots between separate checkouts. Application projects under `apps/` are not framework contributions.


## Development dependency security overrides

The workspace pins `minimatch` to `11.0.1` through `overrides` for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
ESLint, `@eslint/config-array` and `@vscode/vsce` still declare version 10 ranges.
The override is intentional and requires lint, IDE tests and real VSIX packaging
checks when changing these tools. Remove it only after all parent dependencies
resolve patched versions without the override and the full audit passes.
Do not use `npm audit fix --force` or lower the audit threshold to bypass this issue.

The VSIX packaging tool is a root workspace development dependency so the root override also governs its dependency tree. Run `npm run ide:package` from the workspace after `npm ci`; it is not a published application dependency.

## Developer-facing release history

For each release, add matching `docs/ru/updates/<version>.md` and `docs/en/updates/<version>.md` pages. Explain user-visible changes, developer actions, compatibility, and any failure or fallback behavior in plain language. Preserve earlier pages and link the new release from both history indexes and handbook contents. Refresh the single current-version block near the beginning of the root and npm package READMEs. Until npm publication is confirmed, explicitly describe a version as prepared rather than published. Keep internal test logs and infrastructure details outside application guides.
