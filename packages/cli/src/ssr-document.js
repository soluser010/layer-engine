import {Buffer} from 'node:buffer';
import {
    parse,
    parseFragment,
    serialize
} from 'parse5';
import {layerRouteMetadataDocumentCreate} from '@solcorp/layer-router';
import {LayerCliError} from './cli-error.js';

/**
 * @param {Record<string, unknown>} nodeData
 * @param {(elementData: Record<string, unknown>) => boolean} predicateData
 * @param {Record<string, unknown>[]} [resultData]
 */
function elementFindAll(nodeData, predicateData, resultData = []) {
    if (typeof nodeData.tagName === 'string' && predicateData(nodeData)) {
        resultData.push(nodeData);

    }

    if (Array.isArray(nodeData.childNodes)) {
        for (const childNode of nodeData.childNodes) {
            elementFindAll(
                /** @type {Record<string, unknown>} */ (childNode),
                predicateData,
                resultData
            );

        }

    }

    return resultData;

}

/**
 * @param {Record<string, unknown>} elementData
 * @param {string} attributeName
 */
function elementAttributeGet(elementData, attributeName) {
    const attributeList = /** @type {{name: string, value: string}[]} */ (elementData.attrs ?? []);

    return attributeList.find(function elementAttributeFind(attributeData) {
        //Matching parse5 attributes by their normalized HTML name.
        return attributeData.name === attributeName;

    })?.value ?? null;

}

/**
 * @param {Record<string, unknown>} elementData
 * @param {string} attributeName
 * @param {string} attributeValue
 */
function elementAttributeSet(elementData, attributeName, attributeValue) {
    const attributeList = /** @type {{name: string, value: string}[]} */ (elementData.attrs ?? []);
    const existingAttribute = attributeList.find(function elementAttributeFind(attributeData) {
        //Selecting one existing normalized attribute before appending a new field.
        return attributeData.name === attributeName;

    });

    if (existingAttribute === undefined) {
        attributeList.push({
            name: attributeName,
            value: attributeValue
        });
        elementData.attrs = attributeList;

        return;

    }

    existingAttribute.value = attributeValue;

}

/**
 * @param {string} fragmentSource
 * @returns {any}
 */
function fragmentCreate(fragmentSource) {
    //Parsing one trusted renderer fragment without constructing DOM through string concatenation.
    return parseFragment(fragmentSource);

}

/**
 * @param {Record<string, unknown>} parentData
 * @param {Record<string, unknown>[]} childNodes
 */
function childNodesSet(parentData, childNodes) {
    //Replacing one owned child collection before restoring parse5 parent links.
    parentData.childNodes = childNodes;

    for (const childNode of childNodes) {
        childNode.parentNode = parentData;

    }

}

/**
 * @param {string} shellSource
 */
function shellDocumentParse(shellSource) {
    const documentData = /** @type {any} */ (parse(shellSource));
    const htmlNode = elementFindAll(documentData, function htmlElementFind(elementData) {
        //Finding the one document element owned by the application shell.
        return elementData.tagName === 'html';

    })[0];
    const headNode = elementFindAll(documentData, function headElementFind(elementData) {
        //Finding the one head container for metadata and stylesheet projection.
        return elementData.tagName === 'head';

    })[0];
    const rootNodes = elementFindAll(documentData, function layerRootFind(elementData) {
        //Recognizing the application root by presence rather than an author-selected value.
        return elementAttributeGet(elementData, 'data-layer-root') !== null;

    });

    const rootNode = rootNodes[0];

    if (htmlNode === undefined || headNode === undefined || rootNode === undefined || rootNodes.length !== 1) {
        throw new LayerCliError(
            'CLI_BUILD_SSR_SHELL_INVALID',
            'SSR requires one HTML document, head, and data-layer-root element.'
        );

    }

    const titleNode = elementFindAll(headNode, function titleElementFind(elementData) {
        //Selecting the shell title before route metadata replaces its text.
        return elementData.tagName === 'title';

    })[0];

    if (titleNode !== undefined && elementAttributeGet(titleNode, 'data-layer-shell-content') === null) {
        /** @type {string} */
        let titleText;

        if (Array.isArray(titleNode.childNodes)) {
            //Reading only text nodes from the author-owned title element.
            titleText = titleNode.childNodes.map(function titleTextRead(childNode) {
                const childRecord = /** @type {Record<string, unknown>} */ (childNode);

                if (childRecord.nodeName === '#text') {
                    //Keeping text content as the navigation fallback title.
                    return String(childRecord.value ?? '');

                } else {
                    //Ignoring nested markup in the standard document title contract.
                    return '';

                }

            }).join('');

        } else {
            //Keeping an empty fallback when the shell title has no child collection.
            titleText = '';

        }

        elementAttributeSet(titleNode, 'data-layer-shell-content', titleText);

    }

    return {
        document: documentData,
        html: htmlNode,
        head: headNode,
        root: rootNode
    };

}

