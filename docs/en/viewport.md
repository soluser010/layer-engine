---
title: Viewport, keyboard, and application shell
description: Native-like PWA behavior, search, composer, scroll anchors, and context.viewport.
audience: all
order: 105
status: documented
updated: 2026-10-31
---

# Viewport, keyboard, and application shell

[Capability map](capabilities.md) · [Complete signatures and types](api-reference-runtime.md)

## Goal

Build a PWA as an application: a stable shell, internal scroll regions, visible inputs, and retained positions during keyboard changes. There is no document/app/overlay switch. Visual design and panel layout belong to the application.

## Default behavior

`layer build` adds external `/_layer/viewport.css`, includes it in integrity/precache, and normalizes viewport meta: `width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-visual`. The shell requests a fixed 1× page scale by default. CSS loads before route styles; no inline stylesheet is required.

`html/body` are not the main scroller. `[data-layer-root]` fills the available area, accounts for safe-area, and scrolls itself if the app has not declared an inner scroller. For header/content/composer use grid or flex with `min-height: 0` on the content region. Layer does not create visual panels.

The working area shrinks for the keyboard by default. Browser runtime creates one `layerViewportCreate` per document; components receive separate lifecycle owners. VisualViewport resize/scroll and focus notifications are coalesced through requestAnimationFrame, without polling or full-document rendering.

## Search: preserve size and scroll

```html
<input
    type="search"
    aria-label="Search"
    data-layer-keyboard="preserve"
    data-layer-scroll="preserve"
>
```

Expected result: the shell retains its pre-keyboard height; Layer does not scroll this field additionally. Bottom elements may be covered by the keyboard — this is intentional. Users can still scroll content. Safari may pan the visible area itself: preserve does not prohibit browser-owned behavior.

## Chat: resize the area and retain the composer

Example page `src/pages/chat.layer.js`:

```js
import {css, html, layerComponentCreate, layerSignalCreate} from '@solcorp/layer';

export const styles = css`
    .chat {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        height: 100%;
    }
`;

export default layerComponentCreate(function Chat(){
    //Creating a draft without replacing the active textarea during updates
    const draftSignal = layerSignalCreate( '' );

    //Rendering independently scrollable messages and an ordinary HTML composer
    return html`
        <section class="chat">
            <header>Messages</header>
            <div data-layer-scroll-region="messages">
                <p data-layer-scroll-key="message-1">First message</p>
            </div>
            <footer>
                <textarea aria-label="Message" l-model=${draftSignal}
                    data-layer-keyboard="resize" data-layer-focus="retain"></textarea>
                <button type="button" data-layer-focus-retain>Attachment</button>
            </footer>
        </section>
    `;

});
```

Expected result: keyboard resize reduces the list while keeping the composer visible. `resize` is optional: it is the default. The example button only demonstrates focus retention; add the application's own `@click` handler.

`data-layer-focus="retain"` is not a focus trap. Stable DOM preserves selection; pointerdown on an explicitly marked `data-layer-focus-retain` button does not transfer focus. Other inputs, Tab, intentional blur, and navigation continue working. The keyboard is never forcibly reopened. Replacing a textarea through when/repeat with a different key does not retain its identity.

## Resize only one region

```html
<section data-layer-viewport="chat">
    <textarea
        aria-label="Message"
        data-layer-keyboard="resize"
        data-layer-viewport-target="chat"
    ></textarea>
</section>
```

The root shell retains its size; the selected region receives `--layer-region-height`. Application CSS determines how its children divide that space. A name must resolve to exactly one region inside the app root. Missing/ambiguous declarative targets safely fall back to the root; imperative lookups throw TypeError. Do not use this fallback to hide naming mistakes.

## Context API

The generated browser host provides `context.viewport`; SSR or a manual host without `layer.viewport` receives `null`. Use DOM APIs in `context.onMount`/`onHydrate` or browser event handlers, not server setup.

