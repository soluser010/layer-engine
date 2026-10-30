import {
    LAYER_ERROR_CODES,
    LAYER_PROTOCOL_VERSION
} from '@solcorp/layer-protocol/constants';
import {LayerStorageError} from './storage-error.js';
import {layerSystemStoreNames} from './storage.js';

const applicationIdentifierPattern = /^[a-z][a-z0-9_-]{0,79}$/;
const conflictDomainPattern = /^[a-zA-Z0-9:_-]{1,160}$/;
const operationNamePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const requestIdentifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const layerErrorCodeSet = /** @type {Set<string>} */ (new Set(Object.values(LAYER_ERROR_CODES)));
const registryStoreName = 'configuration';
const registryRecordKey = 'current';
const workerResponseMaximumBytes = 1048576;
const workerLeaseMilliseconds = 30000;

/**
 * @param {IDBRequest} requestData
 */
function requestResultGet(requestData) {
    return new Promise(function requestResultWait(resolve, reject) {
        requestData.addEventListener('success', function requestSuccess() {
            //Returning the browser-cloned value after the native request completes.
            resolve(requestData.result);

        }, {once: true});
        requestData.addEventListener('error', function requestFailure() {
            //Preserving the native cause for stable worker storage diagnostics.
            reject(requestData.error ?? new Error('IndexedDB request failed.'));

        }, {once: true});

    });

}

/**
 * @param {IDBTransaction} transactionData
 */
function transactionCompleteWait(transactionData) {
    return new Promise(function transactionCompletionWait(resolve, reject) {
        transactionData.addEventListener('complete', function transactionComplete() {
            //Resolving only after every claim or completion write is committed.
            resolve(undefined);

        }, {once: true});
        transactionData.addEventListener('abort', function transactionAbort() {
            //Rejecting an explicitly aborted worker transaction.
            reject(transactionData.error ?? new Error('IndexedDB transaction aborted.'));

        }, {once: true});
        transactionData.addEventListener('error', function transactionFailure() {
            //Rejecting a failed worker transaction without hiding its native cause.
            reject(transactionData.error ?? new Error('IndexedDB transaction failed.'));

        }, {once: true});

    });

}

/**
 * @param {IDBFactory} indexedDb
 * @param {string} databaseName
 * @param {boolean} registryStatus
 */
function databaseOpen(indexedDb, databaseName, registryStatus) {
    return new Promise(function databaseOpenWait(resolve, reject) {
        let openRequest;

        //Selecting a fixed version only for the engine-owned registry database.
        if (registryStatus) {
            openRequest = indexedDb.open(databaseName, 1);

        } else {
            openRequest = indexedDb.open(databaseName);

        }

        openRequest.addEventListener('upgradeneeded', function registryUpgrade() {
            //Creating only the app-scoped worker configuration store.
            if (registryStatus && !openRequest.result.objectStoreNames.contains(registryStoreName)) {
                openRequest.result.createObjectStore(registryStoreName, {keyPath: 'key'});

            }

        });
        openRequest.addEventListener('success', function databaseOpenSuccess() {
            //Returning the live database without changing the application schema.
            resolve(openRequest.result);

        }, {once: true});
        openRequest.addEventListener('error', function databaseOpenFailure() {
            //Failing closed when the configured database cannot be opened.
            reject(openRequest.error ?? new Error('IndexedDB database open failed.'));

        }, {once: true});

    });

}

/**
 * @param {string} appId
 */
function registryDatabaseNameCreate(appId) {
    //Separating worker configuration from every user data database.
    return `layer-worker:${appId}`;

}

/**
 * @param {object} configurationOptions
 * @param {string} configurationOptions.appId
 * @param {string} configurationOptions.storageName
 * @param {string} configurationOptions.apiUrl
 * @param {string | null} configurationOptions.csrfToken
 * @param {string} configurationOptions.applicationOrigin
 * @param {IDBFactory} [configurationOptions.indexedDb]
 */