/**
 * @param {Record<string, unknown>} headNode
 * @param {string} markerName
 * @param {string} styleUrl
 */
function stylesheetApply(headNode, markerName, styleUrl) {
    const styleNode = fragmentCreate(`<link rel="stylesheet" href="${styleUrl}">`).childNodes?.[0];

    if (styleNode === undefined) {
        throw new LayerCliError('CLI_BUILD_SSR_FAILED', 'SSR stylesheet metadata could not be created.');

    }

    const typedStyleNode = /** @type {Record<string, unknown>} */ (styleNode);

    elementAttributeSet(typedStyleNode, markerName, '');
    const headChildren = /** @type {Record<string, unknown>[]} */ (headNode.childNodes ?? []);

    headChildren.push(typedStyleNode);
    typedStyleNode.parentNode = headNode;
    headNode.childNodes = headChildren;

}

/**
 * @param {Record<string, unknown>} htmlNode
 * @param {Record<string, unknown>} headNode
 * @param {Readonly<Record<string, string>>} metadataData
 */
function routeMetadataApply(htmlNode, headNode, metadataData) {
    const metadataDocument = layerRouteMetadataDocumentCreate(metadataData);
    let titleNode = elementFindAll(headNode, function titleElementFind(elementData) {
        //Selecting the existing shell title before creating a missing standard element.
        return elementData.tagName === 'title';

    })[0];

    if (titleNode === undefined) {
        titleNode = /** @type {Record<string, unknown>} */ (fragmentCreate('<title></title>').childNodes?.[0]);
        const headChildren = /** @type {Record<string, unknown>[]} */ (headNode.childNodes ?? []);

        headChildren.push(titleNode);
        titleNode.parentNode = headNode;
        headNode.childNodes = headChildren;

    }

    if (elementAttributeGet(titleNode, 'data-layer-shell-content') === null) {
        elementAttributeSet(titleNode, 'data-layer-shell-content', '');

    }

    if (metadataDocument.title !== null) {
        childNodesSet(titleNode, [{
            nodeName: '#text',
            value: metadataDocument.title,
            parentNode: titleNode
        }]);

    }

    if (metadataDocument.language !== null) {
        elementAttributeSet(htmlNode, 'lang', metadataDocument.language);

    }

    if (metadataDocument.direction !== null) {
        elementAttributeSet(htmlNode, 'dir', metadataDocument.direction);

    }

    for (const entryData of metadataDocument.entries) {
        let metadataNode = elementFindAll(headNode, function metadataElementFind(elementData) {
            //Reusing an author-provided standard metadata element before creating a route-owned node.
            return elementData.tagName === entryData.element &&
                elementAttributeGet(elementData, entryData.identity) === entryData.identityValue;

        })[0];

        if (metadataNode === undefined) {
            metadataNode = /** @type {Record<string, unknown>} */ (
                fragmentCreate(`<${entryData.element}>`).childNodes?.[0]
            );
            const headChildren = /** @type {Record<string, unknown>[]} */ (headNode.childNodes ?? []);

            headChildren.push(metadataNode);
            metadataNode.parentNode = headNode;
            headNode.childNodes = headChildren;

        }

        elementAttributeSet(metadataNode, entryData.identity, entryData.identityValue);
        elementAttributeSet(metadataNode, entryData.value, entryData.valueData);
        elementAttributeSet(metadataNode, 'data-layer-route-metadata', entryData.key);

    }

}