| Method / field | Purpose and contract |
| --- | --- |
| `state.get()`, `state.peek()` | Component-local read-only signal. get tracks dependencies; peek reads without tracking. |
| `getState()` | Last immutable snapshot without a new layout read. |
| `subscribe(listener)` | Callback only for changed snapshots; returns unsubscribe. No initial callback: read getState. |
| `registerRegion(name, element, kind)` | kind: viewport by default, or scroll. Returns idempotent unregister; owner cleanup is automatic. |
| `ensureVisible(element)` | Minimally scrolls the nearest scroll region; returns whether position changed. Does not scroll during zoom or scroll=preserve. |
| `focus(element)` | focus({preventScroll:true}); returns whether focus was acquired. Does not guarantee opening the on-screen keyboard. |
| `captureAnchor(name, element?)` | Captures Element identity and offset; without element chooses the first visible data-layer-scroll-key. |
| `restoreAnchor(anchor)` | Restores relative position; uses previous coordinates when the item was removed. |
| `dispose()` | Early owner cleanup; repeated calls return false. Component unmount invokes it automatically. |

Region names: ASCII letter followed by letters/digits/underscore/hyphen, at most 64 characters. Elements must be connected and belong to the current app root. Registrations cannot resize foreign documents.

Infrastructure uses the shared `window.layer.viewport` controller. Do not call its dispose from a component: that stops the entire viewport. For manual mounting provide `'layer.viewport': controller` through context; the component creates its owner automatically.

### Scroll anchor example

```js
const messageAnchor = context.viewport.captureAnchor( 'messages' );

//Adding older messages through the application's own state and waiting for its renderer commit
await olderMessagesLoadAndRender();

//Restoring the same visible item after its vertical position changes
context.viewport.restoreAnchor( messageAnchor );
```

`olderMessagesLoadAndRender` is an application function, not a Layer API. Automatic retention during viewport changes does not force chat to the bottom for new messages. Follow-bottom policy belongs to the application. Do not retain anchors after unmount: they contain DOM references.

## Keyboard API

`context.keyboard` is a component-owned API. It is `null` during SSR and in manual hosts without a viewport provider. Infrastructure can use `window.layer.keyboard`. Both share the existing viewport; `resize`, `preserve`, and scroll policies still apply.

| Method | Contract |
| --- | --- |
| `show(field)` | Synchronously requests focus/the keyboard for a DOM input, textarea, or contenteditable. Pass `reference.current`, not the ref wrapper, ID, or selector. |
| `hide()` | Requests dismissal for the active app field and removes focus. Foreign fields are untouched; no automatic refocus. |
| `getState()` | Immutable snapshot: `source`, `visible`, `height`, `rect`, as in `viewport.getState().keyboard`. |
| `subscribe(listener)` | Immediate snapshot, then keyboard changes. Returns unsubscribe; unmount releases the subscription. Listener errors belong to the application. |
| `getCapability()` | `strategy: native/focus`, `nativeControl`, `requiresUserInteraction: true`, `visibilitySource`. A capability does not guarantee opening. |

`show()` and `hide()` return `{status: 'requested' | 'blocked', focused: boolean, reason: string | null}`. `focused` refers to the target field, not the keyboard. `requested` does not mean the keyboard appeared; `visible: null` means unknown. The snapshot updates during viewport measurement, not synchronously after a request.

### Open and dismiss from buttons

```js
import {html, layerComponentCreate, layerReferenceCreate} from '@solcorp/layer';

export default layerComponentCreate(function Composer( _properties, context ){
    //Holding the actual input node without querying the whole document
    const messageReference = layerReferenceCreate();
    const messageFocus = function(){
        //Keeping the focus request inside the user action, before any await or timer
        if ( context.keyboard !== null && messageReference.current !== null ){
            context.keyboard.show( messageReference.current );

        }

    };
    const keyboardDismiss = function(){
        //Requesting dismissal while the retain button leaves the field focused until click
        context.keyboard?.hide();

    };

    //Rendering ordinary fields; no hidden input is created by Layer
    return html`
        <textarea ref=${messageReference} aria-label="Message"
            data-layer-keyboard="resize" data-layer-focus="retain"></textarea>
        <button type="button" @click=${messageFocus}>Write</button>
        <button type="button" data-layer-focus-retain @click=${keyboardDismiss}>Hide keyboard</button>
    `;

});
```

The dismissal button's `data-layer-focus-retain` keeps the field focused until click: otherwise normal button interaction may remove focus before `hide()` runs. Do not call `show()` automatically on mount: Safari may accept focus without opening the keyboard. The field must already be in the DOM during the user action.

