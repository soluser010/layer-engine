import {
    batch,
    computed,
    effect,
    layerErrorBoundaryValueCreate,
    layerReferenceCreate,
    layerRepeatValueCreate,
    layerWhenValueCreate,
    signal,
    store
} from '@solcorp/layer-render';

const componentDefinitionSet = new WeakSet();

/**
 * Component-owned viewport client. Use DOM methods after mount or in user handlers.
 * `state.get()` tracks local render dependencies; `peek()` reads without tracking.
 * Registrations and subscriptions are automatically released at component destruction.
 * @typedef {ReturnType<ReturnType<typeof import('@solcorp/layer-runtime').layerViewportCreate>['createOwner']> & {
 *     state: Readonly<{
 *         get: () => import('@solcorp/layer-runtime').LayerViewportState,
 *         peek: () => import('@solcorp/layer-runtime').LayerViewportState
 *     }>
 * }} LayerComponentViewport
 */
/**
 * Component-owned keyboard facade. show(field) must run synchronously in a user handler.
 * A requested result confirms the request, not keyboard visibility; observe getState/subscribe.
 * SSR and manual hosts without a viewport provider receive null.
 * @typedef {LayerComponentViewport['keyboard']} LayerComponentKeyboard
 */
const templateResultSet = new WeakSet();
/**
 * Component-owned navigation and viewer facade. Call open from browser lifecycle or user handlers.
 * The viewer does not prove the remote site loaded; external opening remains user-controlled.
 * @typedef {ReturnType<ReturnType<typeof import('@solcorp/layer-runtime').layerLinksCreate>['createOwner']>} LayerComponentLinks
 */

const operationContractFields = Object.freeze([
    'audit',
    'auth',
    'concurrency',
    'cost',
    'inputSchema',
    'name',
    'offlineReplay',
    'outputSchema',
    'permissions',
    'rateLimitBucket',
    'timeoutMs',
    'transaction',
    'type'
]);

/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, unknown>}
 */
function plainObjectCheck(valueData) {
    if (typeof valueData !== 'object' || valueData === null || Array.isArray(valueData)) {
        return false;

    }

    const valuePrototype = Object.getPrototypeOf(valueData);

    //Accepting only ordinary records and explicit null-prototype metadata.
    return valuePrototype === Object.prototype || valuePrototype === null;

}

/**
 * @param {unknown} valueData
 * @returns {unknown}
 */
function immutableValueCreate(valueData) {
    if (Array.isArray(valueData)) {
        //Copying and freezing every nested list owned by an operation contract.
        return Object.freeze(valueData.map(immutableValueCreate));

    }

    if (plainObjectCheck(valueData)) {
        const immutableRecord = /** @type {Record<string, unknown>} */ ({});

        //Copying own enumerable fields without retaining mutable author references.
        for (const [fieldName, fieldValue] of Object.entries(valueData)) {
            if (fieldName === '__proto__' || fieldName === 'constructor' || fieldName === 'prototype') {
                throw new TypeError('Layer operation metadata contains a blocked property name.');

            }

            immutableRecord[fieldName] = immutableValueCreate(fieldValue);

        }

        return Object.freeze(immutableRecord);

    }

    if (valueData === null || ['boolean', 'number', 'string'].includes(typeof valueData)) {
        return valueData;

    }

    throw new TypeError('Layer operation metadata must contain JSON-compatible values.');

}

/**
 * @param {unknown} contractData
 * @param {Set<string>} operationNames
 */
function operationContractAssert(contractData, operationNames) {
    if (!plainObjectCheck(contractData)) {
        throw new TypeError('Each Layer operation contract must be an object.');

    }

    const contractRecord = /** @type {Record<string, unknown>} */ (contractData);
    const unknownFields = Object.keys(contractRecord).filter(function operationFieldUnknown(fieldName) {
        //Restricting the author contract to metadata understood by server and compiler.
        return !operationContractFields.includes(fieldName);

    });

    if (unknownFields.length > 0) {
        throw new TypeError(`Layer operation contract contains unknown fields: ${unknownFields.join(', ')}.`);

    }

    if (typeof contractRecord.name !== 'string' ||
        !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(contractRecord.name) ||
        contractRecord.name.length > 160) {
        throw new TypeError('Layer operation name must be a dotted lowercase identifier up to 160 characters.');

    }

    if (operationNames.has(contractRecord.name)) {
        throw new TypeError(`Layer operation ${contractRecord.name} is duplicated.`);

    }

    if (!['query', 'command', 'sync'].includes(String(contractRecord.type))) {
        throw new TypeError('Client operation type must be query, command, or sync.');

    }

    if ((!plainObjectCheck(contractRecord.inputSchema) && typeof contractRecord.inputSchema !== 'boolean') ||
        (!plainObjectCheck(contractRecord.outputSchema) && typeof contractRecord.outputSchema !== 'boolean')) {
        throw new TypeError('Layer operation inputSchema and outputSchema must be JSON Schema objects or booleans.');

    }

    operationNames.add(contractRecord.name);

}

