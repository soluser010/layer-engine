import {screenWarmupCreate} from './screen-warmup.mjs';
import {screenStylesCreate} from './screen-styles.mjs';

function lifecycleOwnerCreate(report){
    //Track the components attached to one screen, including nested instances.
    const children = new Set();
    let visible = false;
    return {
        add(child){
            //Activate a late child immediately when its parent is already on screen.
            children.add(child);
            if (visible){
                child.activate();

            }

        },
        delete(child){
            //Release the child from future activation notifications.
            children.delete(child);

        },
        show(nextVisible){
            //Switch the whole component tree and isolate failures in individual hooks.
            visible = nextVisible;
            for (const child of children){
                try {
                    if (visible){
                        child.activate();

                    } else {
                        child.deactivate();

                    }

                } catch (error){
                    report(error);

                }

            }

        }
    };

}

function routeStateCreate(data){
    //Notify only components mounted under this route when a new preload result arrives.
    const listeners = new Set();
    return {
        data,
        update(nextData){
            //Publish one coherent route snapshot before the saved screen becomes visible.
            this.data = nextData;
            for (const listener of listeners){
                listener(nextData);

            }

        },
        subscribe(listener){
            //Release the signal bridge when the component leaves memory.
            listeners.add(listener);
            return function(){
                //Drop this component's observer without affecting siblings.
                listeners.delete(listener);

            };

        }
    };

}

// A movable renderer boundary preserves the original HTML hierarchy and direct-child selectors.
function hostCreate(){
    //Keep the same renderer insertion target when moving nodes off screen.
    const detached = document.createDocumentFragment();
    let parent = detached;
    return {
        ownerDocument: document,
        get firstChild(){
            //Expose the currently owned root to the hydration cursor.
            return parent.firstChild;

        },
        contains(node){
            //Check focus ownership against the current outlet.
            return parent.contains(node);

        },
        querySelectorAll(selector){
            //Find scroll positions within this screen before parking it.
            return parent.querySelectorAll(selector);

        },
        insertBefore(node, before){
            //Insert dynamic bindings into whichever container currently owns the screen.
            return parent.insertBefore(node, before);

        },
        removeChild(node){
            //Discard only nodes belonging to this renderer boundary.
            return parent.removeChild(node);

        },
        take(source){
            //Move existing nodes without cloning state or dropping event handlers.
            while (source.firstChild){
                detached.appendChild(source.firstChild);

            }

        },
        remove(){
            //Park the live nodes before releasing their old outlet.
            if (parent !== detached){
                this.take(parent);
                parent = detached;

            }

        },
        attach(target){
            //Replace the outlet only after the destination is ready.
            if (parent !== target){
                this.remove();
                target.replaceChildren(detached);
                parent = target;

            }

        }
    };

}

function stylesheetReady(stylesheet, signal){
    return new Promise(function(resolve, reject){
        //Cancel this navigation's wait independently of other owners of the stylesheet.
        function abort(){
            reject(signal.reason);

        }
        signal.throwIfAborted();
        signal.addEventListener('abort', abort, {once: true});
        stylesheet.ready.then(function(link){
            signal.removeEventListener('abort', abort);
            if (link){
                resolve(link);

            } else {
                reject(new Error('SCREEN_STYLESHEET_FAILED'));

            }

        });

    });

}

export async function beforeOpen(hook, data, controller){
    if (typeof hook !== 'function'){
        return;

    }
    // Abort the hook's own signal as well as the router wait, even if the hook ignores cancellation.
    const {signal} = controller;
    signal.throwIfAborted();
    let abort;
    const cancelled = new Promise(function(_, reject){
        //Connect the navigation signal to a hook that may ignore cancellation.
        abort = function(){
            //Propagate the active cancellation reason to the route.
            return reject(signal.reason);

        };
        signal.addEventListener('abort', abort, {once: true});

    });
    const timeout = setTimeout(function(){
        //Abort the pending hook when its readiness deadline expires.
        return controller.abort(new Error('SCREEN_OPEN_TIMEOUT'));

    }, 15000);
    try {
        await Promise.race([cancelled, hook(Object.freeze({...data, signal}))]);

    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);

    }

}