export async function layerWorkerOutboxConfigure(configurationOptions) {
    //Rejecting incomplete configuration before reading browser dependencies.
    if (configurationOptions === null || typeof configurationOptions !== 'object') {
        throw new LayerStorageError('WORKER_OUTBOX_CONFIG_INVALID', 'Worker outbox configuration is invalid.');

    }

    const indexedDb = configurationOptions.indexedDb ?? globalThis.indexedDB;

    if (indexedDb === undefined || !applicationIdentifierPattern.test(configurationOptions.appId) ||
        typeof configurationOptions.storageName !== 'string' ||
        !configurationOptions.storageName.startsWith(`layer:${configurationOptions.appId}:`) ||
        typeof configurationOptions.applicationOrigin !== 'string' ||
        (configurationOptions.csrfToken !== null &&
            (typeof configurationOptions.csrfToken !== 'string' ||
                configurationOptions.csrfToken.length < 1 || configurationOptions.csrfToken.length > 4096))) {
        throw new LayerStorageError('WORKER_OUTBOX_CONFIG_INVALID', 'Worker outbox configuration is invalid.');

    }

    const normalizedApiUrl = new URL(configurationOptions.apiUrl, configurationOptions.applicationOrigin);

    if (normalizedApiUrl.origin !== configurationOptions.applicationOrigin ||
        !['http:', 'https:'].includes(normalizedApiUrl.protocol)) {
        throw new LayerStorageError('WORKER_OUTBOX_CONFIG_INVALID', 'Worker API URL must stay on the application origin.');

    }

    const registryDatabase = /** @type {IDBDatabase} */ (await databaseOpen(
        indexedDb,
        registryDatabaseNameCreate(configurationOptions.appId),
        true
    ));

    try {
        const transactionData = registryDatabase.transaction([registryStoreName], 'readwrite');
        const completionPromise = transactionCompleteWait(transactionData);

        transactionData.objectStore(registryStoreName).put({
            key: registryRecordKey,
            storageName: configurationOptions.storageName,
            apiUrl: normalizedApiUrl.href,
            csrfToken: configurationOptions.csrfToken,
            updatedAt: new Date().toISOString()
        });
        await completionPromise;

    } finally {
        registryDatabase.close();

    }

}

/**
 * @param {{appId: string, indexedDb?: IDBFactory}} clearOptions
 */
export async function layerWorkerOutboxConfigurationClear(clearOptions) {
    //Rejecting malformed logout cleanup requests before opening the registry.
    if (clearOptions === null || typeof clearOptions !== 'object') {
        throw new LayerStorageError('WORKER_OUTBOX_CONFIG_INVALID', 'Worker outbox configuration is invalid.');

    }

    const indexedDb = clearOptions.indexedDb ?? globalThis.indexedDB;

    if (indexedDb === undefined || !applicationIdentifierPattern.test(clearOptions.appId)) {
        throw new LayerStorageError('WORKER_OUTBOX_CONFIG_INVALID', 'Worker outbox configuration is invalid.');

    }

    const registryDatabase = /** @type {IDBDatabase} */ (await databaseOpen(
        indexedDb,
        registryDatabaseNameCreate(clearOptions.appId),
        true
    ));

    try {
        const transactionData = registryDatabase.transaction([registryStoreName], 'readwrite');
        const completionPromise = transactionCompleteWait(transactionData);
        transactionData.objectStore(registryStoreName).delete(registryRecordKey);
        await completionPromise;

    } finally {
        registryDatabase.close();

    }

}

/**
 * @param {IDBFactory} indexedDb
 * @param {string} appId
 */
async function configurationRead(indexedDb, appId) {
    const registryDatabase = /** @type {IDBDatabase} */ (await databaseOpen(
        indexedDb,
        registryDatabaseNameCreate(appId),
        true
    ));

    try {
        const transactionData = registryDatabase.transaction([registryStoreName], 'readonly');
        const configurationData = await requestResultGet(
            transactionData.objectStore(registryStoreName).get(registryRecordKey)
        );
        await transactionCompleteWait(transactionData);

        if (typeof configurationData !== 'object' || configurationData === null) {
            return null;

        }

        return /** @type {Record<string, unknown>} */ (configurationData);

    } finally {
        registryDatabase.close();

    }

}