/**
 * @typedef {Readonly<{
 *     strings: readonly string[],
 *     values: readonly unknown[]
 * }>} LayerTemplateResult
 *
 * @typedef {'ssr' | 'csr'} LayerPageRenderMode
 * @typedef {'session' | 'none'} LayerPageAuthenticationMode
 * @typedef {'deny' | 'shell' | 'snapshot' | 'local'} LayerPageOfflineMode
 * @typedef {'private' | 'public' | 'no-store'} LayerPageCacheMode
 *
 * @typedef {object} LayerPageMetadata
 * Browser-visible document metadata. Every value is a bounded string validated during build.
 * @property {string} [title] Document title.
 * @property {string} [description] Search and sharing description.
 * @property {string} [robots] Robots directive such as `index,follow`.
 * @property {string} [canonical] HTTPS, HTTP, or root-relative canonical URL.
 * @property {string} [author] Document author.
 * @property {string} [keywords] Comma-separated search keywords.
 * @property {string} [themeColor] Browser theme color.
 * @property {string} [colorScheme] Supported document color schemes.
 * @property {string} [applicationName] Application name exposed to the browser.
 * @property {string} [language] BCP 47 language tag such as `en` or `ru-RU`.
 * @property {'auto' | 'ltr' | 'rtl'} [direction] Document text direction.
 * @property {string} [openGraphTitle] Open Graph title.
 * @property {string} [openGraphDescription] Open Graph description.
 * @property {string} [openGraphType] Open Graph object type.
 * @property {string} [openGraphUrl] HTTPS, HTTP, or root-relative Open Graph URL.
 * @property {string} [openGraphImage] HTTPS, HTTP, or root-relative preview image URL.
 * @property {string} [openGraphImageAlt] Accessible preview image description.
 * @property {string} [openGraphSiteName] Open Graph site name.
 * @property {string} [openGraphLocale] Open Graph locale.
 * @property {'app' | 'player' | 'summary' | 'summary_large_image'} [twitterCard] Twitter card type.
 * @property {string} [twitterTitle] Twitter card title.
 * @property {string} [twitterDescription] Twitter card description.
 * @property {string} [twitterImage] HTTPS, HTTP, or root-relative Twitter image URL.
 * @property {string} [twitterImageAlt] Accessible Twitter image description.
 *
 * @typedef {object} LayerPageConfiguration
 * Static page policy read by the compiler and normalized by the router.
 * @property {LayerPageRenderMode} [render] `ssr` renders HTML then hydrates; `csr` mounts in the browser. Default: `ssr`.
 * @property {string | null} [layout] Lowercase layout name from `src/layouts`, or `null` for no layout. Default: inherited layout or `null`.
 * @property {LayerPageAuthenticationMode} [auth] `session` requires an authenticated session; `none` makes the route public. Default: `session`.
 * @property {readonly string[]} [permissions] Dotted permissions required after authentication. Default: `[]`.
 * @property {readonly string[]} [preload] Dotted query operation names loaded before rendering. Default: `[]`.
 * @property {string | null} [guard] Dotted server-owned route guard name, or `null`. Default: `null`.
 * @property {LayerPageOfflineMode} [offline] `deny`, application `shell`, cached `snapshot`, or fully `local`. Default: `deny`.
 * @property {LayerPageCacheMode} [cache] Browser/proxy cache policy. Default: `private`.
 * @property {LayerPageMetadata} [metadata] Bounded title, SEO, sharing, language, and theme metadata. Default: `{}`.
 */

