import {LayerRuntimeError} from './runtime-error.js';

const operationNamePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const queryCachePolicySet = new Set([
    'cache-and-network',
    'cache-first',
    'network-only',
    'no-store'
]);
const queryOfflineFallbackSet = new Set([
    'cache',
    'reject'
]);
const commandOfflineStrategySet = new Set([
    'outbox',
    'reject'
]);

/**
 * @typedef {Readonly<{
 *     data: unknown,
 *     pending: boolean,
 *     error: unknown,
 *     updatedAt: number | null,
 *     stale: boolean,
 *     status: 'loading' | 'success' | 'stale' | 'error',
 *     source: 'cache' | 'network' | 'local' | null
 * }>} LayerQuerySnapshot
 * @typedef {Readonly<{
 *     pending: boolean,
 *     error: unknown,
 *     lastResult: unknown,
 *     commandId: string | null,
 *     state: string
 * }>} LayerCommandSnapshot
 * @typedef {Readonly<{
 *     operation: string,
 *     payload: Record<string, unknown> | (() => Record<string, unknown>),
 *     cache?: Readonly<{
 *         policy?: 'cache-and-network' | 'cache-first' | 'network-only' | 'no-store',
 *         maxAgeMs?: number,
 *         key?: string
 *     }>,
 *     offline?: Readonly<{fallback?: 'cache' | 'reject'}>,
 *     timeoutMs?: number
 * }>} LayerApplicationQueryOptions
 * @typedef {Readonly<{
 *     update: (selectorData: string, updateHandle: (currentData: unknown) => unknown) => Promise<number>,
 *     insert: (selectorData: string, insertedValue: unknown) => Promise<number>,
 *     remove: (selectorData: string, predicateHandle: (itemData: unknown) => boolean) => Promise<number>,
 *     removeByCommandId: (commandIdentifier: string) => Promise<number>
 * }>} LayerApplicationQueryCache
 * @typedef {Readonly<{
 *     operation: string,
 *     offline?: Readonly<{strategy?: 'outbox' | 'reject'}>,
 *     conflictDomain?: string,
 *     optimistic?: Readonly<{
 *         apply?: (
 *             commandPayload: Readonly<Record<string, unknown>>,
 *             queryCache: LayerApplicationQueryCache
 *         ) => unknown | Promise<unknown>,
 *         rollback?: (
 *             commandError: unknown,
 *             queryCache: LayerApplicationQueryCache,
 *             optimisticToken: unknown
 *         ) => void | Promise<void>
 *     }>
 * }>} LayerApplicationCommandOptions
 * @typedef {Readonly<{
 *     baseRevision?: number,
 *     conflictDomain?: string,
 *     optimisticPatch?: Record<string, unknown> | null
 * }>} LayerApplicationCommandExecutionOptions
 */

/**
 * @param {unknown} valueData
 * @param {Set<object>} ancestorSet
 * @returns {unknown}
 */
function cacheIdentityValueCreate(valueData, ancestorSet) {
    //Keeping scalar JSON values unchanged while rejecting ambiguous numbers.
    if (valueData === null || typeof valueData === 'string' || typeof valueData === 'boolean') {
        return valueData;

    }

    if (typeof valueData === 'number') {
        if (!Number.isFinite(valueData)) {
            throw new TypeError('Layer query payload contains a non-finite cache identity value.');

        }

        return valueData;

    }

    //Rejecting values that cannot have one stable JSON cache identity.
    if (typeof valueData !== 'object' || valueData === null) {
        throw new TypeError('Layer query payload contains an unsupported cache identity value.');

    }

    if (ancestorSet.has(valueData)) {
        throw new TypeError('Layer query payload cache identity cannot contain a cycle.');

    }

    ancestorSet.add(valueData);

    try {
        if (Array.isArray(valueData)) {
            //Preserving array order because it is part of the operation input.
            return valueData.map(function cacheIdentityArrayValueCreate(childValue) {
                //Normalizing one ordered child without changing its array position.
                return cacheIdentityValueCreate(childValue, ancestorSet);

            });

        }

        const valuePrototype = Object.getPrototypeOf(valueData);

        if (valuePrototype !== Object.prototype && valuePrototype !== null) {
            throw new TypeError('Layer query payload cache identity accepts only plain objects.');

        }

        const normalizedRecord = /** @type {Record<string, unknown>} */ ({});

        //Sorting object fields so equivalent payloads share one cache record.
        for (const propertyName of Object.keys(valueData).sort()) {
            normalizedRecord[propertyName] = cacheIdentityValueCreate(
                /** @type {Record<string, unknown>} */ (valueData)[propertyName],
                ancestorSet
            );

        }

        return normalizedRecord;

    } finally {
        ancestorSet.delete(valueData);

    }

}

/**
 * @param {string} operationName
 * @param {Record<string, unknown>} payloadData
 * @param {string | undefined} explicitKey
 */
