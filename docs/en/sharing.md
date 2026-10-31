---
title: Sharing — sending and receiving data
description: Web Share, Share Target, text, links and files in Layer PWA.
audience: beginner
order: 183
status: documented
updated: 2026-10-26
---

# Sharing — sending and receiving data

## Goal

Send text, links or photos through the system share menu and receive content from another app. Layer provides APIs and temporary storage; the application owns previews, recipient selection, drafts and server uploads.

## Contents

- [Sending content](#sending-content)
- [Configuring reception](#configuring-reception)
- [Reading text and files](#reading-text-and-files)
- [Retention and limits](#retention-and-limits)
- [Failures and testing](#failures-and-testing)

## Sending content

Use `window.layer.pwa.share`. This is a browser API: do not call it during SSR. `send()` opens the system picker; the user chooses the recipient. Call it directly from a click handler, without a preceding network request: the browser requires user activation. Prepare files before the click. [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API).

For example, create `src/lib/share.js`. This is an application helper, not an additional Layer method:

```js
export async function shareSend( shareData ){
    //Checking browser support for the exact payload before opening native UI.
    const shareApiData = window.layer.pwa.share;

    if ( shareApiData.getCapability().supported === false || shareApiData.canSend( shareData ) === false ){
        return {status: 'unavailable'};

    }

    try {
        //Opening the platform picker within the original user action.
        await shareApiData.send( shareData );
        return {status: 'completed'};

    } catch( shareError ){
        //Treating user cancellation separately from a failed browser request.
        if ( shareError?.name === 'AbortError' ){
            return {status: 'cancelled'};

        }

        return {status: 'error'};

    }

}
```

Inside a button handler for text and a link:

```js
const resultData = await shareSend({
    title: 'My post',
    text: 'Take a look at this post',
    url: 'https://example.com/posts/123'
});
```

For a photo, `photoFileData` must be a previously obtained `File`, for example from `input.files[0]`:

```js
const resultData = await shareSend({
    title: 'Photo',
    files: [photoFileData]
});
```

These fragments run inside a browser event handler; import the helper from `src/lib/share.js`. In `.layer.js`, connect the handler with `@click=${handler}`. Update the UI using `resultData.status`. For `unavailable`, offer link copying or file downloading. `completed` means the browser call completed, not that the recipient received the content. Layer does not select a third-party messenger or bypass cancellation.

## Configuring reception

Add `share_target` to the existing `public/manifest.webmanifest`, preserving its other fields:

```json
{
    "share_target": {
        "action": "/share/",
        "method": "POST",
        "enctype": "multipart/form-data",
        "params": {
            "title": "title",
            "text": "text",
            "url": "url",
            "files": [
                {
                    "name": "photos",
                    "accept": ["image/jpeg", "image/png", "image/webp"]
                }
            ]
        }
    }
}
```

This is a fragment to merge into the manifest, not a complete replacement. Create `src/pages/share/index.layer.js` for `/share/`; the action must be within the app scope. For text-only reception, remove `params.files`; POST can use `application/x-www-form-urlencoded`. The multipart example also accepts text without files.

The build connects an **exact POST action** handler in the generated Service Worker. It validates fields and limits, stores the data in IndexedDB, and returns a 303 redirect to `/share/?layerShareId=...`. The runtime connects this identifier to `window.layer.pwa.shareTarget`. The POST body is not automatically uploaded to the application's `POST /api`. This inbox API is wired for POST, not GET Share Target.

System reception requires an installed PWA on a supporting platform, HTTPS, and an active Service Worker. After changing the manifest, rebuild and verify registration updates on the device; reinstalling may be needed for testing. Outgoing Share support does not imply incoming Share Target support. [Share Target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target).

## Reading text and files

On the receiving page, call this helper once after the browser runtime is ready. Do not run it during SSR or from a repeated render/effect:

```js
async function incomingShareRead(){
    //Checking generated POST inbox support before consuming the pending share.
    const inboxApiData = window.layer.pwa.shareTarget;

    if ( inboxApiData.getCapability().supported === false ){
        return null;

    }

    //Consuming the current layerShareId once; absent or expired records return null.
    const sharedData = await inboxApiData.consume();

    if ( sharedData === null ){
        return null;

    }

    //Converting received Blob records into File objects for application workflows.
    const filesData = sharedData.files.map(function sharedFileCreate( fileData ){
        //Preserving file metadata without treating the filename as a storage path.
        return new File([fileData.blob], fileData.name, {
            type: fileData.type,
            lastModified: fileData.lastModified
        });

    });

    return {
        title: sharedData.title,
        text: sharedData.text,
        url: sharedData.url,
        files: filesData
    };

}
```

The expected result is data for a preview screen. `title`, `text`, and `url` can be `null`; `files` may be empty. The original `consume()` result also contains `shareId`, `createdAt`, and `expiresAt`; each file record contains `field`, `name`, `type`, `size`, `lastModified`, and `blob`.

`consume()` atomically reads and deletes the record, then the runtime removes `layerShareId` from the current URL. A second call does not return the same file. Save received data into an application-owned IndexedDB draft before navigating away; consumption and draft persistence do not share a transaction. The inbox is not reliable long-term draft storage.

Also available: `pendingIdGet()` and `discard(id?)`; `consume(id?)` accepts an explicit identifier. `discard()` deletes the current record without reading it and returns a `boolean`. `getCapability()` confirms generated inbox wiring, not registration in the operating system's share menu.

For a photo, use `URL.createObjectURL(file)` and release it with `URL.revokeObjectURL(url)` when removing the preview or unmounting. Render text through escaped interpolation, not `innerHTML`. URLs, filenames and MIME values remain untrusted input; `accept` does not scan the actual content for malware.

If sign-in is needed, provide a public receiving page that saves a draft before authentication: a guard redirect can lose `layerShareId`. The inbox itself does not require a session or grant upload permissions. After recipient selection and confirmation, perform your authenticated upload; validate permissions, size and type again on the server. Logout clears the temporary inbox. Do not automatically attach incoming files to an account.

## Retention and limits

| Generated inbox limit | Default |
|---|---|
| Entire request, including multipart overhead | 16 MiB |
| One file | 8 MiB |
| File count | 8 |
| Each text field | 64 KiB UTF-8 |
| Pending records | 64 |
| Record availability | 10 minutes |

These are defaults of the lower-level `layerWorkerShareTargetCaptureCreate`; standard application configuration does not expose a separate block to change them. Expired records are not returned; physical cleanup happens during inbox operations, not through a guaranteed background timer.

The separate `window.layer.pwa.files.setConsumer(handler)` handles File Handling/“Open with” and receives `FileSystemHandle[]`. This is a different workflow: Share Target returns Blob records through `consume()`. Layer does not add visual chat-selection or attachment components.

## Failures and testing

- Unsupported outgoing `send()` rejects with `PWA_CAPABILITY_UNAVAILABLE`; invalid data throws `TypeError`. Browser errors, including `AbortError`, propagate to the caller.
- Incoming `consume()` returns `null` for missing, expired or consumed records. An invalid ID throws `TypeError`; IndexedDB failures may reject the Promise and must be handled by the receiving page.
- POST capture may fail before the page opens: the worker returns a safe HTTP response. Capture codes include `SHARE_TARGET_SIZE_EXCEEDED`, `SHARE_TARGET_FILE_INVALID`, `SHARE_TARGET_FIELD_INVALID`, `SHARE_TARGET_INBOX_FULL`, and `SHARE_TARGET_STORAGE_FAILED`. The page does not automatically receive that error object through `consume()`.
- Do not put incoming payloads in query strings or publish photos automatically. Provide ordinary text input and file selection on unsupported platforms.

Test on a real device: sharing a link, sharing a photo, picker cancellation, receiving one/multiple files, text-only reception, repeated consumption, expiration, offline behavior and authentication. Browser inbox tests do not prove OS menu registration. On a subsequent incoming launch, process the new `layerShareId` even when the page is already open; do not rely solely on the first mount.

Next: [PWA and Service Worker](pwa-service-worker.md), [storage and offline](offline-realtime.md), [incoming links](links-navigation.md), [Layer Auth](layer-auth.md).
