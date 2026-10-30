import {LayerStorageError} from './storage-error.js';

/**
 * @typedef {{name: string, version: number, stores: Readonly<Record<string, Readonly<Record<string, unknown>>>>, migrations: Readonly<Record<number, Function>>}} LayerStorageSchema
 * @typedef {{get: (storeName: string, keyData: IDBValidKey) => Promise<unknown>, put: (storeName: string, valueData: unknown, keyData?: IDBValidKey) => Promise<unknown>, delete: (storeName: string, keyData: IDBValidKey) => Promise<unknown>, getAll: (storeName: string, queryData?: {index?: string, query?: IDBValidKey | IDBKeyRange | null, count?: number}) => Promise<unknown>}} LayerStorageTransactionFacade
 * @typedef {{name: string, transaction: (storeNames: readonly string[], transactionMode: 'readonly' | 'readwrite', transactionHandle: (transactionData: LayerStorageTransactionFacade) => unknown | Promise<unknown>) => Promise<unknown>, get: (storeName: string, keyData: IDBValidKey) => Promise<unknown>, put: (storeName: string, valueData: unknown, keyData?: IDBValidKey) => Promise<unknown>, delete: (storeName: string, keyData: IDBValidKey) => Promise<unknown>, query: (storeName: string, queryData?: {index?: string, query?: IDBValidKey | IDBKeyRange | null, count?: number}) => Promise<unknown>, watch: (storeNames: readonly string[], queryHandle: () => unknown | Promise<unknown>, listenerHandle: (resultData: unknown) => void | Promise<void>, watchOptions?: {immediate?: boolean}) => () => void, eventCursors: Readonly<{read: (channelNames: readonly string[]) => Promise<Readonly<Record<string, number>>>, write: (channelName: string, sequenceData: number) => Promise<void>}>, queryCache: Readonly<{get: (cacheKey: string, timeData?: number) => Promise<Readonly<Record<string, unknown>>>, put: (cacheKey: string, cacheData: unknown, cacheOptions: {revision?: number | null, expiresAt: number}) => Promise<void>}>, entities: Readonly<{get: (entityKey: string) => Promise<unknown>, put: (entityData: {key: string, entityType: string, revision: number, data: Record<string, unknown>}) => Promise<void>}>, drafts: Readonly<{get: (draftKey: string) => Promise<unknown>, put: (draftKey: string, draftData: unknown) => Promise<unknown>, delete: (draftKey: string) => Promise<unknown>}>, estimate: () => Promise<Readonly<Record<string, unknown>>>, exportUserData: () => Promise<Readonly<Record<string, unknown>>>, close: () => void, purgeUserData: () => Promise<void>}} LayerStorage
 */

export const layerSystemStoreNames = Object.freeze({
    metadata: '__layer_metadata',
    queryCache: '__layer_query_cache',
    entities: '__layer_entities',
    outbox: '__layer_outbox',
    eventCursors: '__layer_event_cursors',
    drafts: '__layer_drafts',
    blobs: '__layer_blobs',
    leases: '__layer_leases',
    syncState: '__layer_sync_state'
});

const systemStoreDefinitions = Object.freeze({
    [layerSystemStoreNames.metadata]: {
        keyPath: 'key',
        indexes: {}
    },
    [layerSystemStoreNames.queryCache]: {
        keyPath: 'key',
        indexes: {
            expiresAt: 'expiresAt',
            accessedAt: 'accessedAt'
        }
    },
    [layerSystemStoreNames.entities]: {
        keyPath: 'key',
        indexes: {
            entityType: 'entityType',
            revision: 'revision'
        }
    },
    [layerSystemStoreNames.outbox]: {
        keyPath: 'commandId',
        indexes: {
            status: 'status',
            createdAt: 'createdAt',
            conflictDomain: 'conflictDomain',
            leaseUntil: 'leaseUntil'
        }
    },
    [layerSystemStoreNames.eventCursors]: {
        keyPath: 'channel',
        indexes: {}
    },
    [layerSystemStoreNames.drafts]: {
        keyPath: 'key',
        indexes: {
            updatedAt: 'updatedAt'
        }
    },
    [layerSystemStoreNames.blobs]: {
        keyPath: 'key',
        indexes: {
            lastAccessedAt: 'lastAccessedAt'
        }
    },
    [layerSystemStoreNames.leases]: {
        keyPath: 'key',
        indexes: {
            leaseUntil: 'leaseUntil'
        }
    },
    [layerSystemStoreNames.syncState]: {
        keyPath: 'key',
        indexes: {}
    }
});

const storageStateMap = new WeakMap();

/**
 * @param {string} storeName
 */
function developerStorePhysicalNameCreate(storeName) {
    //Separating application stores from the reserved engine namespace.
    return `app:${storeName}`;

}

/**
 * @param {unknown} errorData
 */