function queryCacheKeyCreate(operationName, payloadData, explicitKey) {
    let cacheIdentity;

    if (explicitKey !== undefined) {
        if (typeof explicitKey !== 'string' || explicitKey.length < 1 || explicitKey.length > 320) {
            throw new TypeError('Layer query cache key is invalid.');

        }

        cacheIdentity = explicitKey;

    } else {
        const normalizedPayload = cacheIdentityValueCreate(payloadData, new Set());
        cacheIdentity = JSON.stringify(normalizedPayload);

    }

    const cacheKey = `layer.query:${operationName}:${cacheIdentity}`;

    //Requiring an explicit bounded key instead of using a collision-prone short hash.
    if (cacheKey.length > 512) {
        throw new TypeError('Layer query cache identity is too large; declare cache.key.');

    }

    return cacheKey;

}

/**
 * @param {unknown} payloadSource
 */
function queryPayloadRead(payloadSource) {
    let payloadData = payloadSource;

    //Resolving a reactive payload only when this query starts a request cycle.
    if (typeof payloadSource === 'function') {
        payloadData = payloadSource();

    }

    if (typeof payloadData !== 'object' || payloadData === null || Array.isArray(payloadData)) {
        throw new TypeError('Layer query payload must resolve to an object.');

    }

    return /** @type {Record<string, unknown>} */ (structuredClone(payloadData));

}

/**
 * @param {unknown} queryOptions
 */
function queryOptionsNormalize(queryOptions) {
    if (typeof queryOptions !== 'object' || queryOptions === null || Array.isArray(queryOptions)) {
        throw new TypeError('Layer query options are invalid.');

    }

    const queryRecord = /** @type {Record<string, any>} */ (queryOptions);
    const allowedFields = new Set([
        'operation',
        'payload',
        'cache',
        'offline',
        'timeoutMs'
    ]);

    if (Object.keys(queryRecord).some(function queryOptionFieldCheck(fieldName) {
        //Rejecting fields outside the public query definition.
        return !allowedFields.has(fieldName);

    }) || typeof queryRecord.operation !== 'string' || !operationNamePattern.test(queryRecord.operation) ||
        (typeof queryRecord.payload !== 'object' && typeof queryRecord.payload !== 'function') ||
        queryRecord.payload === null || Array.isArray(queryRecord.payload)) {
        throw new TypeError('Layer query options are invalid.');

    }

    const cacheData = queryRecord.cache ?? {};
    const offlineData = queryRecord.offline ?? {};

    if (typeof cacheData !== 'object' || cacheData === null || Array.isArray(cacheData) ||
        typeof offlineData !== 'object' || offlineData === null || Array.isArray(offlineData)) {
        throw new TypeError('Layer query cache or offline options are invalid.');

    }

    const cacheRecord = /** @type {Record<string, any>} */ (cacheData);
    const offlineRecord = /** @type {Record<string, any>} */ (offlineData);
    const cacheAllowedFields = new Set(['policy', 'maxAgeMs', 'key']);
    const offlineAllowedFields = new Set(['fallback']);
    const cachePolicy = cacheRecord.policy ?? 'cache-and-network';
    const maximumAgeMs = cacheRecord.maxAgeMs ?? 30000;
    const offlineFallback = offlineRecord.fallback ?? 'cache';

    if (Object.keys(cacheRecord).some(function queryCacheFieldCheck(fieldName) {
        //Rejecting fields outside the query cache policy.
        return !cacheAllowedFields.has(fieldName);

    }) || Object.keys(offlineRecord).some(function queryOfflineFieldCheck(fieldName) {
        //Rejecting fields outside the query offline policy.
        return !offlineAllowedFields.has(fieldName);

    }) || !queryCachePolicySet.has(cachePolicy) ||
        !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0 || maximumAgeMs > 86400000 ||
        !queryOfflineFallbackSet.has(offlineFallback) ||
        (queryRecord.timeoutMs !== undefined &&
            (!Number.isSafeInteger(queryRecord.timeoutMs) || queryRecord.timeoutMs < 100 ||
                queryRecord.timeoutMs > 120000))) {
        throw new TypeError('Layer query cache or offline options are invalid.');

    }

    return Object.freeze({
        operation: queryRecord.operation,
        payload: queryRecord.payload,
        cache: Object.freeze({
            policy: cachePolicy,
            maxAgeMs: maximumAgeMs,
            key: cacheRecord.key
        }),
        offline: Object.freeze({
            fallback: offlineFallback
        }),
        timeoutMs: queryRecord.timeoutMs
    });

}

/**
 * @param {unknown} commandOptions
 */