/**
 * Declares compiler-owned HTML inside a `.layer.js` component.
 * Use native `${...}` interpolation for signals, text, attributes, properties,
 * events, `when`, `repeat`, component calls, and `ErrorBoundary`. Static text is
 * escaped by the renderer; arbitrary HTML strings are not interpreted.
 *
 * @example
 * html`<button @click=${saveHandler}>${titleSignal}</button>`
 *
 * @param {TemplateStringsArray} templateParts Static HTML segments supplied by JavaScript.
 * @param {...unknown} templateValues
 * @returns {LayerTemplateResult} Opaque template data consumed by the compiler and renderer.
 * @throws {TypeError} When called as an ordinary function instead of a tagged template.
 */
export function html(templateParts, ...templateValues) {
    //Checking that the tag was called by the JavaScript template literal runtime.
    if (!Array.isArray(templateParts) || !Array.isArray(templateParts.raw)) {
        throw new TypeError('html must be used as a tagged template.');

    }

    const templateResult = Object.freeze({
        strings: Object.freeze([...templateParts]),
        values: Object.freeze([...templateValues])
    });

    templateResultSet.add(templateResult);

    return templateResult;

}

/**
 * Declares static component CSS. Layer scopes selectors to this component by
 * default. Use `:global(selector)` only for an intentional document/application
 * selector. Runtime `${...}` interpolation is rejected so CSP can remain strict.
 *
 * @example
 * css`.Card { display: grid; } :global(body) { margin: 0; }`
 *
 * @param {TemplateStringsArray} templateParts Static CSS supplied by JavaScript.
 * @param {...unknown} templateValues Must remain empty; CSS interpolation is unsupported.
 * @returns {string} Static stylesheet source compiled during `layer build` or `layer dev`.
 * @throws {TypeError} When the call is not a tagged template or contains interpolation.
 */
export function css(templateParts, ...templateValues) {
    //Rejecting runtime CSS interpolation so the compiler owns the complete stylesheet.
    if (!Array.isArray(templateParts) || !Array.isArray(templateParts.raw) || templateValues.length > 0) {
        throw new TypeError('css must contain one static tagged template.');

    }

    return String(templateParts[0] ?? '');

}

/**
 * Creates an immutable Layer component from a synchronous render function.
 * Properties flow down from the caller; infrastructure is read from `context`;
 * the function must return one `html` template result and must not mutate either input.
 *
 * @example
 * layerComponentCreate(function MessageCard(properties){
 *     return html`<article>${properties.text}</article>`;
 * });
 *
 * @template {Record<string, unknown>} PropertiesData
 * @template {Record<string, unknown>} ContextData
 * @param {(properties: Readonly<PropertiesData>, context: Readonly<ContextData> & {readonly viewport?: LayerComponentViewport | null, readonly keyboard?: LayerComponentKeyboard | null, readonly links?: LayerComponentLinks | null}) => LayerTemplateResult} componentFunction Component render function executed by the Layer runtime.
 * @returns {Readonly<{
 *     render: (properties: Readonly<PropertiesData>, context: Readonly<ContextData> & {readonly viewport?: LayerComponentViewport | null, readonly keyboard?: LayerComponentKeyboard | null, readonly links?: LayerComponentLinks | null}) => LayerTemplateResult
 * }>} Immutable component definition accepted by component invocations and page exports.
 * @throws {TypeError} When `componentFunction` is not a function.
 */
export function layerComponentCreate(componentFunction) {
    if (typeof componentFunction !== 'function') {
    //Checking the author function before creating an executable definition.
        throw new TypeError('Layer component must be a function.');

    }

    //Creating an immutable definition owned by this runtime.
    const componentDefinition = Object.freeze({
        render: componentFunction
    });

    componentDefinitionSet.add(componentDefinition);
    //Recording the definition identity for generated wrappers.

    //CallBack THE OBJECT
    return componentDefinition;

}

/**
 * Checks whether a value is a component definition created by this Layer runtime instance.
 *
 * @param {unknown} componentDefinition Value received at a component boundary.
 * @returns {boolean} `true` only for definitions created by `layerComponentCreate`.
 */
export function layerComponentDefinitionCheck(componentDefinition) {
    //Recognizing only definitions created by this runtime instance.
    return typeof componentDefinition === 'object' && componentDefinition !== null &&
        componentDefinitionSet.has(componentDefinition);

}

/**
 * Checks whether a value is an opaque template result created by this Layer runtime instance.
 *
 * @param {unknown} templateResult Value received at a renderer boundary.
 * @returns {boolean} `true` only for results created by the `html` tag.
 */
export function layerTemplateResultCheck(templateResult) {
    //Recognizing only template results created by this runtime instance.
    return typeof templateResult === 'object' && templateResult !== null &&
        templateResultSet.has(templateResult);

}