function diagnosticErrorCodeCreate(errorData) {
    //Reducing background callback failures to a non-sensitive class name.
    if (errorData instanceof Error) {
        return errorData.name;

    }

    return 'UNKNOWN';

}

/**
 * @param {IDBRequest} requestData
 */
function requestResultGet(requestData) {
    return new Promise(function requestResultWait(resolve, reject) {
        requestData.addEventListener('success', function requestSuccess() {
            //Returning the browser-cloned result only after request completion.
            resolve(requestData.result);

        }, {
            once: true
        });
        requestData.addEventListener('error', function requestFailure() {
            //Preserving the native cause for stable storage error normalization.
            reject(requestData.error ?? new Error('IndexedDB request failed.'));

        }, {
            once: true
        });

    });

}

/**
 * @param {IDBTransaction} transactionData
 */
function transactionCompleteWait(transactionData) {
    return new Promise(function transactionCompleteObserve(resolve, reject) {
        transactionData.addEventListener('complete', function transactionComplete() {
            //Resolving only after every write is durably committed.
            resolve(undefined);

        }, {
            once: true
        });
        transactionData.addEventListener('abort', function transactionAbort() {
            //Reporting the browser transaction cause without partial success.
            reject(transactionData.error ?? new Error('IndexedDB transaction aborted.'));

        }, {
            once: true
        });
        transactionData.addEventListener('error', function transactionFailure() {
            //Rejecting a failed transaction while abort handles final rollback.
            reject(transactionData.error ?? new Error('IndexedDB transaction failed.'));

        }, {
            once: true
        });

    });

}

/**
 * @param {unknown} errorData
 * @param {string} fallbackCode
 * @param {string} fallbackMessage
 */
function storageErrorNormalize(errorData, fallbackCode, fallbackMessage) {
    if (errorData instanceof LayerStorageError) {
        return errorData;

    }

    let errorName = '';

    if (errorData instanceof DOMException) {
        errorName = errorData.name;

    }
    let errorCode = fallbackCode;
    let retryableStatus = false;

    //Mapping browser-specific failures to stable recovery categories.
    if (errorName === 'QuotaExceededError') {
        errorCode = 'STORAGE_QUOTA_EXCEEDED';

    } else if (errorName === 'VersionError' || errorName === 'AbortError') {
        errorCode = 'STORAGE_MIGRATION_FAILED';

    } else if (errorName === 'SecurityError' || errorName === 'InvalidStateError') {
        errorCode = 'STORAGE_UNAVAILABLE';

    } else if (errorName === 'UnknownError' || errorName === 'ConstraintError' || errorName === 'DataError') {
        errorCode = 'STORAGE_CORRUPTED';

    } else {
        retryableStatus = true;

    }

    return new LayerStorageError(errorCode, fallbackMessage, {
        cause: errorData,
        retryable: retryableStatus
    });

}

/**
 * @param {IDBDatabase} database
 * @param {IDBTransaction} upgradeTransaction
 * @param {Readonly<Record<string, Readonly<Record<string, unknown>>>>} schemaStores
 */
function migrationContextCreate(database, upgradeTransaction, schemaStores) {
    /**
     * @param {string} storeName
     */
    function declaredStoreGet(storeName) {
        //Resolving only stores declared by the current application schema.
        const storeDefinition = schemaStores[storeName];

        if (storeDefinition === undefined) {
            throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage migration referenced unknown store ${storeName}.`);

        }

        return storeDefinition;

    }

    return Object.freeze({
        /**
         * @param {string} storeName
         */
        hasStore(storeName) {
            //Checking the physical developer store without exposing system stores.
            return database.objectStoreNames.contains(developerStorePhysicalNameCreate(storeName));

        },

        /**
         * @param {string} storeName
         */
        createStore(storeName) {
            const storeDefinition = declaredStoreGet(storeName);
            const physicalName = developerStorePhysicalNameCreate(storeName);

            if (database.objectStoreNames.contains(physicalName)) {
                throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage store ${storeName} already exists.`);

            }

            database.createObjectStore(physicalName, {
                keyPath: /** @type {string | string[]} */ (storeDefinition.keyPath),
                autoIncrement: Boolean(storeDefinition.autoIncrement)
            });

        },

        /**
         * @param {string} storeName
         */
        deleteStore(storeName) {
            //Removing an existing developer store inside the upgrade transaction.
            const physicalName = developerStorePhysicalNameCreate(storeName);

            if (!database.objectStoreNames.contains(physicalName)) {
                throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage store ${storeName} does not exist.`);

            }

            database.deleteObjectStore(physicalName);

        },

        /**
         * @param {string} storeName
         * @param {string} indexName
         */
        createIndex(storeName, indexName) {
            const storeDefinition = declaredStoreGet(storeName);
            const indexDefinitions = /** @type {Readonly<Record<string, Readonly<Record<string, unknown>>>>} */ (storeDefinition.indexes);
            const indexDefinition = indexDefinitions[indexName];

            if (indexDefinition === undefined) {
                throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage migration referenced unknown index ${storeName}.${indexName}.`);

            }

            const objectStore = upgradeTransaction.objectStore(developerStorePhysicalNameCreate(storeName));

            if (objectStore.indexNames.contains(indexName)) {
                throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage index ${storeName}.${indexName} already exists.`);

            }

            objectStore.createIndex(indexName, /** @type {string | string[]} */ (indexDefinition.keyPath), {
                unique: Boolean(indexDefinition.unique),
                multiEntry: Boolean(indexDefinition.multiEntry)
            });

        },

        /**
         * @param {string} storeName
         * @param {string} indexName
         */
        deleteIndex(storeName, indexName) {
            //Removing an existing index without exposing engine stores.
            declaredStoreGet(storeName);
            const objectStore = upgradeTransaction.objectStore(developerStorePhysicalNameCreate(storeName));

            if (!objectStore.indexNames.contains(indexName)) {
                throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage index ${storeName}.${indexName} does not exist.`);

            }

            objectStore.deleteIndex(indexName);

        }
    });

}