/**
 * @param {Response} responseData
 * @param {number} maximumBytes
 */
async function responseJsonRead(responseData, maximumBytes) {
    const declaredLength = Number(responseData.headers.get('content-length'));

    if (responseData.body === null ||
        !String(responseData.headers.get('content-type')).toLowerCase().startsWith('application/json')) {
        throw Object.assign(new Error('Worker API response is invalid.'), {
            code: 'API_RESPONSE_INVALID',
            retryable: false,
            status: responseData.status
        });

    }

    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        throw Object.assign(new Error('Worker API response is too large.'), {
            code: 'API_RESPONSE_TOO_LARGE',
            retryable: false,
            status: responseData.status
        });

    }

    const responseReader = responseData.body.getReader();
    const responseChunks = [];
    let responseBytes = 0;

    try {
        while (true) {
            const readResult = await responseReader.read();

            if (readResult.done) {
                break;

            }

            responseBytes += readResult.value.byteLength;

            if (responseBytes > maximumBytes) {
                await responseReader.cancel();
                throw Object.assign(new Error('Worker API response is too large.'), {
                    code: 'API_RESPONSE_TOO_LARGE',
                    retryable: false,
                    status: responseData.status
                });

            }

            responseChunks.push(readResult.value);

        }

    } finally {
        responseReader.releaseLock();

    }

    const responseBuffer = new Uint8Array(responseBytes);
    let responseOffset = 0;

    for (const responseChunk of responseChunks) {
        responseBuffer.set(responseChunk, responseOffset);
        responseOffset += responseChunk.byteLength;

    }

    try {
        //Parsing only the complete bounded response document.
        const responseBody = JSON.parse(new TextDecoder().decode(responseBuffer));

        if (typeof responseBody !== 'object' || responseBody === null || Array.isArray(responseBody)) {
            throw new Error('The worker API response must be an object.');

        }

        return /** @type {Record<string, unknown>} */ (responseBody);

    } catch (parseError) {
        throw Object.assign(new Error('Worker API response JSON is invalid.'), {
            code: 'API_RESPONSE_INVALID',
            retryable: false,
            status: responseData.status,
            cause: parseError
        });

    }

}

/**
 * @param {Headers} responseHeaders
 */
function retryAfterMillisecondsGet(responseHeaders) {
    const retryAfterHeader = responseHeaders.get('retry-after');

    if (retryAfterHeader === null) {
        return 0;

    }

    const retryAfterSeconds = Number(retryAfterHeader);

    //Accepting only bounded delta-seconds from the same-origin API response.
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
        return 0;

    }

    return Math.min(3600000, Math.ceil(retryAfterSeconds * 1000));

}

/**
 * @param {Record<string, unknown>} commandRecord
 */
function commandRecordCheck(commandRecord) {
    /** @type {string | undefined} */
    let serializedPayload;

    try {
        //Serializing once to reject cyclic, BigInt, and other non-JSON durable values.
        serializedPayload = JSON.stringify(commandRecord.payload);

    } catch (serializationError) {
        //Using the caught value only to make the intentional quarantine path explicit.
        void serializationError;

        return false;

    }

    if (serializedPayload === undefined) {
        return false;

    }

    const payloadBytes = new TextEncoder().encode(serializedPayload).byteLength;

    //Rejecting corrupted durable records before they can become network requests.
    return typeof commandRecord.commandId === 'string' &&
        commandRecord.commandId.length >= 1 && commandRecord.commandId.length <= 160 &&
        typeof commandRecord.operation === 'string' && operationNamePattern.test(commandRecord.operation) &&
        typeof commandRecord.payload === 'object' && commandRecord.payload !== null &&
        !Array.isArray(commandRecord.payload) &&
        !Object.hasOwn(commandRecord.payload, 'commandId') &&
        !Object.hasOwn(commandRecord.payload, 'baseRevision') &&
        typeof commandRecord.baseRevision === 'number' &&
        Number.isSafeInteger(commandRecord.baseRevision) && commandRecord.baseRevision >= 0 &&
        typeof commandRecord.conflictDomain === 'string' &&
        conflictDomainPattern.test(commandRecord.conflictDomain) &&
        typeof commandRecord.attempts === 'number' && Number.isSafeInteger(commandRecord.attempts) &&
        commandRecord.attempts >= 0 && typeof commandRecord.createdAt === 'string' &&
        Number.isFinite(Date.parse(commandRecord.createdAt)) && payloadBytes <= 262144;

}