/**
 * Isolates setup/render/hydration failures in one compiler-owned child subtree.
 * Both callbacks are lazy and must return `html` templates. The fallback receives
 * only the safe public error shape; event-handler and detached async failures remain
 * owned by their operation boundaries.
 *
 * @param {{content: () => LayerTemplateResult, fallback: (renderError: Readonly<{code: string, message: string, retryable: false}>) => LayerTemplateResult}} boundaryOptions `content` renders the protected subtree; `fallback` renders its safe recovery UI.
 * @returns {Readonly<Record<string, unknown>>} Opaque renderer descriptor for `${ErrorBoundary(...)}`.
 * @throws {TypeError} When content/fallback functions or option fields are invalid.
 */
export function ErrorBoundary( boundaryOptions ){
    //Checking the public options before creating the opaque renderer descriptor
    if (
        !boundaryOptions ||
        typeof boundaryOptions !== String( 'object' ) ||
        typeof boundaryOptions.content !== String( 'function' ) ||
        typeof boundaryOptions.fallback !== String( 'function' ) ||
        Number( Object.keys( boundaryOptions ).length ) !== Number( 2 )
    ){
        //Passing the malformed author contract to the component call site
        throw new TypeError( String( 'ErrorBoundary requires content and fallback functions.' ) );

    }

    //Creating a lazy boundary without evaluating either branch during setup
    return layerErrorBoundaryValueCreate(
        boundaryOptions.content,
        boundaryOptions.fallback,
        layerTemplateResultCheck
    );

}


/**
 * Creates a lazy conditional region that updates only its owned DOM range.
 * Pass a scalar or readable signal as the condition and return `html` from each branch.
 *
 * @param {unknown} conditionValue Scalar condition or readable reactive value.
 * @param {() => LayerTemplateResult} truthyRenderer Lazy template used for a truthy condition.
 * @param {(() => LayerTemplateResult) | null} [falsyRenderer] Optional lazy false branch; default: no nodes.
 * @returns {Readonly<Record<string, unknown>>} Opaque descriptor for `${when(...)}`.
 * @throws {TypeError} When either declared renderer is not a function.
 */
export function when(conditionValue, truthyRenderer, falsyRenderer = null) {
    if (typeof truthyRenderer !== 'function' ||
        (falsyRenderer !== null && typeof falsyRenderer !== 'function')) {
        throw new TypeError('when requires template renderer functions.');

    }

    //Creating a renderer-owned descriptor without evaluating either lazy branch.
    return layerWhenValueCreate(
        conditionValue,
        truthyRenderer,
        falsyRenderer,
        layerTemplateResultCheck
    );

}

/**
 * Creates a keyed list region. Existing DOM nodes are retained when keys remain
 * stable, so keys must be unique and derived from persistent item identity rather
 * than the current array index.
 *
 * @template ItemValue
 * @param {readonly ItemValue[] | {get: () => readonly ItemValue[]}} collectionValue Array or readable signal containing the current items.
 * @param {(itemValue: ItemValue, itemIndex: number) => string | number} keySelector Returns one stable unique key per item.
 * @param {(itemValue: ItemValue, itemIndex: number) => LayerTemplateResult} itemRenderer Returns the lazy `html` template for one item.
 * @returns {Readonly<Record<string, unknown>>} Opaque descriptor for `${repeat(...)}`.
 * @throws {TypeError} When key or item renderer functions are missing; duplicate keys fail during rendering.
 */
export function repeat(collectionValue, keySelector, itemRenderer) {
    if (typeof keySelector !== 'function' || typeof itemRenderer !== 'function') {
        throw new TypeError('repeat requires key and item renderer functions.');

    }

    //Deferring collection reads and item templates to the compiler-owned keyed region.
    return layerRepeatValueCreate(
        collectionValue,
        /** @type {(itemValue: unknown, itemIndex: number) => unknown} */ (keySelector),
        /** @type {(itemValue: unknown, itemIndex: number) => unknown} */ (itemRenderer),
        layerTemplateResultCheck
    );

}