/**
 * @param {IDBDatabase} database
 * @param {Readonly<Record<string, Readonly<Record<string, unknown>>>>} schemaStores
 */
function finalSchemaValidate(database, schemaStores) {
    for (const [storeName, storeDefinition] of Object.entries(schemaStores)) {
        const physicalName = developerStorePhysicalNameCreate(storeName);

        if (!database.objectStoreNames.contains(physicalName)) {
            throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage migration did not create ${storeName}.`);

        }

        const indexDefinitions = /** @type {Readonly<Record<string, Readonly<Record<string, unknown>>>>} */ (storeDefinition.indexes);

        //Index presence is validated inside the active upgrade transaction by the caller.
        if (Object.keys(indexDefinitions).length > 64) {
            throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage store ${storeName} has too many indexes.`);

        }

    }

}

/**
 * @param {IDBDatabase} database
 * @param {IDBTransaction} upgradeTransaction
 * @param {Readonly<Record<string, Readonly<Record<string, unknown>>>>} schemaStores
 */
function finalIndexesValidate(database, upgradeTransaction, schemaStores) {
    finalSchemaValidate(database, schemaStores);

    for (const [storeName, storeDefinition] of Object.entries(schemaStores)) {
        const objectStore = upgradeTransaction.objectStore(developerStorePhysicalNameCreate(storeName));
        const indexDefinitions = /** @type {Readonly<Record<string, Readonly<Record<string, unknown>>>>} */ (storeDefinition.indexes);

        for (const indexName of Object.keys(indexDefinitions)) {
            if (!objectStore.indexNames.contains(indexName)) {
                throw new LayerStorageError('STORAGE_MIGRATION_FAILED', `Storage migration did not create ${storeName}.${indexName}.`);

            }

        }

    }

}

/**
 * @param {IDBTransaction} transactionData
 * @param {(storeName: string) => string} storeNameResolve
 * @param {readonly string[]} permittedStores
 */
function transactionFacadeCreate(transactionData, storeNameResolve, permittedStores) {
    const permittedStoreSet = new Set(permittedStores);

    /**
     * @param {string} storeName
     */
    function objectStoreGet(storeName) {
        //Rejecting accidental access outside the transaction's declared scope.
        if (!permittedStoreSet.has(storeName)) {
            throw new LayerStorageError('STORAGE_TRANSACTION_INVALID', `Store ${storeName} is outside this transaction.`);

        }

        return transactionData.objectStore(storeNameResolve(storeName));

    }

    return Object.freeze({
        /**
         * @param {string} storeName
         * @param {IDBValidKey} keyData
         */
        get(storeName, keyData) {
            //Reading one structured-cloned value inside the active transaction.
            return requestResultGet(objectStoreGet(storeName).get(keyData));

        },

        /**
         * @param {string} storeName
         * @param {unknown} valueData
         * @param {IDBValidKey} [keyData]
         */
        put(storeName, valueData, keyData) {
            const objectStore = objectStoreGet(storeName);
            let requestData;

            //Using inline keys unless the caller explicitly supplies an out-of-line key.
            if (keyData === undefined) {
                requestData = objectStore.put(valueData);

            } else {
                requestData = objectStore.put(valueData, keyData);

            }

            return requestResultGet(requestData);

        },

        /**
         * @param {string} storeName
         * @param {IDBValidKey} keyData
         */
        delete(storeName, keyData) {
            //Deleting the exact primary key without wildcard expansion.
            return requestResultGet(objectStoreGet(storeName).delete(keyData));

        },

        /**
         * @param {string} storeName
         * @param {{index?: string, query?: IDBValidKey | IDBKeyRange | null, count?: number}} [queryData]
         */
        getAll(storeName, queryData = {}) {
            const objectStore = objectStoreGet(storeName);
            let querySource = /** @type {IDBObjectStore | IDBIndex} */ (objectStore);

            //Switching to the declared index only when the caller selects one.
            if (queryData.index !== undefined) {
                querySource = objectStore.index(queryData.index);

            }

            const queryValue = queryData.query ?? null;

            return requestResultGet(querySource.getAll(queryValue, queryData.count));

        }
    });

}