function commandOptionsNormalize(commandOptions) {
    if (typeof commandOptions !== 'object' || commandOptions === null || Array.isArray(commandOptions)) {
        throw new TypeError('Layer command options are invalid.');

    }

    const commandRecord = /** @type {Record<string, any>} */ (commandOptions);
    const allowedFields = new Set([
        'operation',
        'offline',
        'conflictDomain',
        'optimistic'
    ]);
    const offlineData = commandRecord.offline ?? {};
    const optimisticData = commandRecord.optimistic ?? {};

    if (Object.keys(commandRecord).some(function commandOptionFieldCheck(fieldName) {
        //Rejecting fields outside the public command definition.
        return !allowedFields.has(fieldName);

    }) || typeof commandRecord.operation !== 'string' || !operationNamePattern.test(commandRecord.operation) ||
        typeof offlineData !== 'object' || offlineData === null || Array.isArray(offlineData) ||
        typeof optimisticData !== 'object' || optimisticData === null || Array.isArray(optimisticData)) {
        throw new TypeError('Layer command options are invalid.');

    }

    const offlineRecord = /** @type {Record<string, any>} */ (offlineData);
    const optimisticRecord = /** @type {Record<string, any>} */ (optimisticData);
    const offlineAllowedFields = new Set(['strategy']);
    const optimisticAllowedFields = new Set(['apply', 'rollback']);
    const offlineStrategy = offlineRecord.strategy ?? 'outbox';

    if (Object.keys(offlineRecord).some(function commandOfflineFieldCheck(fieldName) {
        //Rejecting fields outside the command offline policy.
        return !offlineAllowedFields.has(fieldName);

    }) || Object.keys(optimisticRecord).some(function commandOptimisticFieldCheck(fieldName) {
        //Rejecting fields outside the command optimistic policy.
        return !optimisticAllowedFields.has(fieldName);

    }) || !commandOfflineStrategySet.has(offlineStrategy) ||
        (commandRecord.conflictDomain !== undefined &&
            (typeof commandRecord.conflictDomain !== 'string' || commandRecord.conflictDomain.length < 1 ||
                commandRecord.conflictDomain.length > 240)) ||
        (optimisticRecord.apply !== undefined && typeof optimisticRecord.apply !== 'function') ||
        (optimisticRecord.rollback !== undefined && typeof optimisticRecord.rollback !== 'function')) {
        throw new TypeError('Layer command offline or optimistic options are invalid.');

    }

    return Object.freeze({
        operation: commandRecord.operation,
        offline: Object.freeze({
            strategy: offlineStrategy
        }),
        conflictDomain: commandRecord.conflictDomain,
        optimistic: Object.freeze({
            apply: optimisticRecord.apply,
            rollback: optimisticRecord.rollback
        })
    });

}

/**
 * @param {unknown} dataValue
 * @param {unknown} insertedValue
 */
function queryCollectionInsert(dataValue, insertedValue) {
    if (Array.isArray(dataValue)) {
        return [
            ...dataValue,
            structuredClone(insertedValue)
        ];

    }

    if (typeof dataValue === 'object' && dataValue !== null &&
        Array.isArray(/** @type {Record<string, any>} */ (dataValue).items)) {
        return {
            ...structuredClone(/** @type {Record<string, unknown>} */ (dataValue)),
            items: [
                ...structuredClone(/** @type {Record<string, any>} */ (dataValue).items),
                structuredClone(insertedValue)
            ]
        };

    }

    throw new TypeError('Layer query cache insert requires an array or an object with items.');

}

/**
 * @param {unknown} dataValue
 * @param {(itemData: unknown) => boolean} predicateHandle
 */
function queryCollectionRemove(dataValue, predicateHandle) {
    if (Array.isArray(dataValue)) {
        return dataValue.filter(function queryCollectionItemKeep(itemData) {
            //Keeping only collection values not selected for removal.
            return predicateHandle(itemData) !== true;

        });

    }

    if (typeof dataValue === 'object' && dataValue !== null &&
        Array.isArray(/** @type {Record<string, any>} */ (dataValue).items)) {
        return {
            ...structuredClone(/** @type {Record<string, unknown>} */ (dataValue)),
            items: /** @type {Record<string, any>} */ (dataValue).items.filter(
                function queryCollectionItemKeep(/** @type {unknown} */ itemData) {
                    //Keeping only nested item values not selected for removal.
                    return predicateHandle(itemData) !== true;

                }
            )
        };

    }

    throw new TypeError('Layer query cache remove requires an array or an object with items.');

}

/**
 * @param {unknown} errorData
 */
function queryCacheFallbackCheck(errorData) {
    //Checking whether the failure is safe for stale cache recovery.
    if (!(errorData instanceof LayerRuntimeError)) {
        return false;

    }

    //Allowing stale data only for failures that can recover without changing authorization.
    return errorData.retryable === true || [
        'API_ABORTED',
        'API_NETWORK_FAILED',
        'API_TIMEOUT'
    ].includes(errorData.code);

}