/**
 * @param {Response} responseData
 * @param {Record<string, unknown>} responseBody
 * @param {string} requestIdentifier
 */
function responseEnvelopeResultCreate(responseData, responseBody, requestIdentifier) {
    //Rejecting a response that cannot be correlated with this durable attempt.
    if (responseBody.requestId !== requestIdentifier) {
        throw Object.assign(new Error('Worker API requestId mismatch.'), {
            code: 'API_RESPONSE_MISMATCH',
            status: responseData.status,
            retryable: false,
            requestId: requestIdentifier
        });

    }

    const rootKeysValid = Object.keys(responseBody).every(function responseRootKeyCheck(keyData) {
        //Allowing only fields declared by success and error response envelopes.
        return ['protocol', 'requestId', 'ok', 'data', 'meta', 'error'].includes(keyData);

    });
    let errorData = /** @type {Record<string, unknown> | null} */ (null);

    if (typeof responseBody.error === 'object' && responseBody.error !== null &&
        !Array.isArray(responseBody.error)) {
        errorData = /** @type {Record<string, unknown>} */ (responseBody.error);

    }

    const errorKeysValid = errorData !== null && Object.keys(errorData).every(function errorKeyCheck(keyData) {
        //Allowing only the stable public Layer error contract.
        return ['code', 'message', 'retryable', 'details'].includes(keyData);

    });
    const errorDetailsValid = errorData !== null &&
        (errorData.details === null ||
            (typeof errorData.details === 'object' && !Array.isArray(errorData.details)));
    const errorResponseStatus = rootKeysValid && responseBody.protocol === LAYER_PROTOCOL_VERSION &&
        responseBody.ok === false && errorData !== null && errorKeysValid &&
        responseBody.data === undefined && responseBody.meta === undefined &&
        typeof errorData.code === 'string' && layerErrorCodeSet.has(errorData.code) &&
        typeof errorData.message === 'string' && errorData.message.length >= 1 &&
        errorData.message.length <= 500 && typeof errorData.retryable === 'boolean' && errorDetailsValid;

    if (errorResponseStatus && errorData !== null) {
        //Publishing a safe protocol failure to the durable command state.
        throw Object.assign(new Error(String(errorData.message)), {
            code: errorData.code,
            status: responseData.status,
            retryable: errorData.retryable,
            retryAfterMs: retryAfterMillisecondsGet(responseData.headers),
            details: errorData.details,
            requestId: requestIdentifier
        });

    }

    const metaDataValid = responseBody.meta === undefined ||
        (typeof responseBody.meta === 'object' && responseBody.meta !== null && !Array.isArray(responseBody.meta));
    const successResponseStatus = responseData.ok && rootKeysValid &&
        responseBody.protocol === LAYER_PROTOCOL_VERSION && responseBody.ok === true &&
        Object.hasOwn(responseBody, 'data') && metaDataValid && responseBody.error === undefined;

    if (!successResponseStatus) {
        throw Object.assign(new Error('Worker API response contract is invalid.'), {
            code: 'API_RESPONSE_INVALID',
            status: responseData.status,
            retryable: responseData.status === 408 || responseData.status === 425 ||
                responseData.status === 429 || responseData.status >= 500,
            retryAfterMs: retryAfterMillisecondsGet(responseData.headers),
            requestId: requestIdentifier
        });

    }

    //CallBack THE OBJECT
    return {
        requestId: requestIdentifier,
        data: structuredClone(responseBody.data),
        meta: structuredClone(responseBody.meta ?? {})
    };

}

/**
 * @param {unknown} commandError
 */