### Switch input to search

Give the search field `type="search"`, `enterkeyhint="search"`, `data-layer-keyboard="preserve"`, and optionally `data-layer-scroll="preserve"`. In the button handler, call:

```js
//searchReference is an application ref bound to the existing search input
const requestResult = context.keyboard.show( searchReference.current );
if ( requestResult.status === 'blocked' ){
    //Displaying application-owned feedback without retrying focus in a loop
    searchHint.set( requestResult.reason );

}
```

`searchReference` and `searchHint` are the application's ref and signal. Keyboard layout is described by HTML attributes `type`, `inputmode`, `enterkeyhint`, and `autocomplete`, not `show()` arguments.

### Observe state

```js
//keyboardStatus is an application signal; subscribing at mount keeps SSR side-effect free
context.onMount(function(){
    //The component owner releases this subscription on unmount
    context.keyboard.subscribe(function( state ){
        //Preserving unknown rather than presenting it as a closed keyboard
        keyboardStatus.set( state.visible );

    });

});
```

This example assumes the standard browser host and an application-created `keyboardStatus`. In a manual host, check `context.keyboard !== null`. Save the returned function for early unsubscription. `height` is bottom occlusion, not guaranteed physical keyboard height.

### Limits and failures

Hidden/inert fields return `field-unavailable`; readonly/disabled or unsupported types return `field-not-editable`; `inputmode="none"` returns `inputmode-none`; refused focus returns `focus-refused`. `hide()` without an active editable field returns `no-active-field`, and refused blur returns `blur-refused`. These reasons accompany `status: 'blocked'`. Invalid arguments, detached/foreign elements, or calls after disposal throw `TypeError`.

In Chromium, with HTTPS, available methods, and explicit `virtualkeyboardpolicy="manual"` on the field, Layer also requests native show/hide; otherwise it uses ordinary focus/blur. Do not set manual policy unnecessarily. Layer does not secretly change policy, and native rejection does not cancel the fallback. Safari uses focus and available geometry; unknown visibility is never reported as confirmation. A hardware keyboard may prevent the software keyboard from appearing.

## Snapshot and CSS

A snapshot contains layout and visual (`width`, `height`, `offsetTop`, `offsetLeft`, `scale`), policy, availableHeight, and keyboard (`source`, `visible`, `height`, `rect`). Source is native/estimated/unknown; unknown means visible:null. Rect contains x/y/width/height only for the native API, otherwise null. Height describes bottom occlusion of the working area, not the guaranteed physical height of every keyboard. A floating keyboard can have visible:true and height:0.

Root CSS properties: `--layer-viewport-height`, `--layer-viewport-top`, `--layer-keyboard-height`, `--layer-safe-area-top/right/bottom/left`. Safe-area is already included in root padding: do not apply it again to nested panels. Route CSS can customize the shell. Do not apply `touch-action: none` to the whole app: this disables ordinary touch scrolling. Reserve it for custom interactive surfaces, such as a photo viewer.

## Application scale and photo zoom

Html/body, root, and built-in scroll regions use `touch-action: pan-x pan-y`: ordinary scrolling is allowed, browser pinch zoom is not enabled. `manipulation` is unsuitable here because it permits pinch zoom. The controller also cancels cancellable multi-touch, WebKit gesturestart/gesturechange, and Ctrl-wheel defaults within the app root. Ordinary wheel, one finger, clicks, text selection, and pointer delivery are not consumed; stopPropagation is never called. These listeners are released with the viewport controller, not when each page unmounts.

Photo zoom belongs to the component rather than changing the document scale. Declare a custom local surface before handling gestures:

```html
<section class="PhotoViewer" aria-label="Photo viewer">
    <img class="PhotoViewer__Image" src="/assets/photo.webp" alt="Photo" draggable="false">
</section>
```

```css
/* Giving the photo component its own pointers without native document pan or zoom */
.PhotoViewer {
    width: 100%;
    height: 100%;
    overflow: hidden;
    touch-action: none;
}

/* Scaling only the image; the app shell keeps its original coordinate system */
.PhotoViewer__Image {
    max-width: 100%;
    max-height: 100%;
    transform: scale(var(--photo-scale, 1));
    transform-origin: center;
}
```