/** @param {Record<string, unknown>} operationData */
function serverQueryHandleCreate(operationData) {
    const snapshotData = Object.freeze({
        data: null,
        pending: false,
        error: null,
        updatedAt: null,
        stale: true,
        status: 'idle',
        source: 'ssr'
    });

    return Object.freeze({
        operation: String(operationData.operation ?? ''),
        snapshot() {
            //Returning deterministic no-data state so components can render declared fallbacks.
            return snapshotData;

        },
        subscribe() {
            //SSR produces one immutable snapshot and owns no live subscription.
            return function serverQuerySubscriptionDispose() {
                //Confirming that no browser subscription resource exists during SSR.
                return false;

            };

        },
        async refresh() {
            //Keeping build-time queries disconnected from external transports.
            return null;

        },
        cancel() {
            //Reporting that no in-flight build-time request existed to cancel.
            return false;

        },
        async cacheUpdate() {
            //Avoiding query-cache mutations while producing a static document.
            return null;

        },
        async cacheInsert() {
            //Avoiding normalized entity insertion during deterministic SSR.
            return null;

        },
        async cacheRemove() {
            //Avoiding normalized entity removal during deterministic SSR.
            return null;

        },
        async settled() {
            //Resolving immediately because the build owns no query transport.
            return null;

        },
        dispose() {
            //Reporting that the immutable build-time handle owns no resources.
            return false;

        }
    });

}

/** @param {Record<string, unknown>} operationData */
function serverCommandHandleCreate(operationData) {
    const snapshotData = Object.freeze({
        pending: false,
        error: null,
        lastResult: null,
        commandId: null,
        state: 'idle'
    });

    return Object.freeze({
        operation: String(operationData.operation ?? ''),
        snapshot() {
            //Returning deterministic command state without executing mutations during a build.
            return snapshotData;

        },
        subscribe() {
            //Returning a no-op disposer for the immutable command snapshot.
            return function serverCommandSubscriptionDispose() {
                //Confirming that no command subscription resource existed.
                return false;

            };

        },
        async execute() {
            //Rejecting mutations so a production build cannot change application state.
            throw new TypeError('Commands cannot execute during build-time SSR.');

        },
        cancel() {
            //Reporting that no build-time command execution existed to cancel.
            return false;

        },
        async settled() {
            //Resolving immediately because no command can start during SSR.
            return null;

        },
        dispose() {
            //Reporting that the immutable command handle owns no resources.
            return false;

        }
    });

}

/**
 * @param {Readonly<Record<string, unknown>>} routeData
 */
function serverComponentContextCreate(routeData) {
    //Providing only deterministic framework capabilities to compiled server renderers.
    const applicationApi = Object.freeze({
        query: serverQueryHandleCreate,
        command: serverCommandHandleCreate,
        async sync() {
            //Rejecting sync transports so builds remain isolated from mutable server state.
            throw new TypeError('Sync operations cannot execute during build-time SSR.');

        }
    });

    return Object.freeze({
        'layer.api': applicationApi,
        'layer.route': Object.freeze({
            route: routeData,
            params: Object.freeze({}),
            preload: Object.freeze({})
        })
    });

}

/**
 * @param {string} moduleSource
 */
