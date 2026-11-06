// Preparing inert route resources within one browser document.
export function screenWarmupCreate({root, resolve, scope, assetGet, occupied, routeStylesAcquire}){
    const prepared = new Map();
    const candidates = new Map();
    const visible = new Set();
    const timers = new Map();
    const queue = new Map();
    const resources = new Map();
    let observer;
    let mutations;
    let running = false;
    let backgroundHits = 0;

    function eligible(anchor){
        //Resolve only visible app-owned links outside lists and nested scrolling regions.
        if (!root.contains(anchor) || anchor.target || anchor.hasAttribute('download') ||
            !['auto', 'app'].includes(anchor.dataset.layerLink ?? 'auto')){
            return null;

        }
        let url;
        try {
            url = new URL(anchor.href, location.href);

        } catch {
            return null;

        }
        if (url.origin !== location.origin || url.username || url.password || !url.pathname.startsWith(scope) ||
            (url.pathname === location.pathname && url.search === location.search)){
            return null;

        }
        const bounds = anchor.getBoundingClientRect();
        if (!bounds.width || !bounds.height || bounds.right <= 0 || bounds.bottom <= 0 ||
            bounds.left >= innerWidth || bounds.top >= innerHeight || getComputedStyle(anchor).visibility !== 'visible'){
            return null;

        }
        for (let parent = anchor; parent; parent = parent.parentElement){
            if (parent.matches('ul,ol,select,option,[role="list"],[role="listbox"],[role="option"]')){
                return null;

            }
            if (parent !== root && parent !== document.body && parent !== document.documentElement &&
                parent.scrollHeight > parent.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)){
                return null;

            }

        }
        const match = resolve(url.pathname);
        if (match?.route.warmup !== 'auto'){
            return null;

        }
        return {path: url.pathname + url.search, asset: assetGet(match.route.id)};

    }

    function modulePrepare(path){
        //Share the module hint across destinations without executing application code.
        if (resources.has(path)){
            return resources.get(path).promise;

        }
        const link = document.createElement('link');
        link.rel = 'modulepreload';
        link.href = '/' + path;
        let finish;
        const promise = new Promise(function(resolve){
            //Keep the resolver so cancellation also completes a queued hint.
            finish = resolve;

        });
        const timeout = setTimeout(function(){
            //Release a stalled hint so it cannot occupy the background queue indefinitely.
            return finish(false);

        }, 10000);
        link.onload = function(){
            //Mark the resource ready and release pending listeners.
            return finish(true);

        };
        link.onerror = function(){
            //Release the failed resource so a real navigation can retry.
            return finish(false);

        };
        const record = {link, finish, promise};
        resources.set(path, record);
        document.head.append(link);
        void promise.then(function(success){
            //Release resource listeners and allow another attempt after failure.
            clearTimeout(timeout);
            link.onload = link.onerror = null;
            link.remove();
            if (!success && resources.get(path) === record){
                resources.delete(path);

            }

        });
        return promise;

    }

    function prepare(path, asset, background = false, loadResources = background){
        if (prepared.has(path)){
            const existing = prepared.get(path);
            if (!background && existing.background){
                backgroundHits++;

            }
            if (background){
                return existing.promise;

            }
            return Promise.resolve(existing.nodes);

        }
        const nodes = new Map();
        for (const [identifier, tag, parentId] of asset.skeleton ?? []){
            // Compiler emits only inert native elements, without bindings or attributes.
            const element = document.createElement(tag);
            nodes.get(parentId)?.appendChild(element);
            nodes.set(identifier, element);

        }
        const record = {nodes, background, ready: false, promise: Promise.resolve(nodes), dispose: null};
        prepared.set(path, record);
        if (loadResources){
            const sheets = routeStylesAcquire(asset);
            let cancelWait;
            const cancelled = new Promise(resolve => { cancelWait = resolve; });
            const timeout = setTimeout(() => discard(path, record), 10000);
            record.dispose = function(){
                //Release only this address's interest; an actual navigation keeps its own lease.
                clearTimeout(timeout);
                cancelWait(null);
                sheets.page.release();
                sheets.layout?.release();

            };
            const loaded = Promise.all([modulePrepare(asset.component), sheets.page.ready, sheets.layout?.ready ?? true]);
            record.promise = Promise.race([loaded, cancelled]).then(function(results){
                clearTimeout(timeout);
                if (results?.every(Boolean)){
                    record.ready = true;

                } else {
                    discard(path, record);

                }
                return nodes;

            });

        } else {
            record.ready = true;

        }
        return record.promise;

    }

    function discard(path, record){
        //A late cancellation must not release a newer preparation for the same URL.
        if (record && prepared.get(path) === record){
            prepared.delete(path);
            record.dispose?.();

        }

    }

    async function drain(){
        //Process one eligible visible destination at a time while the document is in the foreground.
        if (running || document.hidden){
            return;

        }
        running = true;
        try {
            for (const [path, anchor] of queue){
                if (document.hidden){
                    break;

                }
                queue.delete(path);
                const target = eligible(anchor);
                if (visible.has(anchor) && target?.path === path && !occupied(path)){
                    await prepare(path, target.asset, true);

                }

            }

        } finally {
            running = false;

        }

    }

    function forget(anchor){
        //Discard the visibility timer and queued references to a departing anchor.
        clearTimeout(timers.get(anchor));
        timers.delete(anchor);
        visible.delete(anchor);
        for (const [path, queued] of queue){
            if (queued === anchor){
                queue.delete(path);

            }

        }

    }

    function schedule(anchor){
        //Require a continuous visibility interval before admitting an anchor to the queue.
        if (document.hidden || timers.has(anchor)){
            return;

        }
        timers.set(anchor, setTimeout(function(){
            //Recheck visibility and ownership when the dwell interval expires.
            timers.delete(anchor);
            const target = eligible(anchor);
            if (target && visible.has(anchor) && !occupied(target.path) && !prepared.has(target.path)){
                queue.set(target.path, anchor);
                void drain();

            }

        }, 250));

    }

    function observeAnchor(anchor){
        //Restart the dwell interval when a partial render changes the destination or link policy.
        if (candidates.has(anchor)){
            forget(anchor);
            observer.unobserve(anchor);
            candidates.delete(anchor);

        }
        if (anchor.matches('a[href]') && root.contains(anchor)){
            candidates.set(anchor, anchor.href);
            observer.observe(anchor);

        }

    }

    function collectAnchors(node, anchors){
        //Inspect only changed subtrees, so a text update in one chat does not rescan the page.
        if (node.nodeType !== 1){
            return;

        }
        if (node.matches('a')){
            anchors.add(node);

        }
        for (const anchor of node.querySelectorAll('a[href]')){
            anchors.add(anchor);

        }

    }

    function changedLinksObserve(records){
        //Deduplicate links that moved or changed several times within one mutation delivery.
        const anchors = new Set();
        for (const record of records){
            if (record.type === 'attributes'){
                collectAnchors(record.target, anchors);

            } else {
                for (const node of record.removedNodes){
                    collectAnchors(node, anchors);

                }
                for (const node of record.addedNodes){
                    collectAnchors(node, anchors);

                }

            }

        }
        for (const anchor of anchors){
            observeAnchor(anchor);

        }

    }

    function visibilityChange(){
        //Discard elapsed background time and re-arm visible links on return.
        if (document.hidden){
            for (const timer of timers.values()){
                clearTimeout(timer);

            }
            timers.clear();
            queue.clear();

        } else {
            for (const anchor of visible){
                schedule(anchor);

            }

        }

    }

    function clear(){
        //Release pending preparations before another security context can reuse the tab.
        for (const record of resources.values()){
            record.finish(false);
            record.link.remove();

        }
        resources.clear();
        for (const [path, record] of prepared){
            discard(path, record);

        }
        queue.clear();
        for (const timer of timers.values()){
            clearTimeout(timer);

        }
        timers.clear();

    }

    return {
        prepare,
        request(path, asset){
            //Claim only a valid internal destination for immediate preparation.
            if (prepared.has(path)){
                return null;

            }
            prepare(path, asset, false, true);
            const record = prepared.get(path);
            return function(){
                //Discard only the preparation owned by this navigation.
                discard(path, record);

            };

        },
        consume(path){
            //Remove the prepared element pool after the real screen takes ownership.
            discard(path, prepared.get(path));

        },
        clear,
        start(){
            //Begin observing links after the initial route and startup hooks are ready.
            if (observer || typeof IntersectionObserver !== 'function'){
                return;

            }
            observer = new IntersectionObserver(function(entries){
                //Start or reset the dwell period for changed intersections.
                for (const entry of entries){
                    if (entry.isIntersecting && entry.intersectionRatio > 0 && root.contains(entry.target)){
                        visible.add(entry.target);
                        schedule(entry.target);

                    } else {
                        forget(entry.target);

                    }

                }

            });
            mutations = new MutationObserver(changedLinksObserve);
            mutations.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'target', 'download', 'data-layer-link', 'role']});
            document.addEventListener('visibilitychange', visibilityChange);
            for (const anchor of root.querySelectorAll('a[href]')){
                observeAnchor(anchor);

            }

        },
        snapshot(){
            //Report tab-local counters without exposing routes or private application data.
            return {enabled: true, prepared: [...prepared.values()].filter(function(record){
                //Count prepared pools after their resources have settled.
                return record.ready;

            }).length,
                unopened: [...prepared.values()].filter(function(record){
                    //Count completed background preparations that have never been opened.
                    return record.ready && record.background;

                }).length,
                queued: queue.size, backgroundHits};

        },
        dispose(){
            //Release this document’s observers, pending resources and retained references.
            clear();
            observer?.disconnect();
            mutations?.disconnect();
            candidates.clear();
            visible.clear();
            document.removeEventListener('visibilitychange', visibilityChange);

        }
    };

}