/**
 * @param {object} runtimeOptions
 * @param {(operationName: string, payloadData: Record<string, unknown>, queryOptions?: {signal?: AbortSignal, timeoutMs?: number}) => Promise<Readonly<Record<string, any>>>} runtimeOptions.queryRequest
 * @param {(operationName: string, payloadData: Record<string, unknown>, commandOptions: Record<string, unknown>) => Promise<Readonly<Record<string, any>>>} runtimeOptions.commandRun
 * @param {(operationName: string, payloadData: Record<string, unknown>, commandOptions: {baseRevision: number}) => Promise<Readonly<Record<string, any>>>} [runtimeOptions.commandOnlineRun]
 * @param {(operationName: string, payloadData: Record<string, unknown>, syncOptions?: Record<string, unknown>) => Promise<Readonly<Record<string, any>>>} runtimeOptions.syncRun
 * @param {(cacheKey: string, timeData?: number) => Promise<Readonly<Record<string, any>>>} runtimeOptions.queryCacheGet
 * @param {(cacheKey: string, cacheData: unknown, cacheOptions: {revision?: number | null, expiresAt: number}) => Promise<void>} runtimeOptions.queryCachePut
 * @param {() => boolean} [runtimeOptions.onlineGet]
 * @param {() => number} [runtimeOptions.timeGet]
 * @param {(failureData: Readonly<{stage: string, error: unknown}>) => void} [runtimeOptions.failureHandle]
 */