async function componentModuleImport(moduleSource) {
    //Removing external source-map references that are invalid inside a data URL module.
    const executableSource = moduleSource.replace(
        /\/\/# sourceMappingURL=[^\r\n]*/gu,
        ''
    );
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(executableSource, 'utf8').toString('base64')}`;

    return import(moduleUrl);

}

/**
 * @param {string} layoutHtml
 * @param {string} pageHtml
 */
function layoutPageCompose(layoutHtml, pageHtml) {
    const layoutFragment = fragmentCreate(layoutHtml);
    const outletNodes = elementFindAll(layoutFragment, function layoutOutletFind(elementData) {
        //Finding the compiler-validated layout outlet in rendered server markup.
        return elementAttributeGet(elementData, 'data-layer-layout-outlet') !== null;

    });

    if (outletNodes.length !== 1) {
        throw new LayerCliError('CLI_BUILD_SSR_FAILED', 'SSR layout must render one data-layer-layout-outlet.');

    }

    const pageFragment = fragmentCreate(pageHtml);

    const outletNode = outletNodes[0];

    if (outletNode === undefined) {
        throw new LayerCliError('CLI_BUILD_SSR_FAILED', 'SSR layout outlet is unavailable.');

    }

    childNodesSet(
        outletNode,
        /** @type {Record<string, unknown>[]} */ (pageFragment.childNodes ?? [])
    );

    return serialize(/** @type {any} */ (layoutFragment));

}

/**
 * @param {object} ssrOptions
 * @param {string} ssrOptions.shellSource
 * @param {readonly Readonly<Record<string, unknown>>[]} ssrOptions.routes
 * @param {readonly Readonly<Record<string, unknown>>[]} ssrOptions.layouts
 * @param {Readonly<Record<string, string>>} ssrOptions.componentArtifacts
 */
export async function layerStaticSsrDocumentsCreate(ssrOptions) {
    const shellDocument = shellDocumentParse(ssrOptions.shellSource);
    const normalizedShellSource = serialize(/** @type {any} */ (shellDocument.document));
    const documentArtifacts = /** @type {Record<string, string>} */ ({
        '_layer/shell.html': normalizedShellSource,
        'index.html': normalizedShellSource
    });
    const layoutByName = new Map(ssrOptions.layouts.map(function layoutRecordMap(layoutData) {
        //Indexing compiler-validated layouts without changing their immutable records.
        return [
            layoutData.name,
            layoutData
        ];

    }));
    const moduleByArtifact = /** @type {Map<string, any>} */ (new Map());

    /** @param {string} artifactName */
    async function artifactModuleGet(artifactName) {
        //Reusing one evaluated module when multiple static routes share its artifact.
        if (moduleByArtifact.has(artifactName)) {
            return moduleByArtifact.get(artifactName);

        }

        const artifactSource = ssrOptions.componentArtifacts[artifactName];

        if (typeof artifactSource !== 'string') {
            throw new LayerCliError('CLI_BUILD_SSR_FAILED', 'SSR component artifact is unavailable.');

        }

        const moduleData = await componentModuleImport(artifactSource);

        moduleByArtifact.set(artifactName, moduleData);

        return moduleData;

    }

    for (const routeData of ssrOptions.routes) {
        if (routeData.render !== 'ssr' || /[:*]/.test(String(routeData.path))) {
            continue;

        }

        try {
            const routeModule = await artifactModuleGet(String(routeData.component));
            const routeResult = routeModule.renderToString({
                context: serverComponentContextCreate(routeData),
                props: {}
            });
            let routeHtml = String(routeResult.html);
            let layoutData = null;

            if (routeData.layout !== null) {
                layoutData = layoutByName.get(routeData.layout) ?? null;

                if (layoutData === null) {
                    throw new LayerCliError('CLI_BUILD_SSR_FAILED', 'SSR route layout is unavailable.');

                }

                const layoutModule = await artifactModuleGet(String(layoutData.component));
                const layoutResult = layoutModule.renderToString({
                    context: serverComponentContextCreate(routeData),
                    props: {}
                });

                routeHtml = layoutPageCompose(String(layoutResult.html), routeHtml);

            }

            const routeDocument = shellDocumentParse(normalizedShellSource);
            const routeFragment = fragmentCreate(routeHtml);

            childNodesSet(
                routeDocument.root,
                /** @type {Record<string, unknown>[]} */ (routeFragment.childNodes ?? [])
            );
            elementAttributeSet(routeDocument.root, 'data-layer-ssr', String(routeData.id));

            if (layoutData !== null) {
                stylesheetApply(routeDocument.head, 'data-layer-layout-style', `/${String(layoutData.style)}`);

            }

            stylesheetApply(routeDocument.head, 'data-layer-page-style', `/${String(routeData.style)}`);
            routeMetadataApply(
                routeDocument.html,
                routeDocument.head,
                /** @type {Readonly<Record<string, string>>} */ (routeData.metadata)
            );

            const routePath = String(routeData.path);
            let documentName;

            if (routePath === '/') {
                //Publishing the root route through the standard deployment document.
                documentName = 'index.html';

            } else {
                //Publishing static nested routes through portable directory indexes.
                documentName = `${routePath.replace(/^\/+|\/+$/g, '')}/index.html`;

            }

            documentArtifacts[documentName] = serialize(/** @type {any} */ (routeDocument.document));

        } catch (renderError) {
            if (renderError instanceof LayerCliError) {
                throw renderError;

            }

            let failureReason = 'The route component could not render on the server.';

            if (renderError instanceof Error) {
                failureReason = renderError.message.slice(0, 300);

            }

            throw new LayerCliError('CLI_BUILD_SSR_FAILED', 'Static SSR failed for a route.', {
                route: routeData.file,
                reason: failureReason
            });

        }

    }

    return Object.freeze(documentArtifacts);

}