function commandFailureCreate(commandError) {
    let errorData = /** @type {Record<string, unknown>} */ ({});

    if (typeof commandError === 'object' && commandError !== null) {
        errorData = /** @type {Record<string, unknown>} */ (commandError);

    }

    const errorStatus = Number(errorData.status);
    let failureStatus = 'failed';
    let failureCode = 'COMMAND_FAILED';

    if (typeof errorData.code === 'string') {
        failureCode = errorData.code;

    } else if (commandError instanceof TypeError) {
        failureCode = 'API_NETWORK_FAILED';

    } else if (errorData.name === 'AbortError') {
        failureCode = 'API_NETWORK_FAILED';

    }

    if (errorStatus === 409 || failureCode === 'CONFLICT' || failureCode === 'REVISION_CONFLICT') {
        failureStatus = 'conflict';

    } else if (errorData.retryable === true || commandError instanceof TypeError ||
        errorData.name === 'AbortError' || errorStatus === 408 || errorStatus === 425 ||
        errorStatus === 429 || errorStatus >= 500) {
        failureStatus = 'retryable';

    }

    let failureDetails = /** @type {Record<string, unknown> | null} */ (null);
    let requestIdentifier = /** @type {string | null} */ (null);

    if (failureStatus === 'conflict' && typeof errorData.details === 'object' && errorData.details !== null) {
        failureDetails = /** @type {Record<string, unknown>} */ (errorData.details);

    }

    if (typeof errorData.requestId === 'string') {
        requestIdentifier = errorData.requestId;

    }

    return Object.freeze({
        status: failureStatus,
        failure: {
            code: failureCode,
            requestId: requestIdentifier,
            retryAfterMs: Math.max(0, Math.min(3600000, Number(errorData.retryAfterMs) || 0)),
            retryable: failureStatus === 'retryable',
            details: failureDetails
        }
    });

}

/**
 * @param {object} drainOptions
 * @param {string} drainOptions.appId
 * @param {string} drainOptions.applicationOrigin
 * @param {typeof fetch} [drainOptions.fetchImplementation]
 * @param {IDBFactory} [drainOptions.indexedDb]
 * @param {() => string} drainOptions.requestIdCreate
 * @param {() => string} drainOptions.ownerIdCreate
 * @param {() => Date} [drainOptions.clock]
 * @param {number} [drainOptions.concurrency]
 * @param {number} [drainOptions.timeoutMs]
 */