/**
 * @param {object} storageObject
 * @param {readonly string[]} storeNames
 * @param {'readonly' | 'readwrite'} transactionMode
 * @param {(transactionData: ReturnType<typeof transactionFacadeCreate>) => unknown | Promise<unknown>} transactionHandle
 */
async function transactionRun(storageObject, storeNames, transactionMode, transactionHandle) {
    //Resolving the live database state before opening a native transaction.
    const storageState = storageStateMap.get(storageObject);

    if (storageState === undefined || storageState.closedStatus) {
        throw new LayerStorageError('STORAGE_CLOSED', 'The storage connection is closed.');

    }

    const uniqueStores = [...new Set(storeNames)];

    if (uniqueStores.length < 1) {
        throw new LayerStorageError('STORAGE_TRANSACTION_INVALID', 'A transaction requires at least one store.');

    }

    const physicalStores = uniqueStores.map(storageState.storeNameResolve);
    const nativeTransaction = storageState.database.transaction(physicalStores, transactionMode);
    const completePromise = transactionCompleteWait(nativeTransaction);
    const transactionFacade = transactionFacadeCreate(
        nativeTransaction,
        storageState.storeNameResolve,
        uniqueStores
    );
    let handlerResult;

    try {
        handlerResult = await transactionHandle(transactionFacade);

    } catch (transactionError) {
        nativeTransaction.abort();

        try {
            await completePromise;

        } catch (abortError) {
            void abortError;

        }

        throw storageErrorNormalize(transactionError, 'STORAGE_TRANSACTION_FAILED', 'The storage transaction failed.');

    }

    try {
        await completePromise;

    } catch (transactionError) {
        throw storageErrorNormalize(transactionError, 'STORAGE_TRANSACTION_FAILED', 'The storage transaction failed.');

    }

    if (transactionMode === 'readwrite') {
        storageState.watchNotify(new Set(uniqueStores));

    }

    return handlerResult;

}

/**
 * @param {object} storageObject
 * @param {readonly string[]} storeNames
 * @param {'readonly' | 'readwrite'} transactionMode
 * @param {(transactionData: ReturnType<typeof transactionFacadeCreate>) => unknown | Promise<unknown>} transactionHandle
 */
export function layerStorageSystemTransactionRun(storageObject, storeNames, transactionMode, transactionHandle) {
    const storageState = storageStateMap.get(storageObject);

    if (storageState === undefined) {
        throw new TypeError('The storage object does not belong to Layer-Engine.');

    }

    for (const storeName of storeNames) {
        if (!/** @type {readonly string[]} */ (Object.values(layerSystemStoreNames)).includes(storeName)) {
            throw new LayerStorageError('STORAGE_TRANSACTION_INVALID', `System store ${storeName} is invalid.`);

        }

    }

    return transactionRun(storageObject, storeNames, transactionMode, transactionHandle);

}

/**
 * @param {object} openOptions
 * @param {string} openOptions.appId
 * @param {string} openOptions.namespace
 * @param {LayerStorageSchema} openOptions.schema
 * @param {IDBFactory} [openOptions.indexedDb]
 * @param {StorageManager} [openOptions.storageManager]
 * @param {number} [openOptions.blockedTimeoutMs]
 * @param {(blockedData: {databaseName: string, oldVersion: number, newVersion: number | null}) => void} [openOptions.blockedHandle]
 * @param {(versionData: {oldVersion: number, newVersion: number | null}) => void} [openOptions.versionChangeHandle]
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} [openOptions.diagnostics]
 * @returns {Promise<LayerStorage>}
 */
