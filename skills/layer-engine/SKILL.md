---
name: layer-engine
description: "Build and maintain Layer-Engine applications using offline-first storage, reactive DOM bindings, reusable components and platform capabilities. Use for @solcorp/layer, layer.config.js and *.layer.js, or explicitly requested framework work. Resolve version-matched local documentation before selecting APIs."
metadata:
  version: "2026.11.06.1"
---

# Layer-Engine application development

Build offline-capable, cross-platform PWAs using the installed framework's managed runtime. Prefer reactive updates, reusable components and documented Context APIs. Apply these rules within the user's task; an explicit product requirement takes precedence. For an existing app, improve the requested feature without rewriting unrelated architecture.

## Resolve the installation and handbook

1. Start with the installation or documentation explicitly selected by the user. Confirm its relationship to the app through package metadata, lockfile and workspace/file/link dependencies. Check actual symlink/junction targets. Do not silently substitute another checkout, version or global CLI.
2. Otherwise inspect the project and its ancestors. For an app under `apps/<name>`, look for a framework workspace containing `@solcorp/layer`, its packages and documentation. For an npm app, find its installed `@solcorp/layer` and `@solcorp/layer-docs`, including hoisted ancestor `node_modules`. Inspect files without executing application modules or scanning the entire disk.
3. Set the handbook root to `<framework-root>/docs` for source development, or `<layer-docs-package>/content` for npm. Check package versions and provenance; a matching version number alone does not equate an unpublished checkout with a registry release. Read `en/README.md`; fall back to the same installation's `ru/README.md` or translated article when necessary. Respond in the user's language.
4. Use the [documentation map](references/documentation-map.md) to select the relevant guide and reference. Consult the local `capabilities.md`, `api-catalog.md` and `api-reference-*.md` for the complete supported API. Read only relevant sections. Verify exports, imports, defaults and failure contracts before writing unfamiliar calls.
5. If the correct handbook is missing or ambiguous, report the checked locations and ask for the intended installation. Continue safe code inspection; do not invent APIs. Resolve documentation/behavior conflicts against that installation's export, declaration, validator or test and report the discrepancy. Get Node requirements, CLI commands and feature status from the installation.

Never embed one workstation's absolute paths in reusable instructions. Layer CMS (`objPost`, `objMSPA`, percent-placeholder templates) is a separate platform; do not transfer its contracts into this ESM framework.

## Update state through reactive bindings

- Use `layerSignalCreate`, computed values, stores and `layerBatch` to update dependent text, attributes, properties and list items. Bind reactive values using the supported `html` syntax. Use `when` and `repeat` with stable domain keys for conditional content and collections.
- Do not reload the document or remount an entire page to update a counter, form, message or API result. Create or replace a screen for a real route change, an intentional instance reset or documented recovery. Use the router for internal navigation and preserve documented native link behavior.
- Derive values through computed state; use effects for owned external side effects. Keep component rendering synchronous. Follow documented mutation rules for signals/stores; do not assume deep reactivity or invent a signal `subscribe` method.
- Respect SSR/hydration and browser-only lifecycle boundaries. Let the compiler and runtime own DOM bindings. Limit imperative DOM work to documented refs and integrations with explicit ownership.
- Reuse the installed warmup/retention behavior when available. Verify its experimental status and supported options before configuring it. Background preparation must not execute domain mutations. Retained DOM is tab memory; persist restart-safe drafts separately.
- Own timers, subscriptions, observers and widgets through lifecycle cleanup. When supported retained screens are used, handle activation/deactivation for application resources that must pause. Mount, deactivate and destroy are distinct lifetimes; look up their exact hook names.

## Design the offline path

For each new user workflow, determine what can open, be read, edited and saved without a network, and how pending work reconnects. Make offline-capable behavior the default design wherever the workflow permits it.

