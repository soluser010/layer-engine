import {LayerRuntimeError} from './runtime-error.js';

/**
 * @param {Document} documentData
 * @param {string} elementName
 * @param {string} textData
 */
function textElementCreate(documentData, elementName, textData) {
    //Creating text-only UI without invoking HTML parsing.
    const elementData = documentData.createElement(elementName);
    elementData.textContent = textData;

    return elementData;

}

/**
 * @param {unknown} errorData
 */
function panelErrorNormalize(errorData) {
    //Reducing runtime failures to stable display-safe fields.
    if (errorData instanceof LayerRuntimeError) {
        return Object.freeze({
            code: errorData.code,
            message: errorData.message
        });

    }

    return Object.freeze({
        code: 'DEVTOOLS_PANEL_FAILED',
        message: 'DevTools data could not be loaded.'
    });

}

/**
 * @param {{
 *     devtools: {
 *         list: () => readonly string[],
 *         snapshot: (snapshotOptions?: {include?: readonly string[], export?: boolean, consent?: boolean}) => Promise<unknown>
 *     },
 *     document?: Document,
 *     exportConfirm?: () => boolean | Promise<boolean>,
 *     exportWrite?: (exportData: string) => void | Promise<void>
 * }} panelOptions
 */
export function layerDevtoolsPanelCreate(panelOptions) {
    const documentData = panelOptions.document ?? globalThis.document;

    if (documentData === undefined || typeof documentData.createElement !== 'function' ||
        typeof panelOptions.devtools?.list !== 'function' || typeof panelOptions.devtools.snapshot !== 'function') {
        throw new TypeError('DevTools panel requires a document and DevTools bridge.');

    }

    const panelElement = documentData.createElement('section');
    panelElement.setAttribute('data-layer-devtools', '');
    panelElement.setAttribute('aria-label', 'Layer DevTools');
    const shadowRoot = panelElement.attachShadow({mode: 'open'});
    const styleElement = documentData.createElement('style');
    styleElement.textContent = ':host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;color:#e8edf2;font:12px/1.45 ui-monospace,monospace}section{width:min(460px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 32px));display:grid;grid-template-rows:auto auto 1fr;overflow:hidden;border:1px solid #344253;border-radius:10px;background:#101820;box-shadow:0 16px 48px #0008}header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #293542}h2{margin:0;font:600 13px/1.2 system-ui,sans-serif}nav{display:flex;gap:6px}button{border:1px solid #425267;border-radius:6px;padding:5px 8px;color:#e8edf2;background:#1b2733;font:600 11px/1 system-ui,sans-serif;cursor:pointer}button:focus-visible{outline:2px solid #79b8ff;outline-offset:2px}p{margin:0;padding:7px 12px;color:#a9b7c6;border-bottom:1px solid #293542;font-family:system-ui,sans-serif}pre{margin:0;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#c9d7e5}';
    const panelSurface = documentData.createElement('section');
    const headerElement = documentData.createElement('header');
    const titleElement = textElementCreate(documentData, 'h2', 'Layer DevTools');
    const navigationElement = documentData.createElement('nav');
    const refreshButton = textElementCreate(documentData, 'button', 'Refresh');
    const exportButton = textElementCreate(documentData, 'button', 'Export');
    const statusElement = textElementCreate(documentData, 'p', 'Ready');
    const outputElement = textElementCreate(documentData, 'pre', '{}');
    let destroyedStatus = false;

    refreshButton.setAttribute('type', 'button');
    exportButton.setAttribute('type', 'button');
    navigationElement.setAttribute('aria-label', 'DevTools actions');
    statusElement.setAttribute('role', 'status');
    outputElement.setAttribute('aria-live', 'polite');
    navigationElement.append(refreshButton, exportButton);
    headerElement.append(titleElement, navigationElement);
    panelSurface.append(headerElement, statusElement, outputElement);
    shadowRoot.append(styleElement, panelSurface);

    async function snapshotRender() {
        if (destroyedStatus) {
            throw new LayerRuntimeError('DEVTOOLS_PANEL_DESTROYED', 'DevTools panel is already destroyed.');

        }

        statusElement.textContent = 'Loading';

        try {
            //Rendering only the already bounded and redacted bridge snapshot.
            const snapshotData = await panelOptions.devtools.snapshot();
            outputElement.textContent = JSON.stringify(snapshotData, null, 4);
            statusElement.textContent = `${panelOptions.devtools.list().length} provider(s)`;

            return snapshotData;

        } catch (snapshotError) {
            const errorData = panelErrorNormalize(snapshotError);
            outputElement.textContent = JSON.stringify(errorData, null, 4);
            statusElement.textContent = errorData.code;

            throw snapshotError;

        }

    }

    async function snapshotExport() {
        if (destroyedStatus) {
            throw new LayerRuntimeError('DEVTOOLS_PANEL_DESTROYED', 'DevTools panel is already destroyed.');

        }

        const consentStatus = await panelOptions.exportConfirm?.() ?? false;

        if (!consentStatus) {
            statusElement.textContent = 'Export cancelled';

            return null;

        }

        //Requesting a separately consented export from the redacting bridge.
        const snapshotData = await panelOptions.devtools.snapshot({
            export: true,
            consent: true
        });
        const exportData = `${JSON.stringify(snapshotData, null, 4)}\n`;
        await panelOptions.exportWrite?.(exportData);
        statusElement.textContent = 'Export ready';

        return exportData;

    }

    refreshButton.addEventListener('click', function devtoolsRefreshHandle() {
        //Refreshing without allowing an unhandled browser promise rejection.
        void snapshotRender().catch(function devtoolsRefreshFailureIgnore() {
            //The bounded failure is already visible inside the panel.

        });

    });
    exportButton.addEventListener('click', function devtoolsExportHandle() {
        //Exporting only after the application-provided confirmation succeeds.
        void snapshotExport().catch(function devtoolsExportFailureHandle(exportError) {
            //Displaying only a stable error code and safe message.
            const errorData = panelErrorNormalize(exportError);
            outputElement.textContent = JSON.stringify(errorData, null, 4);
            statusElement.textContent = errorData.code;

        });

    });

    return Object.freeze({
        element: panelElement,
        mount(/** @type {Element} */ mountTarget) {
            if (destroyedStatus || mountTarget?.ownerDocument !== documentData || typeof mountTarget.append !== 'function') {
                throw new LayerRuntimeError('DEVTOOLS_PANEL_MOUNT_INVALID', 'DevTools panel mount target is invalid.');

            }

            //Mounting the isolated panel only into the explicit application target.
            mountTarget.append(panelElement);

            return panelElement;

        },
        refresh: snapshotRender,
        export: snapshotExport,
        destroy() {
            if (destroyedStatus) {
                return false;

            }

            //Removing the complete isolated surface and rejecting future actions.
            destroyedStatus = true;
            panelElement.remove();

            return true;

        }
    });

}