The component or its gesture library tracks Pointer Events, measures the distance between two pointers, and sets the image's `--photo-scale` through `element.style.setProperty`. Bounds, pan, reset, and +/- controls belong to the application. Declare touch-action before the gesture starts, not inside pointerdown. Application handlers receive events even when Layer cancels a browser default; defaultPrevented does not mean the component should discard the gesture.

This restricts browser gestures, not every form of magnification. Safari may ignore viewport meta; browser accessibility overrides, menu/keyboard zoom, and OS magnifiers are neither disabled nor forcibly reset. Foreign embedded iframes have separate event boundaries. The existing geometry fallback remains when visual scale is overridden: magnification is not mistaken for keyboard appearance. Restricting page zoom reduces accessibility: provide readable text, responsive layout, and application-level content/text enlargement. [Viewport limitations](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport), [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).

## Browser support and limitations

- Chromium: when VirtualKeyboard is available, Layer acquires overlaysContent and uses native boundingRect; disposal restores the previous value. Do not change overlaysContent concurrently in application code.
- Safari/WebKit: VisualViewport fallback accounts for height, offsets, and scale. Height differences with an active editable field are estimates, not an exact keyboard detector. WebKit gesture cancellation is best effort; forced browser zoom does not shrink the CSS shell.
- Without VisualViewport/VirtualKeyboard: window resize fallback; unknown keyboard state is explicit.
- Rotation/width changes update the baseline; hidden/hardware keyboards need no artificial inset.

References: [VirtualKeyboard](https://developer.chrome.com/docs/web-platform/virtual-keyboard), [VisualViewport](https://www.w3.org/TR/cssom-view/#the-visualviewport-interface), [WebKit interactive-widget](https://bugs.webkit.org/show_bug.cgi?id=259770).

## Focus, scrolling, and iOS behavior

Layer reacts to size and focus changes, but does not pull a field back when only `VisualViewport.offsetTop/offsetLeft` changes: that movement may accompany manual scrolling. A newly focused editable field is revealed even when the snapshot is unchanged. `data-layer-scroll="preserve"` disables automatic revealing. Readonly textareas and disabled fields are not editable targets; attribute changes are observed without another focus event.

When window dimensions change, a nested `data-layer-viewport` is measured again in the shell without keyboard occlusion. Rotation and returning to portrait must not retain an old region height. `ensureVisible` scrolls only the app root or an owned scroll region; an outer host container is untouched. A field taller than the visible area that already covers it is not moved automatically: the browser remains responsible for the caret inside a large textarea.

`context.viewport.focus(element)` requests focus without additional scrolling and returns whether the element received focus. A `true` result does not confirm that the on-screen keyboard opened. Call it directly from a user press handler while the field is already in the DOM; deferring it until after a network request or timer may prevent Safari from opening the keyboard.

Use standard `type`, `inputmode`, `enterkeyhint`, and `autocomplete` attributes to describe the input. They suggest a keyboard layout and input purpose to the browser, but do not give the application full control of the system keyboard. Use `context.keyboard` for unified show/hide requests; the browser determines the resulting keyboard behavior.

Check your application interface both in a Safari tab and after installing it on the Home Screen: the available area and browser controls differ. With a floating iPad keyboard, the exact occluded area may be unknown; do not interpret `keyboard.visible === null` as confirmation that the keyboard is closed.
## Common mistakes and failure contract

- An inner page with height:100vh ignores the bounded app root; use 100% and minmax(0, 1fr).
- Subtracting keyboard height twice: the controller already calculates the available area.
- focus=retain without a marked button does not prohibit blur.
- Detached/foreign elements, invalid/duplicate imperative registrations, and disposed owner calls throw TypeError before DOM mutation.
- Geometry listeners must not throw; application callback error handling belongs to the application.
- SSR does not use browser geometry; hydration binds existing DOM, geometry changes CSS and only dependent signals.
- Rebuild dist when upgrading existing apps: body/window scrolling becomes root/region scrolling. Use your own scroll ref or viewport anchor API for programmatic scrolling.

Next: [Context API](context-api.md), [routing/SSR](routing-ssr.md), [browser support](browser-support.md).