- Choose the page's offline policy explicitly. Current documented defaults include `offline: 'deny'`; verify against the installation. Allowing navigation does not create application data. `offline: 'snapshot'` does not itself create a snapshot, and `page.cache` currently does not configure HTTP/SW caching. Check the handbook before relying on these metadata fields.
- Separate storage responsibilities: Service Worker for verified build resources/shell; query cache for authorized operation results; IndexedDB for durable application data/drafts; outbox for replayable commands; signals/stores for live UI state. A cached shell alone does not make a data-dependent screen work offline.
- Check that required CSS, fonts, icons and other assets are included within the documented precache paths and limits. Prefer packaged resources for essential UI. Provide a local fallback or an explicit limitation for external resources. Avoid creating a second Service Worker or independent cache that bypasses build integrity and updates.
- Use the managed query cache and outbox through documented facades. Preserve command identity across retries, handle revision conflicts explicitly, and show pending, failed and synchronized states. Do not report a queued command as server-confirmed or claim a draft is durable after storage failure.
- Keep sensitive one-time payloads and online-only actions out of persistent replay. Use the documented online-only command API and show an offline state. Rejecting an offline request does not necessarily mean its payload bypasses the outbox; verify the actual contract.
- Namespace cached data by trusted user/tenant identity. Handle logout and identity changes, clear private retained state through the supported lifecycle, and surface quota/storage failures. Never mask an authorization refusal with a stale cached success.
- Apply realtime events to application state through signals/stores. Preserve cursor, replay, deduplication and snapshot recovery contracts. Use the managed POST Fetch Stream; do not add WebSocket transport or make a Service Worker own a permanent connection.

## Keep components and files in their roles

Use the documented project layout and existing application conventions:

| Location | Responsibility |
| --- | --- |
| `src/pages` | File routes and page components |
| `src/layouts` | Shared shells and the router outlet |
| `src/components` | Reusable buttons, forms and UI blocks |
| `src/app.js` | Application hooks and shared context |
| `src/operations.js` | Shared operation contracts without handlers |
| `src/server/operations.js` | Server handlers and authorization |
| `src/server/database.js`, `src/server/index.js` | Application schema and server lifecycle |
| `public` | Shell, manifest and direct GET assets |
| `dist` | Generated deployment output |

Create new apps through the installed CLI under `apps/<name>`. Extract repeated UI with explicit props, events and slots; keep unique page logic/styles near the page. Share infrastructure through context and owned stores. Prefer `@solcorp/layer`, component Context APIs and generated operation facades before constructing runtime objects or duplicating framework subsystems.

Change generated output through sources and a build. Application tasks use public extension points; modify framework sources only when explicitly requested. Follow project style; Syntax V1 applies when separately requested or required by project instructions.

## Build for platform capabilities and server authority

- Support mobile/desktop layouts, touch, mouse, keyboard focus and accessible controls. Use scoped styles and the configured CSS build pipeline. Use the documented viewport/keyboard APIs and safe-area behavior; avoid competing global resize or focus systems.
- Check capabilities and handle rejection. Provide a usable fallback for unavailable PWA features. Request installation, sharing, permissions and keyboard focus through required user actions. Browser APIs may be absent during SSR; never promise that programmatic focus opens the keyboard on every platform.
- Keep handlers, SQL and secrets server-side. Use shared operation contracts and server-derived authorization for operations, objects and fields. Route guards do not protect published HTML or replace server access checks. Use documented database facades and parameterized server queries.
- Preserve escaping, CSP, validation and framework limits. For an integration, configure the narrow documented permission rather than disabling security. Configure deployment and automatic HTTPS through the installed guide.

## Verify the affected behavior

Use the application's documented scripts and `testing.md`. Check the build and relevant contracts, then exercise the changed workflow: reactive updates preserving input/focus, navigation/hydration, lifecycle cleanup, narrow-screen input, offline startup after installation, durable drafts, reconnect/replay and identity isolation as applicable. Check storage failures and unavailable capabilities when affected.

Report the tests and browsers actually exercised and remaining limitations. Avoid running framework release/load procedures for ordinary app edits. Skill use does not authorize migrations, publishing, deployment or unrelated configuration changes.