export async function layerStorageOpen(openOptions) {
    const indexedDb = openOptions.indexedDb ?? globalThis.indexedDB;
    const blockedTimeoutMs = openOptions.blockedTimeoutMs ?? 10000;

    if (indexedDb === undefined ||
        !/^[a-z][a-z0-9_-]{0,79}$/.test(openOptions.appId) ||
        !/^[a-zA-Z0-9:_-]{1,160}$/.test(openOptions.namespace) ||
        !Number.isInteger(blockedTimeoutMs) || blockedTimeoutMs < 1 || blockedTimeoutMs > 60000) {
        throw new LayerStorageError('STORAGE_UNAVAILABLE', 'IndexedDB or storage identity is unavailable.');

    }

    const databaseName = `layer:${openOptions.appId}:${openOptions.namespace}:${openOptions.schema.name}`;
    const openRequest = indexedDb.open(databaseName, openOptions.schema.version);
    let upgradeError = /** @type {unknown} */ (null);
    let blockedTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
    const database = await new Promise(function databaseOpenWait(resolve, reject) {
        let settledStatus = false;

        openRequest.addEventListener('upgradeneeded', function databaseUpgrade(upgradeEvent) {
            const upgradeTransaction = openRequest.transaction;

            if (upgradeTransaction === null) {
                upgradeError = new LayerStorageError('STORAGE_MIGRATION_FAILED', 'The upgrade transaction is unavailable.');

                return;

            }

            try {
                //Creating engine-owned stores only for a new user namespace.
                if (upgradeEvent.oldVersion === 0) {
                    for (const [storeName, storeDefinition] of Object.entries(systemStoreDefinitions)) {
                        const objectStore = openRequest.result.createObjectStore(storeName, {
                            keyPath: storeDefinition.keyPath
                        });

                        for (const [indexName, indexKeyPath] of Object.entries(storeDefinition.indexes)) {
                            objectStore.createIndex(indexName, indexKeyPath);

                        }

                    }

                }

                const migrationContext = migrationContextCreate(
                    openRequest.result,
                    upgradeTransaction,
                    openOptions.schema.stores
                );

                for (let migrationVersion = upgradeEvent.oldVersion + 1;
                    migrationVersion <= openOptions.schema.version;
                    migrationVersion += 1) {
                    const migrationResult = openOptions.schema.migrations[migrationVersion]?.(migrationContext);

                    if (migrationResult !== undefined) {
                        throw new LayerStorageError('STORAGE_MIGRATION_FAILED', 'Storage migrations must be synchronous.');

                    }

                }

                finalIndexesValidate(openRequest.result, upgradeTransaction, openOptions.schema.stores);

            } catch (migrationError) {
                upgradeError = migrationError;
                upgradeTransaction.abort();

            }

        });
        openRequest.addEventListener('blocked', function databaseBlocked(blockedEvent) {
            openOptions.blockedHandle?.({
                databaseName,
                oldVersion: blockedEvent.oldVersion,
                newVersion: blockedEvent.newVersion
            });

            //Bounding an upgrade that waits for stale tabs to release old connections.
            blockedTimer = setTimeout(function databaseBlockedTimeout() {
                //Rejecting only while this open request is still unresolved.
                if (!settledStatus) {
                    settledStatus = true;
                    reject(new LayerStorageError('STORAGE_UPGRADE_BLOCKED', 'The storage upgrade is blocked by another tab.', {
                        retryable: true
                    }));

                }

            }, blockedTimeoutMs);

        });
        openRequest.addEventListener('error', function databaseOpenFailure() {
            //Ignoring a late browser error after blocked timeout already settled.
            if (settledStatus) {
                return;

            }

            settledStatus = true;
            clearTimeout(blockedTimer);
            reject(storageErrorNormalize(
                upgradeError ?? openRequest.error,
                'STORAGE_OPEN_FAILED',
                'The storage database could not be opened.'
            ));

        });
        openRequest.addEventListener('success', function databaseOpenSuccess() {
            //Cancelling the blocked deadline before publishing the connection.
            clearTimeout(blockedTimer);

            if (settledStatus) {
                openRequest.result.close();

                return;

            }

            settledStatus = true;
            resolve(openRequest.result);

        });

    });
    const typedDatabase = /** @type {IDBDatabase} */ (database);
    let storageObject = /** @type {LayerStorage} */ (/** @type {unknown} */ (null));
    const watchers = /** @type {Set<{stores: string[], query: () => unknown | Promise<unknown>, listener: (resultData: unknown) => void | Promise<void>}>} */ (new Set());
    const storeNameResolve = function publicStoreNameResolve(/** @type {string} */ storeName) {
        //Passing system stores through while mapping declared developer stores.
        if (/** @type {readonly string[]} */ (Object.values(layerSystemStoreNames)).includes(storeName)) {
            return storeName;

        }

        if (openOptions.schema.stores[storeName] === undefined) {
            throw new LayerStorageError('STORAGE_STORE_UNKNOWN', `Storage store ${storeName} is not declared.`);

        }

        return developerStorePhysicalNameCreate(storeName);

    };
    const watchNotify = function committedStoresNotify(/** @type {Set<string>} */ changedStores) {
        //Scheduling watchers after commit so they never observe partial transactions.
        queueMicrotask(function committedWatchersRun() {
            for (const watcherData of watchers) {
                const affectedStatus = watcherData.stores.some(function changedStoreFind(storeName) {
                    //Checking whether this watcher depends on any committed store.
                    return changedStores.has(storeName);

                });

                if (affectedStatus) {
                    Promise.resolve(watcherData.query()).then(watcherData.listener).catch(function watcherFailure(errorData) {
                        //Reporting a post-commit refresh failure without reverting committed data.
                        openOptions.diagnostics?.record({
                            level: 'error',
                            event: 'storage.watch-failed',
                            code: diagnosticErrorCodeCreate(errorData)
                        });

                    });

                }

            }

        });

    };

    typedDatabase.addEventListener('versionchange', function databaseVersionChange(versionEvent) {
        //Closing promptly so another tab can complete a declared migration.
        typedDatabase.close();
        const storageState = storageStateMap.get(storageObject);

        if (storageState !== undefined) {
            storageState.closedStatus = true;

        }

        openOptions.versionChangeHandle?.({
            oldVersion: versionEvent.oldVersion,
            newVersion: versionEvent.newVersion
        });

    });

    storageObject = Object.freeze({
        name: databaseName,

        /**
         * @param {readonly string[]} storeNames
         * @param {'readonly' | 'readwrite'} transactionMode
         * @param {(transactionData: ReturnType<typeof transactionFacadeCreate>) => unknown | Promise<unknown>} transactionHandle
         */
        transaction(storeNames, transactionMode, transactionHandle) {
            //Validating public store access before opening the native transaction.
            for (const storeName of storeNames) {
                if (openOptions.schema.stores[storeName] === undefined) {
                    throw new LayerStorageError('STORAGE_STORE_UNKNOWN', `Storage store ${storeName} is not declared.`);

                }

            }

            return transactionRun(storageObject, storeNames, transactionMode, transactionHandle);

        },

        /** @param {string} storeName @param {IDBValidKey} keyData */
        get(storeName, keyData) {
            return transactionRun(storageObject, [storeName], 'readonly', function singleValueRead(transactionData) {
                //Reading through the same transaction contract as compound operations.
                return transactionData.get(storeName, keyData);

            });

        },

        /** @param {string} storeName @param {unknown} valueData @param {IDBValidKey} [keyData] */
        put(storeName, valueData, keyData) {
            return transactionRun(storageObject, [storeName], 'readwrite', function singleValueWrite(transactionData) {
                //Writing one value and notifying watchers only after commit.
                return transactionData.put(storeName, valueData, keyData);

            });

        },

        /** @param {string} storeName @param {IDBValidKey} keyData */
        delete(storeName, keyData) {
            return transactionRun(storageObject, [storeName], 'readwrite', function singleValueDelete(transactionData) {
                //Deleting one value through a committed write transaction.
                return transactionData.delete(storeName, keyData);

            });

        },

        /**
         * @param {string} storeName
         * @param {{index?: string, query?: IDBValidKey | IDBKeyRange | null, count?: number}} [queryData]
         */
        query(storeName, queryData = {}) {
            return transactionRun(storageObject, [storeName], 'readonly', function storeQueryRead(transactionData) {
                //Returning a bounded native-order snapshot from a store or index.
                return transactionData.getAll(storeName, queryData);

            });

        },

        /**
         * @param {readonly string[]} storeNames
         * @param {() => unknown | Promise<unknown>} queryHandle
         * @param {(resultData: unknown) => void | Promise<void>} listenerHandle
         * @param {{immediate?: boolean}} [watchOptions]
         */
        watch(storeNames, queryHandle, listenerHandle, watchOptions = {}) {
            const watcherData = {
                stores: [...new Set(storeNames)],
                query: queryHandle,
                listener: listenerHandle
            };

            for (const storeName of watcherData.stores) {
                storeNameResolve(storeName);

            }

            watchers.add(watcherData);

            let immediateStatus = true;

            if (watchOptions.immediate !== undefined) {
                immediateStatus = watchOptions.immediate;

            }

            if (immediateStatus) {
                Promise.resolve(queryHandle()).then(listenerHandle).catch(function initialWatchFailure(errorData) {
                    //Reporting an initial query failure without registering false data.
                    openOptions.diagnostics?.record({
                        level: 'error',
                        event: 'storage.watch-failed',
                        code: diagnosticErrorCodeCreate(errorData)
                    });

                });

            }

            return function watchDispose() {
                //Stopping future post-commit refreshes for this watcher.
                watchers.delete(watcherData);

            };

        },

        eventCursors: Object.freeze({
            /**
             * @param {readonly string[]} channelNames
             */
            async read(channelNames) {
                const cursorData = /** @type {Record<string, number>} */ ({});

                await layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.eventCursors],
                    'readonly',
                    async function cursorBatchRead(transactionData) {
                        //Returning zero for a channel without a durable event position.
                        for (const channelName of channelNames) {
                            const cursorRecord = /** @type {Record<string, unknown> | undefined} */ (
                                await transactionData.get(layerSystemStoreNames.eventCursors, channelName)
                            );
                            cursorData[channelName] = Number(cursorRecord?.sequence ?? 0);

                        }

                    }
                );

                return Object.freeze(cursorData);

            },

            /**
             * @param {string} channelName
             * @param {number} sequenceData
             */
            async write(channelName, sequenceData) {
                if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(channelName) || !Number.isSafeInteger(sequenceData) || sequenceData < 0) {
                    throw new LayerStorageError('STORAGE_CURSOR_INVALID', 'The event cursor is invalid.');

                }

                await layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.eventCursors],
                    'readwrite',
                    async function cursorWrite(transactionData) {
                        const currentRecord = /** @type {Record<string, unknown> | undefined} */ (
                            await transactionData.get(layerSystemStoreNames.eventCursors, channelName)
                        );
                        const currentSequence = Number(currentRecord?.sequence ?? 0);

                        //Preventing an older tab from moving a shared cursor backwards.
                        if (sequenceData >= currentSequence) {
                            await transactionData.put(layerSystemStoreNames.eventCursors, {
                                channel: channelName,
                                sequence: sequenceData,
                                updatedAt: new Date().toISOString()
                            });

                        }

                    }
                );

            }
        }),

        queryCache: Object.freeze({
            /**
             * @param {string} cacheKey
             * @param {number} [timeData]
             */
            async get(cacheKey, timeData = Date.now()) {
                const cacheRecord = /** @type {Record<string, unknown> | undefined} */ (await layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.queryCache],
                    'readonly',
                    function queryCacheRead(transactionData) {
                        //Reading one cached query snapshot by its stable key.
                        return transactionData.get(layerSystemStoreNames.queryCache, cacheKey);

                    }
                ));

                if (cacheRecord === undefined) {
                    return Object.freeze({
                        hit: false,
                        stale: false,
                        data: null,
                        revision: null
                    });

                }

                return Object.freeze({
                    hit: true,
                    stale: Number(cacheRecord.expiresAt) <= timeData,
                    data: structuredClone(cacheRecord.data),
                    revision: cacheRecord.revision ?? null
                });

            },

            /**
             * @param {string} cacheKey
             * @param {unknown} cacheData
             * @param {{revision?: number | null, expiresAt: number}} cacheOptions
             */
            async put(cacheKey, cacheData, cacheOptions) {
                //Validating bounded cache identity and absolute freshness time.
                if (cacheKey.length < 1 || cacheKey.length > 512 ||
                    !Number.isFinite(cacheOptions.expiresAt) || cacheOptions.expiresAt < 0) {
                    throw new LayerStorageError('STORAGE_CACHE_INVALID', 'The query cache entry is invalid.');

                }

                await layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.queryCache],
                    'readwrite',
                    function queryCacheWrite(transactionData) {
                        //Replacing one cache record as a single committed value.
                        return transactionData.put(layerSystemStoreNames.queryCache, {
                            key: cacheKey,
                            data: structuredClone(cacheData),
                            revision: cacheOptions.revision ?? null,
                            expiresAt: cacheOptions.expiresAt,
                            accessedAt: Date.now()
                        });

                    }
                );

            }
        }),

        entities: Object.freeze({
            /** @param {string} entityKey */
            get(entityKey) {
                //Reading one normalized entity without exposing its object store.
                return layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.entities],
                    'readonly',
                    function normalizedEntityRead(transactionData) {
                        //Returning the exact entity key from a readonly transaction.
                        return transactionData.get(layerSystemStoreNames.entities, entityKey);

                    }
                );

            },

            /**
             * @param {{key: string, entityType: string, revision: number, data: Record<string, unknown>}} entityData
             */
            async put(entityData) {
                if (entityData.key.length < 1 || entityData.key.length > 512 ||
                    !/^[a-zA-Z0-9:._-]{1,160}$/.test(entityData.entityType) ||
                    !Number.isSafeInteger(entityData.revision) || entityData.revision < 0) {
                    throw new LayerStorageError('STORAGE_ENTITY_INVALID', 'The normalized entity is invalid.');

                }

                await layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.entities],
                    'readwrite',
                    async function normalizedEntityWrite(transactionData) {
                        const currentEntity = /** @type {Record<string, unknown> | undefined} */ (
                            await transactionData.get(layerSystemStoreNames.entities, entityData.key)
                        );

                        if (currentEntity !== undefined && Number(currentEntity.revision) > entityData.revision) {
                            throw new LayerStorageError('STORAGE_REVISION_CONFLICT', 'An older entity revision cannot replace newer local state.');

                        }

                        await transactionData.put(layerSystemStoreNames.entities, {
                            ...structuredClone(entityData),
                            updatedAt: new Date().toISOString()
                        });

                    }
                );

            }
        }),

        drafts: Object.freeze({
            /** @param {string} draftKey */
            get(draftKey) {
                //Reading one engine-managed draft by application key.
                return layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.drafts],
                    'readonly',
                    function draftRead(transactionData) {
                        //Returning the committed draft snapshot.
                        return transactionData.get(layerSystemStoreNames.drafts, draftKey);

                    }
                );

            },

            /** @param {string} draftKey @param {unknown} draftData */
            put(draftKey, draftData) {
                //Persisting draft content with an updated pressure-policy timestamp.
                return layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.drafts],
                    'readwrite',
                    function draftWrite(transactionData) {
                        //Cloning application data before its committed write.
                        return transactionData.put(layerSystemStoreNames.drafts, {
                            key: draftKey,
                            data: structuredClone(draftData),
                            updatedAt: Date.now()
                        });

                    }
                );

            },

            /** @param {string} draftKey */
            delete(draftKey) {
                //Deleting one explicitly selected draft without pressure heuristics.
                return layerStorageSystemTransactionRun(
                    storageObject,
                    [layerSystemStoreNames.drafts],
                    'readwrite',
                    function draftDelete(transactionData) {
                        //Removing the exact draft key inside a write transaction.
                        return transactionData.delete(layerSystemStoreNames.drafts, draftKey);

                    }
                );

            }
        }),

        async estimate() {
            //Returning an explicit fallback when StorageManager is unavailable.
            if (openOptions.storageManager === undefined) {
                return Object.freeze({
                    supported: false,
                    usage: null,
                    quota: null,
                    persisted: false
                });

            }

            const estimateData = await openOptions.storageManager.estimate();
            const persistedStatus = await openOptions.storageManager.persisted();

            return Object.freeze({
                supported: true,
                usage: estimateData.usage ?? null,
                quota: estimateData.quota ?? null,
                persisted: persistedStatus
            });

        },

        async exportUserData() {
            const exportData = /** @type {Record<string, unknown[]>} */ ({});
            const exportedSystemStores = [
                layerSystemStoreNames.queryCache,
                layerSystemStoreNames.entities,
                layerSystemStoreNames.outbox,
                layerSystemStoreNames.eventCursors,
                layerSystemStoreNames.drafts
            ];

            for (const storeName of Object.keys(openOptions.schema.stores)) {
                exportData[storeName] = /** @type {unknown[]} */ (await storageObject.query(storeName));

            }

            for (const storeName of exportedSystemStores) {
                exportData[storeName] = /** @type {unknown[]} */ (await layerStorageSystemTransactionRun(
                    storageObject,
                    [storeName],
                    'readonly',
                    function systemStoreExport(transactionData) {
                        //Exporting a complete engine-owned user store snapshot.
                        return transactionData.getAll(storeName);

                    }
                ));

            }

            return Object.freeze({
                database: databaseName,
                exportedAt: new Date().toISOString(),
                stores: Object.freeze(exportData)
            });

        },

        close() {
            const storageState = storageStateMap.get(storageObject);

            if (storageState !== undefined && !storageState.closedStatus) {
                //Closing this tab without deleting the durable user namespace.
                storageState.closedStatus = true;
                typedDatabase.close();
                watchers.clear();

            }

        },

        async purgeUserData() {
            storageObject.close();
            await new Promise(function databaseDeleteWait(resolve, reject) {
                const deleteRequest = indexedDb.deleteDatabase(databaseName);
                let blockedTimeout = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
                let settledStatus = false;

                /**
                 * @param {() => void} settleAction
                 */
                function deletionSettle(settleAction) {
                    //Settling once while releasing a delayed blocked failure.
                    if (settledStatus) {
                        return;

                    }

                    settledStatus = true;

                    if (blockedTimeout !== null) {
                        clearTimeout(blockedTimeout);

                    }

                    settleAction();

                }

                deleteRequest.addEventListener('success', function databaseDeleteSuccess() {
                    //Confirming complete namespace removal for logout.
                    deletionSettle(function databaseDeleteResolve(){
                        //Resolving after every browser connection released the namespace.
                        resolve(undefined);

                    });

                }, {
                    once: true
                });
                deleteRequest.addEventListener('error', function databaseDeleteFailure() {
                    //Failing visibly when logout data could not be removed.
                    deletionSettle(function databaseDeleteReject(){
                        //Normalizing the terminal IndexedDB failure for the public contract.
                        reject(storageErrorNormalize(
                            deleteRequest.error,
                            'STORAGE_PURGE_FAILED',
                            'The user storage namespace could not be removed.'
                        ));

                    });

                }, {
                    once: true
                });
                deleteRequest.addEventListener('blocked', function databaseDeleteBlocked() {
                    if (blockedTimeout !== null || settledStatus) {
                        return;

                    }

                    //Allowing versionchange handlers time to release Safari and multi-tab connections.
                    blockedTimeout = setTimeout(function databaseDeleteBlockedTimeout(){
                        //Reporting only a connection that remained blocked after the grace period.
                        deletionSettle(function databaseDeleteBlockedReject(){
                            //Returning the stable retryable purge failure after bounded waiting.
                            reject(new LayerStorageError('STORAGE_UPGRADE_BLOCKED', 'The user storage purge is blocked by another tab.', {
                                retryable: true
                            }));

                        });

                    }, 2000);

                }, {
                    once: true
                });

            });

        }
    });

    storageStateMap.set(storageObject, {
        database: typedDatabase,
        closedStatus: false,
        storeNameResolve,
        watchNotify
    });

    return storageObject;

}