export function screenNavigationCreate(options){
    const {root, assetGet, layoutGet, application, router, viewport, contextCreate} = options;
    const saved = new Map();
    const styles = screenStylesCreate();
    let active = null;
    let layout = null;
    let owner = null;
    let pending = null;
    let currentUrl = null;
    let securityChannel = null;
    let pageStyle = document.head.querySelector('[data-layer-page-style]');
    let layoutStyle = document.head.querySelector('[data-layer-layout-style]');
    const initialStyles = [];
    for (const link of [layoutStyle, pageStyle]){
        //Adopt parsed SSR styles. Retry a failed document stylesheet through normal route preparation.
        if (link?.sheet){
            initialStyles.push(styles.acquire(new URL(link.href).pathname.slice(1), null, link));

        } else {
            link?.remove();

        }

    }
    let hits = 0;
    let cancellations = 0;
    let duration = 0;
    function routeStylesAcquire(asset){
        //Insert layout rules before page rules to preserve the cascade on the first opening.
        const layoutAsset = asset.layout && layoutGet(asset.layout);
        return {
            layout: layoutAsset ? styles.acquire(layoutAsset.style, 'data-layer-layout-style') : null,
            page: styles.acquire(asset.style, 'data-layer-page-style')
        };

    }
    const warmup = screenWarmupCreate({root, scope: options.scope, resolve: router.resolve, assetGet, routeStylesAcquire,
        occupied: function(path){
            //Skip addresses already active or retained for this identity.
            return active?.path === path || saved.has(keyFor(path, router.resolve(path)?.route.id));

        }});

    function keyFor(path, id){
        //Separate screen instances by security context, build, route and full query.
        return JSON.stringify([options.buildId, owner, id, path]);

    }

    function release(screen){
        //Move the boundary away from the active outlet before disposing its bindings.
        screen?.host.remove();
        screen?.sheets?.page.release();
        screen?.sheets?.layout?.release();
        try {
            screen?.controller.dispose();

        } catch (error){
            report(error);

        }

    }

    function report(error){
        //Keep reporting failures from interrupting screen cleanup.
        try {
            application.onError?.(error);

        } catch {
            console.warn('SCREEN_LIFECYCLE_FAILED');

        }

    }

    function clearScreens(){
        // Release private DOM including the active page before accepting a different identity.
        for (const screen of saved.values()){
            release(screen);

        }
        saved.clear();
        for (const sheet of initialStyles.splice(0)){
            sheet.release();

        }
        active?.lifecycle.show(false);
        layout?.lifecycle.show(false);
        release(active);
        release(layout);
        active = layout = null;
        pageStyle = layoutStyle = null;
        currentUrl = null;
        warmup.clear();

    }

    async function identityKey(identity){
        //Read the application namespace before comparing trusted authorization data.
        let namespace = null;
        if (identity.authenticated && typeof application.storageNamespaceGet === 'function'){
            namespace = await application.storageNamespaceGet();

        }
        const user = identity.user?.id ?? identity.userId ?? identity.id ?? namespace;
        const tenant = identity.tenant?.id ?? identity.tenantId ?? identity.tenant ?? null;
        const key = JSON.stringify([identity.authenticated, namespace, user, tenant, identity.session?.id ?? null,
            [...(identity.permissions ?? [])].sort(), identity.roles ?? [], identity.assurance ?? null]);
        return {key, identifiable: !identity.authenticated || user != null};

    }

    async function visibilityCheck(){
        //Revalidate cached identity when this document returns to the foreground.
        if (document.hidden || !active || owner === null || (!options.managedAuth && !application.identityGet)){
            return;

        }
        const sequence = pending;
        try {
            const fresh = await identityKey(await options.identityGet());
            if (sequence === pending && active && fresh.key !== owner){
                options.invalidate();
                pending?.abort();
                clearScreens();
                owner = null;
                await options.navigate(location.pathname + location.search + location.hash, {history: false});

            }

        } catch (error){
            report(error);

        }

    }

    function begin(){
        //Cancel the previous real navigation before running the next guard.
        pending?.abort();
        pending = new AbortController();
        return pending;

    }

    async function render(preparation, target, controller, started){
        const {signal} = controller;
        const {route, params, preload, identity} = preparation;
        const url = new URL(target, location.href);
        const path = url.pathname + url.search;
        const security = await identityKey(identity);
        signal.throwIfAborted();
        if (owner !== null && owner !== security.key){
            clearScreens();

        }
        owner = security.key;
        const reusable = route.warmup !== 'off' && security.identifiable;
        const key = keyFor(path, route.id);
        let existing = null;
        if (reusable){
            existing = saved.get(key) ?? null;
            if (active?.key === key){
                existing = active;

            }

        }
        const asset = assetGet(route.id);
        let layoutAsset = null;
        if (route.layout !== null){
            layoutAsset = layoutGet(route.layout);

        }
        const compatible = layout !== null && layout.name === route.layout;
        const hydrate = !active && root.getAttribute('data-layer-ssr') === route.id;
        const sheets = routeStylesAcquire(asset);
        let stage = null;
        let nextLayout = null;
        let committed = false;
        const {commit, status, preserveLayout, historyState} = preparation;
        const data = {status, route, params, preload, preserveLayout, historyState};
        try {
            let pageImport = null;
            let layoutImport = null;
            let layoutStylesheet = null;
            let elementPreparation = null;
            if (!existing){
                pageImport = import('/' + asset.component);
                if (reusable && !hydrate){
                    elementPreparation = warmup.prepare(path, asset);

                }

            }
            if (layoutAsset){
                layoutStylesheet = stylesheetReady(sheets.layout, signal);
                if (!compatible){
                    layoutImport = import('/' + layoutAsset.component);

                }

            }
            const [pageModule, layoutModule, nextPageStyle, nextLayoutStyle, props, nodes] = await Promise.all([
                pageImport, layoutImport, stylesheetReady(sheets.page, signal),
                layoutStylesheet, application.props?.(data) ?? {}, elementPreparation
            ]);
            signal.throwIfAborted();
            await beforeOpen(application.onBeforeScreenOpen, {route, params, preload, props, restored: Boolean(existing), url: url.href}, controller);
            signal.throwIfAborted();

            if (typeof application.onBeforeScreenOpen === 'function' && (identity.authenticated || application.identityGet)){
                const latest = await identityKey(await options.identityGet());
                signal.throwIfAborted();
                if (latest.key !== owner){
                    clearScreens();
                    throw new Error('SCREEN_IDENTITY_CHANGED');

                }

            }

            let mountMethod = 'mount';
            if (hydrate){
                mountMethod = 'hydrate';

            }
            let outlet = root;
            if (compatible){
                outlet = layout.outlet;

            } else if (layoutModule){
                const host = hostCreate();
                if (hydrate){
                    host.take(root);

                }
                const lifecycle = lifecycleOwnerCreate(report);
                const routeState = routeStateCreate(data);
                const context = contextCreate(data, routeState, lifecycle);
                const instance = layoutModule[mountMethod](host, {context});
                nextLayout = {host, lifecycle, routeState, controller: instance, name: route.layout};
                const outlets = host.querySelectorAll('[data-layer-layout-outlet]');
                if (outlets.length !== 1){
                    throw new Error('SCREEN_LAYOUT_OUTLET_INVALID');

                }
                nextLayout.outlet = outlet = outlets[0];

            }
            if (!existing){
                const host = hostCreate();
                if (hydrate){
                    host.take(outlet);

                }
                const routeState = routeStateCreate(data);
                const lifecycle = lifecycleOwnerCreate(report);
                const context = contextCreate(data, routeState, lifecycle);
                const instance = pageModule[mountMethod](host, {
                    context, props, onEmit: application.onEmit, warmupNodes: nodes
                });
                stage = {key, path, reusable, host, lifecycle, controller: instance, routeState, x: 0, y: 0, scroll: []};

            } else {
                existing.routeState.update(data);
                await existing.controller.update(props, {replace: true});

            }
            signal.throwIfAborted();
            const result = commit();
            if (result.status !== 'ready'){
                return result;

            }

            if (active && active !== existing){
                active.focus = null;
                if (active.host.contains(document.activeElement)){
                    active.focus = document.activeElement;

                }
                active.x = root.scrollLeft;
                active.y = root.scrollTop;
                active.scroll = Array.from(active.host.querySelectorAll('*'))
                    .filter(function(node){
                        //Keep only scroll positions that need restoration.
                        return node.scrollLeft || node.scrollTop;

                    })
                    .map(function(node){
                        //Capture both axes with the exact element instance.
                        return [node, node.scrollLeft, node.scrollTop];

                    });
                try {
                    active.lifecycle.show(false);

                } catch (error){
                    report(error);

                }
                active.host.remove();
                if (active.reusable){
                    saved.set(active.key, active);

                } else {
                    release(active);

                }

            }
            if (!compatible && (layout || nextLayout || !active)){
                layout?.lifecycle.show(false);
                release(layout);
                layout = nextLayout;
                if (layout){
                    layout.host.attach(root);

                } else {
                    root.replaceChildren();

                }

            }
            if (existing){
                saved.delete(key);
                hits++;

            }
            active = existing ?? stage;
            active.host.attach(outlet);
            //Retain both sheets together, including their cascade order, while the screen is parked.
            active.sheets?.page.release();
            active.sheets?.layout?.release();
            active.sheets = sheets;
            //Switch the parsed media list. Changing link.media can fetch the CSS again in WebKit.
            for (const previousStyle of [layoutStyle, pageStyle]){
                if (previousStyle?.sheet && previousStyle !== nextPageStyle && previousStyle !== nextLayoutStyle){
                    previousStyle.sheet.media.mediaText = 'not all';

                }

            }
            for (const nextStyle of [nextLayoutStyle, nextPageStyle]){
                if (nextStyle && nextStyle.sheet.media.mediaText !== 'all'){
                    nextStyle.sheet.media.mediaText = 'all';

                }

            }
            nextPageStyle.dataset.layerStylePath = asset.style;
            pageStyle = nextPageStyle;
            layoutStyle = nextLayoutStyle;
            for (const sheet of initialStyles.splice(0)){
                sheet.release();

            }
            committed = true;
            currentUrl = url.href;
            warmup.consume(path);
            root.removeAttribute('data-layer-ssr');
            options.metadataApply(route.metadata);
            viewport.resetScroll();
            if (existing){
                root.scrollTo(active.x, active.y);

            } else {
                root.scrollTo(result.historyState.scrollX, result.historyState.scrollY);

            }
            window.scrollTo(result.historyState.scrollX, result.historyState.scrollY);
            for (const [node, x, y] of active.scroll){
                node.scrollLeft = x;
                node.scrollTop = y;

            }
            if (existing?.focus?.isConnected){
                existing.focus.focus({preventScroll: true});

            }
            if (url.hash){
                try {
                    document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();

                } catch (fragmentError){
                    // Invalid percent encoding does not invalidate a committed route.
                    void fragmentError;

                }

            }
            try {
                if (layout){
                    layout.routeState.update(data);

                }
                nextLayout?.lifecycle.show(true);
                active.lifecycle.show(true);

            } catch (error){
                report(error);

            }
            duration = performance.now() - started;
            return result;

        } finally {
            if (!committed){
                controller.abort();
                release(stage);
                release(nextLayout);
                sheets.page.release();
                sheets.layout?.release();

            }

        }

    }

    return {
        begin, render,
        request(target){
            //Claim only a valid internal destination for immediate preparation.
            const url = new URL(target, location.href);
            if (!active || url.origin !== location.origin || url.username || url.password){
                return null;

            }
            const match = router.resolve(url.pathname);
            const path = url.pathname + url.search;
            if (!match || match.route.warmup === 'off' || active?.path === path || saved.has(keyFor(path, match.route.id))){
                return null;

            }
            return warmup.request(path, assetGet(match.route.id));

        },
        start(){
            //Begin observing links after the initial route and startup hooks are ready.
            warmup.start();
            document.addEventListener('visibilitychange', visibilityCheck);
            if (typeof BroadcastChannel === 'function' && !securityChannel){
                securityChannel = new BroadcastChannel('layer.screens.' + options.scope + ':' + options.applicationId);
                securityChannel.onmessage = function(event){
                    //Accept only an invalidation signal from the scoped channel.
                    if (event.data === 'logout'){
                        options.invalidate();
                        pending?.abort();
                        clearScreens();
                        owner = null;

                    }

                };

            }

        },
        notifyLogout(){
            //Tell sibling tabs to release screens from the previous session.
            securityChannel?.postMessage('logout');

        },
        restoreUrl(){
            //Restore the displayed URL if a history traversal failed to open its destination.
            if (currentUrl){
                history.replaceState(history.state, '', currentUrl);

            }

        },
        cancelCount(){
            //Count real transitions superseded by a newer destination.
            cancellations++;

        },
        clear(){
            //Release pending preparations before another security context can reuse the tab.
            pending?.abort();
            clearScreens();
            owner = null;

        },
        dispose(){
            //Release this document’s observers, pending resources and retained references.
            pending?.abort();
            clearScreens();
            warmup.dispose();
            document.removeEventListener('visibilitychange', visibilityCheck);
            securityChannel?.close();
            securityChannel = null;

        },
        snapshot(){
            //Report tab-local counters without exposing routes or private application data.
            return Object.freeze({...warmup.snapshot(), active: Number(Boolean(active)), saved: saved.size,
                hits, cancellations, clickToReadyMs: duration});

        }
    };

}