export function layerWorkerOutboxDrainCreate(drainOptions) {
    //Rejecting incomplete worker integrations before reading global browser APIs.
    if (drainOptions === null || typeof drainOptions !== 'object') {
        throw new TypeError('Worker outbox drain options are invalid.');

    }

    const indexedDb = drainOptions.indexedDb ?? globalThis.indexedDB;
    const fetchImplementation = drainOptions.fetchImplementation ?? globalThis.fetch;
    const clock = drainOptions.clock ?? function workerOutboxClockRead() {
        //Providing one UTC clock for worker leases and completion records.
        return new Date();

    };
    const concurrency = drainOptions.concurrency ?? 4;
    const timeoutMs = drainOptions.timeoutMs ?? 15000;

    if (indexedDb === undefined || typeof fetchImplementation !== 'function' ||
        !applicationIdentifierPattern.test(drainOptions.appId) ||
        typeof drainOptions.applicationOrigin !== 'string' ||
        typeof drainOptions.requestIdCreate !== 'function' ||
        typeof drainOptions.ownerIdCreate !== 'function' ||
        !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
        throw new TypeError('Worker outbox drain options are invalid.');

    }

    return async function workerOutboxDrain() {
        const configurationData = await configurationRead(indexedDb, drainOptions.appId);

        if (configurationData === null) {
            return Object.freeze({
                configured: false,
                claimed: 0,
                confirmed: 0,
                retryable: 0,
                conflicted: 0,
                failed: 0
            });

        }

        const storageName = String(configurationData.storageName);
        const apiUrl = new URL(String(configurationData.apiUrl), drainOptions.applicationOrigin);
        const csrfToken = configurationData.csrfToken;

        if (!storageName.startsWith(`layer:${drainOptions.appId}:`) ||
            apiUrl.origin !== drainOptions.applicationOrigin ||
            !['http:', 'https:'].includes(apiUrl.protocol) ||
            (csrfToken !== null &&
                (typeof csrfToken !== 'string' || csrfToken.length < 1 || csrfToken.length > 4096))) {
            throw new LayerStorageError('WORKER_OUTBOX_CONFIG_INVALID', 'Stored worker outbox configuration is invalid.');

        }

        const ownerIdentifier = drainOptions.ownerIdCreate();

        if (typeof ownerIdentifier !== 'string' || ownerIdentifier.length < 1 || ownerIdentifier.length > 160) {
            throw new TypeError('Worker outbox owner factory returned an invalid identifier.');

        }

        const applicationDatabase = /** @type {IDBDatabase} */ (await databaseOpen(
            indexedDb,
            storageName,
            false
        ));

        if (!applicationDatabase.objectStoreNames.contains(layerSystemStoreNames.outbox)) {
            applicationDatabase.close();
            throw new LayerStorageError('WORKER_OUTBOX_STORE_MISSING', 'The configured outbox store is unavailable.');

        }

        const claimTime = clock();
        const leaseUntil = new Date(claimTime.getTime() + workerLeaseMilliseconds).toISOString();
        const claimTransaction = applicationDatabase.transaction([layerSystemStoreNames.outbox], 'readwrite');
        const claimCompletion = transactionCompleteWait(claimTransaction);
        const outboxStore = claimTransaction.objectStore(layerSystemStoreNames.outbox);
        const commandRecords = /** @type {Record<string, unknown>[]} */ (await requestResultGet(outboxStore.getAll()));
        const blockedDomains = new Set();
        const selectedDomains = new Set();
        const claimedRecords = /** @type {Record<string, unknown>[]} */ ([]);
        let invalidRecordCount = 0;

        //Blocking conflict domains already owned by a conflict or active page/worker lease.
        for (const commandRecord of commandRecords) {
            const commandStatus = String(commandRecord.status);
            const activeLease = commandStatus === 'sending' &&
                typeof commandRecord.leaseUntil === 'string' &&
                commandRecord.leaseUntil > claimTime.toISOString();

            if (commandStatus === 'conflict' || activeLease) {
                blockedDomains.add(String(commandRecord.conflictDomain));

            }

        }

        commandRecords.sort(function commandCreatedSort(firstRecord, secondRecord) {
            //Preserving original durable intent order across conflict domains.
            return String(firstRecord.createdAt).localeCompare(String(secondRecord.createdAt));

        });

        for (const commandRecord of commandRecords) {
            const commandStatus = String(commandRecord.status);
            const expiredLease = commandStatus === 'sending' &&
                typeof commandRecord.leaseUntil === 'string' &&
                commandRecord.leaseUntil <= claimTime.toISOString();
            const claimableStatus = ['queued', 'retryable'].includes(commandStatus) || expiredLease;
            const conflictDomain = String(commandRecord.conflictDomain);

            if (!claimableStatus) {
                //Next the cycle
                continue;

            }

            if (!commandRecordCheck(commandRecord)) {
                //Quarantining corrupted intent instead of creating an unsafe request.
                outboxStore.put({
                    ...commandRecord,
                    status: 'failed',
                    updatedAt: claimTime.toISOString(),
                    leaseOwner: null,
                    leaseUntil: null,
                    failure: {
                        code: 'OUTBOX_RECORD_INVALID',
                        requestId: null,
                        retryAfterMs: 0,
                        retryable: false,
                        details: null
                    }
                });
                invalidRecordCount += 1;

                //Next the cycle
                continue;

            }

            if (blockedDomains.has(conflictDomain) || selectedDomains.has(conflictDomain)) {
                //Next the cycle
                continue;

            }

            const claimedRecord = {
                ...commandRecord,
                status: 'sending',
                attempts: Number(commandRecord.attempts) + 1,
                updatedAt: claimTime.toISOString(),
                leaseOwner: ownerIdentifier,
                leaseUntil
            };
            outboxStore.put(claimedRecord);
            claimedRecords.push(claimedRecord);
            selectedDomains.add(conflictDomain);

            if (claimedRecords.length >= concurrency) {
                break;

            }

        }

        await claimCompletion;
        const completionCounts = {
            confirmed: 0,
            retryable: 0,
            conflict: 0,
            failed: invalidRecordCount
        };

        await Promise.all(claimedRecords.map(async function claimedCommandSend(commandRecord) {
            let completionStatus = 'confirmed';
            let completionData;

            try {
                const requestIdentifier = drainOptions.requestIdCreate();

                if (!requestIdentifierPattern.test(requestIdentifier)) {
                    throw Object.assign(new Error('Worker requestId factory returned an invalid UUID.'), {
                        code: 'WORKER_REQUEST_ID_INVALID',
                        retryable: false
                    });

                }

                const requestHeaders = new Headers({
                    accept: 'application/json',
                    'content-type': 'application/json'
                });

                if (typeof csrfToken === 'string') {
                    requestHeaders.set('x-layer-csrf', csrfToken);

                }

                const requestController = new AbortController();
                let timeoutStatus = false;
                const timeoutIdentifier = setTimeout(function workerCommandTimeoutHandle() {
                    //Stopping a worker request at the declared command deadline.
                    timeoutStatus = true;
                    requestController.abort();

                }, timeoutMs);
                let responseData;

                try {
                    responseData = await fetchImplementation(apiUrl.href, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: requestHeaders,
                        body: JSON.stringify({
                            protocol: LAYER_PROTOCOL_VERSION,
                            requestId: requestIdentifier,
                            type: 'command',
                            operation: commandRecord.operation,
                            payload: {
                                .../** @type {Record<string, unknown>} */ (commandRecord.payload),
                                commandId: commandRecord.commandId,
                                baseRevision: commandRecord.baseRevision
                            }
                        }),
                        signal: requestController.signal
                    });

                    if (timeoutStatus) {
                        throw new Error('Worker command response arrived after its deadline.');

                    }

                } catch (transportError) {
                    if (timeoutStatus) {
                        throw Object.assign(new Error('Worker API request timed out.'), {
                            code: 'API_TIMEOUT',
                            status: 408,
                            retryable: true,
                            requestId: requestIdentifier,
                            cause: transportError
                        });

                    }

                    throw transportError;

                } finally {
                    clearTimeout(timeoutIdentifier);

                }

                const responseBody = await responseJsonRead(responseData, workerResponseMaximumBytes);
                const responseResult = responseEnvelopeResultCreate(
                    responseData,
                    responseBody,
                    requestIdentifier
                );

                completionData = {
                    result: responseResult,
                    failure: null
                };

            } catch (commandError) {
                const failureData = commandFailureCreate(commandError);
                completionStatus = failureData.status;
                completionData = {
                    failure: failureData.failure
                };

            }

            const completionTransaction = applicationDatabase.transaction(
                [layerSystemStoreNames.outbox],
                'readwrite'
            );
            const completionPromise = transactionCompleteWait(completionTransaction);
            const completionStore = completionTransaction.objectStore(layerSystemStoreNames.outbox);
            const currentRecord = /** @type {Record<string, unknown> | undefined} */ (
                await requestResultGet(completionStore.get(String(commandRecord.commandId)))
            );

            if (currentRecord !== undefined && currentRecord.leaseOwner === ownerIdentifier) {
                completionStore.put({
                    ...currentRecord,
                    ...completionData,
                    status: completionStatus,
                    updatedAt: clock().toISOString(),
                    leaseOwner: null,
                    leaseUntil: null
                });

            }

            await completionPromise;
            const typedStatus = /** @type {'confirmed' | 'retryable' | 'conflict' | 'failed'} */ (completionStatus);
            completionCounts[typedStatus] += 1;

        }));
        applicationDatabase.close();

        return Object.freeze({
            configured: true,
            claimed: claimedRecords.length,
            confirmed: completionCounts.confirmed,
            retryable: completionCounts.retryable,
            conflicted: completionCounts.conflict,
            failed: completionCounts.failed
        });

    };

}
