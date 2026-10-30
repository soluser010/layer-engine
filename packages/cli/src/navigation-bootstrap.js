/**
 * @param {any} browserWindow
 * @param {{scope: string, appKey: string, matchers: string[], timeoutMs?: number, fallback?: (url: string) => void}} configuration
 */
//Function for retaining one app navigation before the larger runtime has loaded
export const layerNavigationBootstrapCreate = function( browserWindow, configuration ){
    //Keeping the parser-blocking bootstrap independent from application modules and browser storage
    const key = Symbol.for('layer.navigation.bootstrap');
    if (browserWindow[key]) {
        return browserWindow[key];

    }
    const document = browserWindow.document;
    const container = browserWindow.navigator.serviceWorker;
    let scopePrefix = configuration.scope;
    if (!scopePrefix.endsWith('/')) {
        scopePrefix += '/';

    }
    const matchers = configuration.matchers.map(function( source ){
        //Using only trusted route regex sources emitted by the existing route compiler
        return new RegExp(source);

    });
    let phase = 'pending';
    let pendingUrl = /** @type {string|null} */ (null);
    let timer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
    let navigation = /** @type {null|((url: string) => Promise<unknown>)} */ (null);

    const timerClear = function(){
        //Releasing a bounded cold-start deadline after handoff or document disposal
        if (timer !== null) {
            browserWindow.clearTimeout(timer);
            timer = null;

        }

    };
    const targetGet = function( /** @type {unknown} */ value ){
        //Validating app ownership before suppressing any browser navigation
        if (typeof value !== 'string' || value.length > 4096 || value.includes('\\') || [...value].some(function( character ){
            //Rejecting controls without placing control characters in an executable regular expression
            const code = character.charCodeAt(0);
            return code < 32 || code === 127;

        })) {
            return null;

        }
        try {
            const url = new URL(value, browserWindow.location.href);
            if (url.origin !== browserWindow.location.origin || !['http:', 'https:'].includes(url.protocol) ||
                url.username !== '' || url.password !== '' ||
                (url.pathname !== configuration.scope && !url.pathname.startsWith(scopePrefix)) ||
                !matchers.some(function( matcher ){
                    //Leaving unrelated files and unknown routes to the platform
                    return matcher.test(url.pathname);

                })) {
                return null;

            }
            //Rejecting invalid UTF-8 before the guarded router decodes dynamic parameters
            decodeURIComponent(url.pathname);
            return url.href;

        } catch (invalidUrl) {
            //Leaving malformed input outside the deferred app-navigation queue
            void invalidUrl;
            return null;

        }

    };
    const fallback = function( /** @type {string} */ url ){
        //Preserving native recovery only when the application never became ready
        if (configuration.fallback) {
            configuration.fallback(url);

        } else {
            browserWindow.location.assign(url);

        }

    };
    const fail = function(){
        //Releasing a failed startup rather than trapping the user's last requested URL indefinitely
        if (phase !== 'pending') {
            return;

        }
        phase = 'failed';
        timerClear();
        document.removeEventListener('click', clickHandle, true);
        const url = pendingUrl;
        pendingUrl = null;
        if (url !== null) {
            fallback(url);

        }

    };
    const open = function( /** @type {string} */ url ){
        //Queueing only the latest intention; neither guards nor history run before readiness
        if (phase === 'pending') {
            pendingUrl = url;
            if (timer === null) {
                timer = browserWindow.setTimeout(fail, configuration.timeoutMs ?? 15000);

            }
            return;

        }
        if (phase === 'ready' && navigation !== null) {
            //Containing a guarded navigation failure without forcing a document reload
            void navigation(url).catch(function( navigationError ){
                //Keeping a failed route inside application error handling, never native fallback
                void navigationError;
                console.warn('Layer incoming navigation failed: LINK_OPEN_FAILED.');

            });

        }

    };
    function clickHandle( /** @type {MouseEvent} */ event ){
        //Preserving explicit targets, modifiers, downloads and application-selected external modes
        if (phase !== 'pending' || event.defaultPrevented || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;

        }
        const target = /** @type {Element|null} */ (event.target);
        let anchor = /** @type {HTMLAnchorElement|null} */ (null);
        if (target !== null && target instanceof browserWindow.Element) {
            //Resolving icon and text descendants to their ordinary HTML anchor
            anchor = /** @type {HTMLAnchorElement|null} */ (target.closest('a[href]'));

        }
        if (anchor === null || !(anchor instanceof browserWindow.HTMLAnchorElement) || anchor.target !== '' ||
            anchor.hasAttribute('download') || !['auto', 'app'].includes(anchor.getAttribute('data-layer-link') ?? 'auto')) {
            return;

        }
        const url = targetGet(anchor.href);
        if (url !== null) {
            event.preventDefault();
            open(url);

        }

    }
    const messageHandle = function( /** @type {MessageEvent} */ event ){
        //Trusting only the worker currently controlling this document, plus the exact app identity
        const data = event.data;
        if (!container?.controller || event.source !== container.controller || !event.ports[0] ||
            !data || typeof data !== 'object' || Array.isArray(data) ||
            data.type !== 'layer-navigation-open' || data.protocol !== 1 || data.appKey !== configuration.appKey ||
            Object.keys(data).some(function( field ){
                //Rejecting forwarded payloads and unknown worker instructions
                return !['type', 'protocol', 'appKey', 'url'].includes(field);

            })) {
            return;

        }
        const url = targetGet(data.url);
        const accepted = url !== null && (phase === 'pending' || phase === 'ready');
        const port = event.ports[0];
        //Acknowledging ownership, not authentication success or completed rendering
        port.postMessage({type: 'layer-navigation-result', protocol: 1, appKey: configuration.appKey,
            url: data.url, accepted});
        port.close();
        if (accepted && url !== null) {
            open(url);

        }

    };
    const pageHide = function( /** @type {PageTransitionEvent} */ event ){
        //Preserving a BFCache document but releasing resources for a real document replacement
        if (!event.persisted) {
            controller.dispose();

        }

    };
    const controller = Object.freeze({
        ready: async function( /** @type {(url: string) => Promise<unknown>} */ navigate ){
            //Transferring the queued route through the existing auth, permissions and preload pipeline
            if (phase !== 'pending' && phase !== 'failed') {
                return;

            }
            phase = 'ready';
            navigation = navigate;
            timerClear();
            document.removeEventListener('click', clickHandle, true);
            const url = pendingUrl;
            pendingUrl = null;
            if (url !== null) {
                await navigation(url);

            }

        },
        fail,
        dispose: function(){
            //Removing only this document's early-navigation ownership
            if (phase === 'disposed') {
                return false;

            }
            phase = 'disposed';
            pendingUrl = null;
            navigation = null;
            timerClear();
            document.removeEventListener('click', clickHandle, true);
            container?.removeEventListener('message', messageHandle);
            browserWindow.removeEventListener('pagehide', pageHide);
            delete browserWindow[key];
            return true;

        }
    });
    //Installing before body parsing; no inline script, application import or storage access is required
    document.addEventListener('click', clickHandle, true);
    container?.addEventListener('message', messageHandle);
    browserWindow.addEventListener('pagehide', pageHide);
    browserWindow[key] = controller;
    return controller;

};