export function layerApplicationApiCreate(runtimeOptions) {
    if (typeof runtimeOptions !== 'object' || runtimeOptions === null ||
        typeof runtimeOptions.queryRequest !== 'function' || typeof runtimeOptions.commandRun !== 'function' ||
        (runtimeOptions.commandOnlineRun !== undefined && typeof runtimeOptions.commandOnlineRun !== 'function') ||
        typeof runtimeOptions.syncRun !== 'function' || typeof runtimeOptions.queryCacheGet !== 'function' ||
        typeof runtimeOptions.queryCachePut !== 'function' ||
        (runtimeOptions.onlineGet !== undefined && typeof runtimeOptions.onlineGet !== 'function') ||
        (runtimeOptions.timeGet !== undefined && typeof runtimeOptions.timeGet !== 'function') ||
        (runtimeOptions.failureHandle !== undefined && typeof runtimeOptions.failureHandle !== 'function')) {
        throw new TypeError('Layer application API integrations are invalid.');

    }

    const onlineGet = runtimeOptions.onlineGet ?? function applicationOnlineRead() {
        //Reporting the default online state when the host does not provide one.
        return true;

    };
    const timeGet = runtimeOptions.timeGet ?? Date.now;
    const activeQueryHandles = new Set();
    const activeCommandControllers = new Set();

    function failureReport(/** @type {string} */ stageData, /** @type {unknown} */ errorData) {
        //Reporting optional background work without replacing the public handle state.
        runtimeOptions.failureHandle?.(Object.freeze({
            stage: stageData,
            error: errorData
        }));

    }

    /**
     * @param {ReturnType<typeof queryOptionsNormalize>} normalizedOptions
     */
    function queryHandleCreate(normalizedOptions) {
        const listenerSet = new Set();
        let snapshotData = /** @type {LayerQuerySnapshot} */ (Object.freeze({
            data: null,
            pending: true,
            error: null,
            updatedAt: null,
            stale: false,
            status: 'loading',
            source: null
        }));
        let activeController = /** @type {AbortController | null} */ (null);
        let activeTask = /** @type {Promise<unknown> | null} */ (null);
        let disposedStatus = false;
        let currentCacheKey = /** @type {string | null} */ (null);

        function snapshotPublish(/** @type {Partial<LayerQuerySnapshot>} */ nextData) {
            snapshotData = Object.freeze({
                ...snapshotData,
                ...nextData
            });

            //Publishing one immutable state after every visible query transition.
            for (const listenerHandle of listenerSet) {
                listenerHandle(snapshotData);

            }

        }

        async function cacheStatePersist() {
            if (currentCacheKey === null || normalizedOptions.cache.policy === 'no-store' ||
                snapshotData.data === null) {
                return;

            }

            try {
                //Persisting application cache edits through the user-isolated storage namespace.
                await runtimeOptions.queryCachePut(currentCacheKey, snapshotData.data, {
                    expiresAt: timeGet() + normalizedOptions.cache.maxAgeMs
                });

            } catch (cacheError) {
                failureReport('query-cache-write', cacheError);

            }

        }

        async function queryRefresh() {
            if (disposedStatus) {
                throw new LayerRuntimeError('QUERY_DISPOSED', 'A disposed Layer query cannot refresh.');

            }

            //Cancelling the older transport before publishing a new refresh cycle.
            activeController?.abort();
            const requestController = new AbortController();
            activeController = requestController;
            const payloadData = queryPayloadRead(normalizedOptions.payload);
            const cacheKey = queryCacheKeyCreate(
                normalizedOptions.operation,
                payloadData,
                normalizedOptions.cache.key
            );
            currentCacheKey = cacheKey;
            let cachedData = /** @type {Readonly<Record<string, any>> | null} */ (null);

            snapshotPublish({
                pending: true,
                error: null,
                status: 'loading'
            });

            if (!['network-only', 'no-store'].includes(normalizedOptions.cache.policy)) {
                try {
                    cachedData = await runtimeOptions.queryCacheGet(cacheKey, timeGet());

                    if (cachedData.hit === true) {
                        /** @type {'success' | 'stale'} */
                        let cacheStatus = 'success';

                        if (cachedData.stale === true) {
                            cacheStatus = 'stale';

                        }

                        snapshotPublish({
                            data: structuredClone(cachedData.data),
                            updatedAt: timeGet(),
                            stale: cachedData.stale === true,
                            status: cacheStatus,
                            source: 'cache'
                        });

                        if (normalizedOptions.cache.policy === 'cache-first' && cachedData.stale !== true) {
                            snapshotPublish({
                                pending: false
                            });

                            return snapshotData.data;

                        }

                    }

                } catch (cacheError) {
                    failureReport('query-cache-read', cacheError);

                }

            }

            if (!onlineGet()) {
                const offlineError = new LayerRuntimeError(
                    'QUERY_OFFLINE',
                    'The query requires an active network connection.',
                    {retryable: true}
                );

                if (cachedData?.hit === true && normalizedOptions.offline.fallback === 'cache') {
                    snapshotPublish({
                        pending: false,
                        error: offlineError,
                        stale: true,
                        status: 'stale',
                        source: 'cache'
                    });

                    return snapshotData.data;

                }

                snapshotPublish({
                    pending: false,
                    error: offlineError,
                    stale: true,
                    status: 'error'
                });
                throw offlineError;

            }

            try {
                //Sending the query through the strict protocol client after the cache decision.
                const requestResult = await runtimeOptions.queryRequest(
                    normalizedOptions.operation,
                    payloadData,
                    {
                        signal: requestController.signal,
                        timeoutMs: normalizedOptions.timeoutMs
                    }
                );
                const updateTime = timeGet();
                let revisionData = null;

                if (Number.isSafeInteger(requestResult.meta?.revision) && requestResult.meta.revision >= 0) {
                    revisionData = requestResult.meta.revision;

                }

                if (normalizedOptions.cache.policy !== 'no-store') {
                    try {
                        await runtimeOptions.queryCachePut(cacheKey, requestResult.data, {
                            revision: revisionData,
                            expiresAt: updateTime + normalizedOptions.cache.maxAgeMs
                        });

                    } catch (cacheError) {
                        failureReport('query-cache-write', cacheError);

                    }

                }

                snapshotPublish({
                    data: structuredClone(requestResult.data),
                    pending: false,
                    error: null,
                    updatedAt: updateTime,
                    stale: false,
                    status: 'success',
                    source: 'network'
                });

                return snapshotData.data;

            } catch (queryError) {
                if (requestController.signal.aborted && activeController !== requestController) {
                    throw queryError;

                }

                if (cachedData?.hit === true && normalizedOptions.offline.fallback === 'cache' &&
                    queryCacheFallbackCheck(queryError)) {
                    snapshotPublish({
                        pending: false,
                        error: queryError,
                        stale: true,
                        status: 'stale',
                        source: 'cache'
                    });

                    return snapshotData.data;

                }

                snapshotPublish({
                    pending: false,
                    error: queryError,
                    stale: true,
                    status: 'error'
                });
                throw queryError;

            } finally {
                if (activeController === requestController) {
                    activeController = null;

                }

            }

        }

        function queryRefreshStart() {
            const queryTask = queryRefresh();
            activeTask = queryTask;

            void queryTask.catch(function initialQueryFailure(queryError) {
                if (
                    queryError instanceof LayerRuntimeError &&
                    queryError.code === 'API_ABORTED' &&
                    (disposedStatus || activeTask !== queryTask)
                ) {
                    //Ignoring lifecycle and superseded-request cancellation after owned work was released.
                    return;

                }

                //Reporting auto-start failures while the handle exposes the same safe error.
                failureReport('query-refresh', queryError);

            });

            return queryTask;

        }

        async function cacheDataUpdate(/** @type {(currentData: unknown) => unknown} */ updateHandle) {
            //Checking the updater before publishing a local cache transition.
            if (typeof updateHandle !== 'function') {
                throw new TypeError('Layer query cache update requires a function.');

            }

            const updatedData = updateHandle(structuredClone(snapshotData.data));

            snapshotPublish({
                data: structuredClone(updatedData),
                updatedAt: timeGet(),
                stale: false,
                status: 'success',
                source: 'local'
            });
            await cacheStatePersist();

            return snapshotData.data;

        }

        const handleData = {
            operation: normalizedOptions.operation,
            get cacheKey() {
                //Returning the cache identity calculated for the latest refresh.
                return currentCacheKey;

            },
            snapshot() {
                //Returning the immutable public state without cloning its identity.
                return snapshotData;

            },
            subscribe(/** @type {(snapshotData: LayerQuerySnapshot) => void} */ listenerHandle) {
                //Checking the listener before connecting it to this query.
                if (typeof listenerHandle !== 'function' || disposedStatus) {
                    throw new TypeError('Layer query listener is invalid.');

                }

                listenerSet.add(listenerHandle);
                listenerHandle(snapshotData);

                return function queryListenerDispose() {
                    //Removing only this listener from the query lifecycle.
                    return listenerSet.delete(listenerHandle);

                };

            },
            refresh() {
                //Launching a new query refresh cycle.
                return queryRefreshStart();

            },
            cancel() {
                //Checking whether this query currently owns a transport.
                if (activeController === null) {
                    return false;

                }

                activeController.abort();

                return true;

            },
            cacheUpdate: cacheDataUpdate,
            cacheInsert(/** @type {unknown} */ insertedValue) {
                return cacheDataUpdate(function queryCacheItemInsert(/** @type {unknown} */ currentData) {
                    //Adding the optimistic value to the current collection shape.
                    return queryCollectionInsert(currentData, insertedValue);

                });

            },
            cacheRemove(/** @type {(itemData: unknown) => boolean} */ predicateHandle) {
                if (typeof predicateHandle !== 'function') {
                    throw new TypeError('Layer query cache remove requires a predicate.');

                }

                return cacheDataUpdate(function queryCacheItemsRemove(/** @type {unknown} */ currentData) {
                    //Removing matching values from the current collection shape.
                    return queryCollectionRemove(currentData, predicateHandle);

                });

            },
            settled() {
                //Returning the active task or the latest settled data.
                return activeTask ?? Promise.resolve(snapshotData.data);

            },
            dispose() {
                //Checking whether this query lifecycle was already released.
                if (disposedStatus) {
                    return false;

                }

                disposedStatus = true;
                activeController?.abort();
                activeController = null;
                listenerSet.clear();
                activeQueryHandles.delete(queryHandle);

                return true;

            }
        };
        const queryHandle = Object.freeze(handleData);
        activeQueryHandles.add(queryHandle);
        queryRefreshStart();

        return queryHandle;

    }

    const queryCacheFacade = Object.freeze({
        async update(
            /** @type {string} */ selectorData,
            /** @type {(currentData: unknown) => unknown} */ updateHandle
        ) {
            if (typeof selectorData !== 'string' || selectorData.length < 1 || typeof updateHandle !== 'function') {
                throw new TypeError('Layer query cache update selector is invalid.');

            }

            const updateTasks = [];

            //Updating every active query for the selected operation or exact cache key.
            for (const queryHandle of activeQueryHandles) {
                if (queryHandle.operation === selectorData || queryHandle.cacheKey === selectorData) {
                    updateTasks.push(queryHandle.cacheUpdate(updateHandle));

                }

            }

            await Promise.all(updateTasks);

            return updateTasks.length;

        },
        insert(/** @type {string} */ selectorData, /** @type {unknown} */ insertedValue) {
            return queryCacheFacade.update(selectorData, function queryCacheSelectedInsert(
                /** @type {unknown} */ currentData
            ) {
                //Adding the value to every query selected by operation or cache key.
                return queryCollectionInsert(currentData, insertedValue);

            });

        },
        remove(
            /** @type {string} */ selectorData,
            /** @type {(itemData: unknown) => boolean} */ predicateHandle
        ) {
            if (typeof predicateHandle !== 'function') {
                throw new TypeError('Layer query cache remove requires a predicate.');

            }

            return queryCacheFacade.update(selectorData, function queryCacheSelectedRemove(
                /** @type {unknown} */ currentData
            ) {
                //Removing matching values from every selected query.
                return queryCollectionRemove(currentData, predicateHandle);

            });

        },
        removeByCommandId(/** @type {string} */ commandIdentifier) {
            if (typeof commandIdentifier !== 'string' || commandIdentifier.length < 1) {
                throw new TypeError('Layer optimistic command identity is invalid.');

            }

            const updateTasks = [];

            for (const queryHandle of activeQueryHandles) {
                updateTasks.push(queryHandle.cacheRemove(function optimisticCommandItemMatch(
                    /** @type {unknown} */ itemData
                ) {
                    //Checking one cached item against the durable command identity.
                    return typeof itemData === 'object' && itemData !== null &&
                    /** @type {Record<string, unknown>} */ (itemData).commandId === commandIdentifier;

                }).catch(function incompatibleQueryCollectionIgnore(/** @type {unknown} */ cacheError) {
                    //Ignoring active scalar queries that cannot contain optimistic list items.
                    if (cacheError instanceof TypeError) {
                        return null;

                    }

                    throw cacheError;

                }));

            }

            return Promise.all(updateTasks).then(function optimisticRemovalComplete() {
                //Reporting the number of active query handles inspected for rollback.
                return updateTasks.length;

            });

        }
    });

    /**
     * @param {ReturnType<typeof commandOptionsNormalize>} normalizedOptions
     */
    function commandControllerCreate(normalizedOptions) {
        const listenerSet = new Set();
        let snapshotData = /** @type {LayerCommandSnapshot} */ (Object.freeze({
            pending: false,
            error: null,
            lastResult: null,
            commandId: null,
            state: 'idle'
        }));
        let activeHandle = /** @type {Readonly<Record<string, any>> | null} */ (null);
        let activeTask = /** @type {Promise<unknown> | null} */ (null);
        let optimisticToken = /** @type {unknown} */ (null);
        let optimisticAppliedStatus = false;
        let disposedStatus = false;

        function snapshotPublish(/** @type {Partial<LayerCommandSnapshot>} */ nextData) {
            //Publishing one immutable command state to every current listener.
            snapshotData = Object.freeze({
                ...snapshotData,
                ...nextData
            });

            for (const listenerHandle of listenerSet) {
                listenerHandle(snapshotData);

            }

        }

        async function optimisticRollback(/** @type {unknown} */ errorData) {
            if (!optimisticAppliedStatus || typeof normalizedOptions.optimistic.rollback !== 'function') {
                return;

            }

            try {
                //Reverting only through the command-specific cache policy declared by the application.
                await normalizedOptions.optimistic.rollback(errorData, queryCacheFacade, optimisticToken);

            } catch (rollbackError) {
                failureReport('optimistic-rollback', rollbackError);

            }

        }

        /**
         * @returns {Promise<unknown>}
         */
        async function commandExecute(
            /** @type {Record<string, unknown>} */ payloadData,
            /** @type {LayerApplicationCommandExecutionOptions} */ executeOptions = {}
        ) {
            if (disposedStatus) {
                throw new LayerRuntimeError('COMMAND_DISPOSED', 'A disposed Layer command cannot execute.');

            }

            if (snapshotData.pending) {
                throw new LayerRuntimeError('COMMAND_ACTIVE', 'The Layer command already has an active execution.');

            }

            if (typeof payloadData !== 'object' || payloadData === null || Array.isArray(payloadData) ||
                typeof executeOptions !== 'object' || executeOptions === null || Array.isArray(executeOptions)) {
                throw new TypeError('Layer command execution input is invalid.');

            }

            const commandPayload = /** @type {Record<string, unknown>} */ (structuredClone(payloadData));
            const executionRecord = /** @type {Record<string, any>} */ (executeOptions);
            const executionAllowedFields = new Set([
                'baseRevision',
                'conflictDomain',
                'optimisticPatch'
            ]);
            let baseRevision = executionRecord.baseRevision;

            //Accepting the documented shorthand while keeping protocol metadata outside payload.
            if (baseRevision === undefined && Object.hasOwn(commandPayload, 'baseRevision')) {
                baseRevision = commandPayload.baseRevision;
                delete commandPayload.baseRevision;

            }

            if (Object.keys(executionRecord).some(function commandExecutionFieldCheck(fieldName) {
                //Rejecting fields outside the command execution contract.
                return !executionAllowedFields.has(fieldName);

            }) || !Number.isSafeInteger(baseRevision) || baseRevision < 0 ||
                (executionRecord.conflictDomain !== undefined &&
                    (typeof executionRecord.conflictDomain !== 'string' ||
                        executionRecord.conflictDomain.length < 1 || executionRecord.conflictDomain.length > 240)) ||
                (executionRecord.optimisticPatch !== undefined && executionRecord.optimisticPatch !== null &&
                    (typeof executionRecord.optimisticPatch !== 'object' ||
                        Array.isArray(executionRecord.optimisticPatch)))) {
                throw new TypeError('Layer command execution options are invalid.');

            }

            activeHandle?.dispose?.();
            activeHandle = null;
            optimisticToken = null;
            optimisticAppliedStatus = false;

            snapshotPublish({
                pending: true,
                error: null,
                lastResult: null,
                commandId: null,
                state: 'persisting'
            });

            try {
                //Persisting the durable intent through the shared application outbox.
                let offlineMode = 'reject';

                if (normalizedOptions.offline.strategy === 'outbox') {
                    offlineMode = 'queue';

                }

                const commandHandle = await runtimeOptions.commandRun(
                    normalizedOptions.operation,
                    commandPayload,
                    {
                        offline: offlineMode,
                        baseRevision,
                        conflictDomain: executionRecord.conflictDomain ?? normalizedOptions.conflictDomain,
                        optimisticPatch: executionRecord.optimisticPatch ?? null
                    }
                );
                activeHandle = commandHandle;
                snapshotPublish({
                    commandId: String(commandHandle.commandId),
                    state: String(commandHandle.state)
                });

                if (typeof normalizedOptions.optimistic.apply === 'function') {
                    try {
                        optimisticToken = await normalizedOptions.optimistic.apply(
                            Object.freeze({
                                ...structuredClone(commandPayload),
                                commandId: String(commandHandle.commandId)
                            }),
                            queryCacheFacade
                        );
                        optimisticAppliedStatus = true;

                    } catch (optimisticError) {
                        failureReport('optimistic-apply', optimisticError);

                    }

                }

                const commandResult = /** @type {unknown} */ (await commandHandle.result);
                snapshotPublish({
                    pending: false,
                    error: null,
                    lastResult: structuredClone(commandResult),
                    state: String(commandHandle.state)
                });

                return commandResult;

            } catch (commandError) {
                await optimisticRollback(commandError);
                let failureState = 'failed';

                if (activeHandle !== null) {
                    failureState = String(activeHandle.state);

                }

                snapshotPublish({
                    pending: false,
                    error: commandError,
                    state: failureState
                });
                throw commandError;

            }

        }

        const controllerData = {
            operation: normalizedOptions.operation,
            snapshot() {
                //Returning the immutable public command state.
                return snapshotData;

            },
            subscribe(/** @type {(snapshotData: LayerCommandSnapshot) => void} */ listenerHandle) {
                //Checking the listener before connecting it to this command.
                if (typeof listenerHandle !== 'function' || disposedStatus) {
                    throw new TypeError('Layer command listener is invalid.');

                }

                listenerSet.add(listenerHandle);
                listenerHandle(snapshotData);

                return function commandListenerDispose() {
                    //Removing only this listener from the command lifecycle.
                    return listenerSet.delete(listenerHandle);

                };

            },
            execute(
                /** @type {Record<string, unknown>} */ payloadData,
                /** @type {LayerApplicationCommandExecutionOptions} */ executeOptions = {}
            ) {
                //Launching this command and recording its shared completion task.
                const commandTask = commandExecute(payloadData, executeOptions);
                activeTask = commandTask;

                return commandTask;

            },
            async cancel() {
                //Checking whether a durable command can still be cancelled.
                if (activeHandle === null || typeof activeHandle.cancel !== 'function') {
                    return false;

                }

                await activeHandle.cancel();

                return true;

            },
            settled() {
                //Returning the active task or the latest settled command result.
                return activeTask ?? Promise.resolve(snapshotData.lastResult);

            },
            dispose() {
                //Checking whether this command lifecycle was already released.
                if (disposedStatus) {
                    return false;

                }

                disposedStatus = true;
                activeHandle?.dispose?.();
                activeHandle = null;
                listenerSet.clear();

                activeCommandControllers.delete(commandController);
                return true;

            }
        };

        const commandController = Object.freeze(controllerData);
        activeCommandControllers.add(commandController);

        return commandController;

    }

    return Object.freeze({
        query(/** @type {LayerApplicationQueryOptions} */ queryOptions) {
            //Creating one application-owned query handle.
            return queryHandleCreate(queryOptionsNormalize(queryOptions));

        },
        command(/** @type {LayerApplicationCommandOptions} */ commandOptions) {
            //Creating one application-owned command controller.
            return commandControllerCreate(commandOptionsNormalize(commandOptions));

        },
        async commandOnline(
            /** @type {string} */ operationName,
            /** @type {Record<string, unknown>} */ payloadData,
            /** @type {{baseRevision?: number}} */ commandOptions = {}
        ) {
            //Rejecting unsupported hosts and invalid input before any private transport work.
            if (
                typeof runtimeOptions.commandOnlineRun !== 'function' ||
                typeof operationName !== 'string' ||
                typeof payloadData !== 'object' ||
                payloadData === null ||
                Array.isArray(payloadData) === true ||
                typeof commandOptions !== 'object' ||
                commandOptions === null ||
                !Number.isSafeInteger(commandOptions.baseRevision ?? 0) ||
                Number(commandOptions.baseRevision ?? 0) < Number(0) ||
                Object.keys(commandOptions).some(function optionFieldCheck( fieldNameData ){
                    //CallBack THE BOOLEAN
                    return fieldNameData !== String('baseRevision');

                })
            ) {
                throw new TypeError('Layer online command input is invalid.');

            }

            //Failing before transport when the browser knows it is offline.
            if (onlineGet() !== true) {
                throw new LayerRuntimeError('COMMAND_OFFLINE', 'The command requires an active network connection.', {
                    retryable: true
                });

            }

            //Sending only through the existing same-origin API client, never the outbox.
            const requestResultData = await runtimeOptions.commandOnlineRun(
                operationName,
                structuredClone(payloadData),
                {baseRevision: Number(commandOptions.baseRevision ?? 0)}
            );

            //CallBack THE OBJECT
            return structuredClone(requestResultData.data);

        },
        sync(
            /** @type {string} */ operationName,
            /** @type {Record<string, unknown>} */ payloadData,
            /** @type {Record<string, unknown>} */ syncOptions = {}
        ) {
            //Forwarding explicit snapshot recovery through the strict transport.
            return runtimeOptions.syncRun(operationName, payloadData, syncOptions);

        },
        queryCache: queryCacheFacade,
        dispose() {
            //Disposing every active high-level API handle owned by this application.
            for (const queryHandle of [...activeQueryHandles]) {
                queryHandle.dispose();

            }

            for (const commandController of [...activeCommandControllers]) {
                commandController.dispose();

            }

        }
    });

}
