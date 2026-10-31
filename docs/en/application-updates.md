---
title: Application updates
description: Observable resource updates, a manifest-branded card and safe Service Worker replacement.
audience: all
order: 183
status: documented
updated: 2026-10-16
---

# Application updates

## Goal

Update a PWA without implementing worker events, progress and multi-window preparation yourself. This is a Layer infrastructure card, not a general UI component library.

## Example

New layer.config.js files include:

```js
export default {
    appName: 'example-app',
    updates: {
        enabled: true,
        ui: true,
        checkIntervalMs: 300000
    }
};
```

Use ui: false to supply your own interface. enabled: false disables Layer checks, not registration or the browser's native Service Worker lifecycle. The interval accepts 60000–86400000 milliseconds.

```js
const unsubscribe = window.layer.pwa.update.subscribe(function(state) {
    //Displaying immutable lifecycle state in application-owned interface
    console.log(state.phase, state.progress);

});

//Removing the subscription when the owning UI is disposed
unsubscribe();
```

## Expected result

Version checks and discovery stay invisible. First offline-cache preparation is invisible too. The card appears while a new build downloads, counts fully verified and cached files, and then offers Update/Later. The application remains usable until the user applies it.

Later hides that build until a new full document launch, including reload. SPA navigation and returning from the background do not reset the choice. Reopen manually with window.layer.pwa.update.show().

## Explanation

Checks run at startup, visible-document return, network recovery and every five minutes in a visible online tab. Automatic events coalesce with a one-minute minimum interval. Active dev live reload owns page updates instead: production checks and the card are disabled.

AppVersion is the human-readable version. BuildId is derived from public resources and the worker program without timestamps, secrets or random UUIDs. Different content gets an isolated cache even with the same appVersion. Legacy version.json keeps its shape; update.json contains update protocol 1, buildId and the version-manifest SHA-256. Mixed deployment metadata cannot be activated.

Resources pass SHA-256 verification before readiness and activation. Installing a candidate never deletes the working cache. The previous complete build and live-client caches are retained; sessions, IndexedDB, outbox and drafts are not purged. Progress counts prepared files, not transferred bytes. The worker-script download never receives an invented percentage.

The card reads name, short_name, description, icons, background_color and theme_color from the validated manifest. Its icon is 76 px; maximum width is 420 px, with a 16 px lower gap and safe-area/viewport handling. Buttons fill the bottom row; hover darkens by 5%. Labels use RU for ru, otherwise EN, and inherit the app font. The card lives outside the route mount-root, preserving CSR/hydration and navigation ownership.

Public CSS variables: --layer-update-background, --layer-update-accent, --layer-update-text, --layer-update-button-text, --layer-update-radius, --layer-update-shadow. Define them on the app root or card. The application is responsible for contrast when overriding defaults.

## API and saving data

Existing check(), getState() and activate() remain. New methods are subscribe(listener), dismiss() and show(); activate({force: true}) is reserved for a separately confirmed user action.

State preserves updateAvailable, criticalUpdate, currentVersion, availableVersion and waiting. Additions: currentBuildId, availableBuildId, phase, progress, visible and error. Phases: idle/checking/downloading/verifying/ready/preparing/activating/blocked/error/unsupported.

Before applying, every window calls the onBeforeUpdate export from src/app.js:

```js
export async function onBeforeUpdate({buildId, force}) {
    //Persisting application-owned drafts before agreeing to a new document
    console.log('Preparing release', buildId, force);

    //Returning false blocks ordinary activation when a draft cannot be saved
    return true;

}
```

In a real application, save drafts to IndexedDB and await commit instead of console.log. An absent hook means the window is ready. Layer then persists engine offline state. Preparation timeout is 15 seconds. Refusal, failure or an unresponsive window produces a warning; Update anyway can lose unsaved input. Force does not bypass resource verification or compatibility.

Successful application reloads participating windows with their complete pathname/query/hash. Layer no longer activates on startup. The browser can still naturally activate a worker after all old clients close. minVersion marks criticality but does not remove Later.

## Common mistakes

- Expecting identical builds to receive a new buildId every time.
- Treating 75% of prepared files as 75% of downloaded bytes.
- Not saving an ordinary input's contents in onBeforeUpdate.
- Applying force automatically or before showing a warning.
- Expecting a legacy loaded runtime to display the new card during the initial migration.

For the first rollout, increment your application's version. Old runtimes do not understand the new protocol; closing all old windows and reopening may be necessary. Do not clear user IndexedDB. Subsequent releases use the new card.

## Failure contract

PWA_UPDATE_DEPLOYMENT_MISMATCH means mixed metadata; retry after deployment completes. PWA_UPDATE_NOT_READY means resources are incomplete or evicted. PWA_UPDATE_CLIENTS_BUSY means a window did not confirm saving. PWA_UPDATE_TIMEOUT means the worker did not respond. PWA_PROTOCOL_INCOMPATIBLE cannot be forced. Preparation errors retain the working release; silent check failures never open the card. Public errors contain a safe code, not stack/cause.

Next: [PWA](pwa-service-worker.md), [configuration](configuration.md), [offline](offline-realtime.md), [testing](testing.md).