/**
 * Declares static route/page policies for a file in `src/pages`.
 * The compiler reads this exported value without dynamic evaluation and the router
 * applies secure defaults: `ssr`, authenticated `session`, offline `deny`, and
 * private cache. Use `auth: 'none'` explicitly for a public page.
 *
 * @example
 * layerPageCreate({
 *     render: 'ssr',
 *     auth: 'none',
 *     offline: 'shell',
 *     cache: 'public',
 *     metadata: {title: 'Home'}
 * });
 *
 * @param {LayerPageConfiguration} pageData Static route, rendering, access, offline, cache, preload, layout, and document metadata.
 * @returns {Readonly<LayerPageConfiguration>} Isolated immutable top-level metadata consumed during build.
 * @throws {TypeError} When page metadata is not an object; unsupported fields or policies fail route-manifest validation during build.
 * @see docs/ru/routing-ssr.md
 * @see docs/en/routing-ssr.md
 */
export function layerPageCreate(pageData) {
    if (typeof pageData !== 'object' || pageData === null || Array.isArray(pageData)) {
        throw new TypeError('Layer page metadata must be an object.');

    }

    //Copying author metadata before exposing it as an immutable module value.
    return Object.freeze(structuredClone(pageData));

}

/**
 * Declares client-visible operation contracts without handlers or executable metadata.
 * The compiler reads the same static value to generate typed component wrappers.
 * Each entry requires dotted `name`, `query | command | sync` type, and input/output
 * JSON Schemas. Optional auth, permissions, rate limits, transaction, audit, timeout,
 * concurrency, and offline replay metadata must remain static JSON-compatible data.
 *
 * @param {readonly Readonly<Record<string, unknown>>[]} contractList Static operation contracts; never include handlers or secrets.
 * @returns {readonly Readonly<Record<string, unknown>>[]} Deeply isolated contracts used by server registration and generated browser facades.
 * @throws {TypeError} For duplicate names, unknown fields, invalid schemas/types, or executable/non-JSON metadata.
 */
export function layerOperationContractsCreate(contractList) {
    if (!Array.isArray(contractList)) {
        throw new TypeError('Layer operation contracts must be an array.');

    }

    const operationNames = new Set();
    const immutableContracts = contractList.map(function operationContractCreate(contractData) {
        operationContractAssert(contractData, operationNames);

        //Returning an isolated immutable contract safe to share with server registration.
        return /** @type {Readonly<Record<string, unknown>>} */ (immutableValueCreate(contractData));

    });

    return Object.freeze(immutableContracts);

}

/**
 * Runs multiple signal writes as one scheduled reactive commit. Use it when one
 * user action changes several signals that must become visible together.
 *
 * @example
 * layerBatch(function profileUpdate(){
 *     firstNameSignal.set('Ada');
 *     lastNameSignal.set('Lovelace');
 * });
 */
export const layerBatch = batch;

/**
 * Creates a lazy read-only value derived from every signal read by the callback.
 * Read it with `.get()`; dependencies are tracked automatically and the last value
 * is reused until one dependency changes.
 *
 * @example
 * const totalSignal = layerComputedCreate(() => priceSignal.get() * quantitySignal.get());
 */
export const layerComputedCreate = computed;

/**
 * Runs a side effect and re-runs it when a signal read by the callback changes.
 * The callback may return cleanup logic; call the returned disposer when the owner
 * is destroyed. Prefer computed values for state that does not touch the outside world.
 *
 * @example
 * const disposeTitle = layerEffectCreate(() => {
 *     document.title = titleSignal.get();
 * });
 */
export const layerEffectCreate = effect;

/**
 * Creates a writable reactive value. Use `.get()` in templates/computed values,
 * `.set(value)` to replace it, `.update(updater)` for an atomic derived write,
 * `.peek()` for an untracked read, and `.subscribe(listener)` outside rendering.
 *
 * @example
 * const countSignal = layerSignalCreate(0);
 * countSignal.update((countValue) => countValue + 1);
 */
export const layerSignalCreate = signal;

/**
 * Creates a reactive proxy for an ordinary object. Reading one field tracks only
 * that field, while assigning it invalidates the dependent bindings. Store values
 * must be application data rather than DOM nodes or infrastructure objects.
 *
 * @example
 * const profileStore = layerStoreCreate({name: '', pending: false});
 * profileStore.pending = true;
 */
export const layerStoreCreate = store;

/**
 * Creates a sealed `{current}` holder for `ref=${reference}`. The renderer writes
 * the owned DOM element after mount and resets it during unmount; application code
 * should read `current` only after the component has mounted.
 *
 * @example
 * const inputReference = layerReferenceCreate();
 * const viewData = html`<input ref=${inputReference}>`;
 */
export {layerReferenceCreate};
