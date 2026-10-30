# Native Safari best-effort check

Native Safari is not a mandatory release gate for the current stable candidate. Playwright WebKit remains a required automated compatibility signal, but it is not presented as native macOS/iOS Safari certification.

When Apple hardware is available, record the device, OS, and Safari versions and run this optional staging check:

1. Add to Home Screen and standalone launch.
2. SSR hydration and a measured partial DOM update.
3. Login, protected command, logout, and user-data purge.
4. POST Fetch event stream, background/foreground transition, reconnect, and cursor replay.
5. Offline shell, IndexedDB migration, outbox replay, and revision conflict UI.
6. Waiting Service Worker update, saved drafts/outbox, activation, and rollback-safe boot.
7. Capability fallbacks for push, share, badging, install UI, background sync, file handlers, persistent storage, and viewport behavior.
8. VoiceOver, focus, keyboard navigation on macOS, reduced motion, zoom, and color modes.

Record results as compatibility evidence, not as a condition already satisfied by WebKit automation. Public browser support must continue to say “best effort, not native-Safari-certified” until a separate certification decision is made.
