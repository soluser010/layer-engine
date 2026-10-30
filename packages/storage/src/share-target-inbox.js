import {LayerStorageError} from './storage-error.js';

const applicationIdentifierPattern = /^[a-z][a-z0-9_-]{0,79}$/;
const parameterNamePattern = /^[A-Za-z0-9_.-]{1,80}$/;
const shareIdentifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shareTargetStoreName = 'inbox';
const defaultMaximumRequestBytes = 16 * 1024 * 1024;
const defaultMaximumFileBytes = 8 * 1024 * 1024;
const defaultMaximumFiles = 8;
const defaultMaximumTextBytes = 64 * 1024;
const defaultMaximumRecords = 64;
const defaultRetentionMilliseconds = 10 * 60 * 1000;

/**
 * @typedef {Readonly<{
 *     field: string,
 *     name: string,
 *     type: string,
 *     size: number,
 *     lastModified: number,
 *     blob: Blob
 * }>} LayerShareTargetFile
 */

/**
 * @typedef {Readonly<{
 *     shareId: string,
 *     createdAt: number,
 *     expiresAt: number,
 *     title: string | null,
 *     text: string | null,
 *     url: string | null,
 *     files: readonly LayerShareTargetFile[]
 * }>} LayerShareTargetRecord
 */

/**
 * @typedef {Readonly<{
 *     consume: (shareIdentifier: string) => Promise<LayerShareTargetRecord | null>,
 *     discard: (shareIdentifier: string) => Promise<boolean>,
 *     purge: () => Promise<void>
 * }>} LayerShareTargetInbox
 */

/**
 * @param {unknown} objectData
 */
function plainObjectCheck(objectData) {
    //Rejecting arrays and custom prototypes before reading persistent metadata.
    if (typeof objectData !== 'object' || objectData === null || Array.isArray(objectData)) {
        return false;

    }

    const objectPrototype = Object.getPrototypeOf(objectData);

    return objectPrototype === Object.prototype || objectPrototype === null;

}

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
            //Preserving the native cause behind a stable storage boundary.
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
            //Resolving only after the share record mutation is committed.
            resolve(undefined);

        }, {once: true});
        transactionData.addEventListener('abort', function transactionAbort() {
            //Rejecting an explicitly aborted temporary inbox transaction.
            reject(transactionData.error ?? new Error('IndexedDB transaction aborted.'));

        }, {once: true});
        transactionData.addEventListener('error', function transactionFailure() {
            //Rejecting a failed temporary inbox transaction.
            reject(transactionData.error ?? new Error('IndexedDB transaction failed.'));

        }, {once: true});

    });

}

/**
 * @param {IDBFactory} indexedDb
 * @param {string} databaseName
 */
function shareTargetDatabaseOpen(indexedDb, databaseName) {
    return new Promise(function shareTargetDatabaseOpenWait(resolve, reject) {
        const openRequest = indexedDb.open(databaseName, 1);

        openRequest.addEventListener('upgradeneeded', function shareTargetDatabaseUpgrade() {
            //Creating one engine-owned temporary inbox with an expiration index.
            if (!openRequest.result.objectStoreNames.contains(shareTargetStoreName)) {
                const inboxStore = openRequest.result.createObjectStore(shareTargetStoreName, {
                    keyPath: 'shareId'
                });
                inboxStore.createIndex('expiresAt', 'expiresAt');

            }

        });
        openRequest.addEventListener('success', function shareTargetDatabaseOpenSuccess() {
            //Returning the isolated application inbox after schema readiness.
            resolve(openRequest.result);

        }, {once: true});
        openRequest.addEventListener('error', function shareTargetDatabaseOpenFailure() {
            //Passing the native database failure through the stable Layer error.
            reject(new LayerStorageError(
                'SHARE_TARGET_STORAGE_FAILED',
                'The temporary share inbox could not be opened.',
                {cause: openRequest.error}
            ));

        }, {once: true});

    });

}

/**
 * @param {IDBFactory} indexedDb
 * @param {string} databaseName
 */
function shareTargetDatabaseDelete(indexedDb, databaseName) {
    return new Promise(function shareTargetDatabaseDeleteWait(resolve, reject) {
        const deleteRequest = indexedDb.deleteDatabase(databaseName);

        deleteRequest.addEventListener('success', function shareTargetDatabaseDeleteSuccess() {
            //Confirming removal of all temporary shared content.
            resolve(undefined);

        }, {once: true});
        deleteRequest.addEventListener('blocked', function shareTargetDatabaseDeleteBlocked() {
            //Failing explicitly when another page still owns the temporary inbox.
            reject(new LayerStorageError(
                'SHARE_TARGET_STORAGE_BLOCKED',
                'The temporary share inbox is still open.'
            ));

        }, {once: true});
        deleteRequest.addEventListener('error', function shareTargetDatabaseDeleteFailure() {
            //Passing the database deletion failure without exposing stored content.
            reject(new LayerStorageError(
                'SHARE_TARGET_STORAGE_FAILED',
                'The temporary share inbox could not be deleted.',
                {cause: deleteRequest.error}
            ));

        }, {once: true});

    });

}

/**
 * @param {string} appId
 */
function shareTargetDatabaseNameCreate(appId) {
    //Separating incoming shares from user data and worker configuration databases.
    return 'layer-share-target:' + appId;

}

/**
 * @param {unknown} valueData
 * @param {number} defaultValue
 * @param {number} maximumValue
 */
function positiveLimitNormalize(valueData, defaultValue, maximumValue) {
    const normalizedValue = valueData ?? defaultValue;

    //Bounding caller-provided budgets before reading request bytes or IndexedDB records.
    if (typeof normalizedValue !== 'number' || !Number.isSafeInteger(normalizedValue) ||
        normalizedValue < 1 || normalizedValue > maximumValue) {
        throw new TypeError('A Share Target storage limit is invalid.');

    }

    return normalizedValue;

}

/**
 * @param {unknown} shareTargetData
 */
function shareTargetContractNormalize(shareTargetData) {
    if (!plainObjectCheck(shareTargetData)) {
        throw new TypeError('The Share Target contract is invalid.');

    }

    const shareTargetRecord = /** @type {Record<string, any>} */ (shareTargetData);
    const shareParameterData = shareTargetRecord.params;

    if (typeof shareTargetRecord.action !== 'string' || !shareTargetRecord.action.startsWith('/') ||
        shareTargetRecord.action.startsWith('//') || shareTargetRecord.action.includes('\\') ||
        shareTargetRecord.method !== 'POST' ||
        !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(shareTargetRecord.enctype) ||
        !plainObjectCheck(shareParameterData)) {
        throw new TypeError('The Share Target contract is invalid.');

    }

    const shareParameterRecord = /** @type {Record<string, any>} */ (shareParameterData);
    const normalizedParameters = /** @type {Record<string, any>} */ ({});
    const declaredFieldNames = new Set();

    for (const parameterType of ['title', 'text', 'url']) {
        const fieldName = shareParameterRecord[parameterType];

        if (fieldName !== undefined) {
            if (typeof fieldName !== 'string' || !parameterNamePattern.test(fieldName) ||
                declaredFieldNames.has(fieldName)) {
                throw new TypeError('A Share Target text field is invalid.');

            }

            declaredFieldNames.add(fieldName);
            normalizedParameters[parameterType] = fieldName;

        }

    }

    if (shareParameterRecord.files !== undefined) {
        if (shareTargetRecord.enctype !== 'multipart/form-data' ||
            !Array.isArray(shareParameterRecord.files) ||
            shareParameterRecord.files.length < 1 || shareParameterRecord.files.length > 16) {
            throw new TypeError('The Share Target file fields are invalid.');

        }

        normalizedParameters.files = Object.freeze(shareParameterRecord.files.map(function shareFileNormalize(
            fileData
        ) {
            if (!plainObjectCheck(fileData)) {
                throw new TypeError('A Share Target file field is invalid.');

            }

            const fileRecord = /** @type {Record<string, any>} */ (fileData);

            if (typeof fileRecord.name !== 'string' || !parameterNamePattern.test(fileRecord.name) ||
                declaredFieldNames.has(fileRecord.name) || !Array.isArray(fileRecord.accept) ||
                fileRecord.accept.length < 1 || fileRecord.accept.length > 32 ||
                !fileRecord.accept.every(function fileAcceptValueCheck(acceptData) {
                    //Accepting only normalized MIME types or bounded dot-prefixed extensions.
                    return typeof acceptData === 'string' &&
                        (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(acceptData) ||
                            /^\.[A-Za-z0-9][A-Za-z0-9._+-]{0,15}$/.test(acceptData));

                })) {
                throw new TypeError('A Share Target file field is invalid.');

            }

            declaredFieldNames.add(fileRecord.name);

            return Object.freeze({
                name: fileRecord.name,
                accept: Object.freeze([...fileRecord.accept])
            });

        }));

    }

    if (Object.keys(normalizedParameters).length < 1 ||
        Object.keys(shareParameterRecord).some(function shareParameterUnknownCheck(parameterName) {
            //Rejecting unknown parameter kinds instead of silently discarding shared content.
            return !['files', 'text', 'title', 'url'].includes(parameterName);

        })) {
        throw new TypeError('The Share Target parameters are invalid.');

    }

    return Object.freeze({
        action: shareTargetRecord.action,
        method: 'POST',
        enctype: shareTargetRecord.enctype,
        params: Object.freeze(normalizedParameters),
        fieldNames: Object.freeze([...declaredFieldNames])
    });

}

/**
 * @param {Request} requestData
 * @param {number} maximumRequestBytes
 */
async function requestBodyRead(requestData, maximumRequestBytes) {
    const contentLengthHeader = requestData.headers.get('content-length');

    if (contentLengthHeader !== null) {
        const contentLength = Number(contentLengthHeader);

        //Rejecting a declared oversized body before consuming its stream.
        if (!Number.isSafeInteger(contentLength) || contentLength < 0 ||
            contentLength > maximumRequestBytes) {
            throw new LayerStorageError(
                'SHARE_TARGET_SIZE_EXCEEDED',
                'The shared request exceeds its byte budget.'
            );

        }

    }

    const requestReader = requestData.body?.getReader();

    if (requestReader === undefined) {
        const requestBuffer = new Uint8Array(await requestData.arrayBuffer());

        if (requestBuffer.byteLength > maximumRequestBytes) {
            throw new LayerStorageError(
                'SHARE_TARGET_SIZE_EXCEEDED',
                'The shared request exceeds its byte budget.'
            );

        }

        return requestBuffer;

    }

    const requestChunks = [];
    let requestByteLength = 0;

    while (true) {
        const requestChunkResult = await requestReader.read();

        if (requestChunkResult.done) {
            break;

        }

        const requestChunk = requestChunkResult.value;

        requestByteLength += requestChunk.byteLength;

        if (requestByteLength > maximumRequestBytes) {
            try {
                //Cancelling the remaining upload after the request crosses its budget.
                await requestReader.cancel();

            } catch (requestCancelError) {
                //Preserving the primary size failure when stream cancellation also fails.
                void requestCancelError;

            }

            throw new LayerStorageError(
                'SHARE_TARGET_SIZE_EXCEEDED',
                'The shared request exceeds its byte budget.'
            );

        }

        requestChunks.push(requestChunk);

    }

    const requestBytes = new Uint8Array(requestByteLength);
    let requestByteOffset = 0;

    for (const requestChunk of requestChunks) {
        //Copying each bounded chunk into one parser input buffer.
        requestBytes.set(requestChunk, requestByteOffset);
        requestByteOffset += requestChunk.byteLength;

    }

    return requestBytes;

}

/**
 * @param {FormData} formData
 * @param {string | undefined} fieldName
 * @param {number} maximumTextBytes
 */
function shareTextFieldRead(formData, fieldName, maximumTextBytes) {
    //Returning an explicit absence when the manifest does not declare this field.
    if (fieldName === undefined) {
        return null;

    }

    const fieldValues = formData.getAll(fieldName);

    if (fieldValues.length < 1) {
        return null;

    }

    if (fieldValues.length !== 1 || typeof fieldValues[0] !== 'string' ||
        new TextEncoder().encode(fieldValues[0]).byteLength > maximumTextBytes) {
        throw new LayerStorageError(
            'SHARE_TARGET_FIELD_INVALID',
            'A shared text field is invalid.'
        );

    }

    return fieldValues[0];

}

/**
 * @param {string} fileName
 * @param {string} fileType
 * @param {readonly string[]} acceptedTypes
 */
function sharedFileAcceptCheck(fileName, fileType, acceptedTypes) {
    const normalizedName = fileName.toLowerCase();
    const normalizedType = fileType.toLowerCase();

    //Matching either the exact MIME type or a declared filename extension.
    return acceptedTypes.some(function sharedFileAcceptMatch(acceptData) {
        //Selecting extension matching only for dot-prefixed accept entries.
        if (acceptData.startsWith('.')) {
            return normalizedName.endsWith(acceptData.toLowerCase());

        }

        return normalizedType === acceptData.toLowerCase();

    });

}

/**
 * @param {FormData} formData
 * @param {readonly Readonly<{name: string, accept: readonly string[]}>[]} fileFields
 * @param {number} maximumFileBytes
 * @param {number} maximumFiles
 * @returns {Promise<Array<{
 *     field: string,
 *     name: string,
 *     type: string,
 *     size: number,
 *     lastModified: number,
 *     bytes: ArrayBuffer
 * }>>}
 */
async function sharedFilesRead(formData, fileFields, maximumFileBytes, maximumFiles) {
    const sharedFiles = [];

    for (const fileField of fileFields) {
        const fieldValues = formData.getAll(fileField.name);

        for (const fieldValue of fieldValues) {
            if (typeof fieldValue === 'string' || typeof fieldValue.size !== 'number' ||
                typeof fieldValue.type !== 'string' || fieldValue.size < 1 ||
                fieldValue.size > maximumFileBytes || sharedFiles.length >= maximumFiles) {
                throw new LayerStorageError(
                    'SHARE_TARGET_FILE_INVALID',
                    'A shared file is invalid or exceeds its budget.'
                );

            }

            let fileName = 'shared-file';

            if (typeof /** @type {any} */ (fieldValue).name === 'string') {
                //Removing any submitted path segments before persisting the browser filename.
                fileName = /** @type {any} */ (fieldValue).name.replaceAll('\\', '/').split('/').at(-1);

            }

            if (typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 255 ||
                fileName.includes('\0') ||
                !sharedFileAcceptCheck(fileName, fieldValue.type, fileField.accept)) {
                throw new LayerStorageError(
                    'SHARE_TARGET_FILE_INVALID',
                    'A shared file does not match the declared contract.'
                );

            }

            let lastModified = 0;

            if (Number.isSafeInteger(/** @type {any} */ (fieldValue).lastModified) &&
            /** @type {any} */ (fieldValue).lastModified >= 0) {
                //Preserving valid browser file time metadata without trusting arbitrary values.
                lastModified = /** @type {any} */ (fieldValue).lastModified;

            }

            //Materializing bounded bytes because WebKit cannot reliably clone File/Blob into IndexedDB.
            const fileBytes = await fieldValue.arrayBuffer();

            if (fileBytes.byteLength !== fieldValue.size) {
                throw new LayerStorageError(
                    'SHARE_TARGET_FILE_INVALID',
                    'A shared file changed while it was being read.'
                );

            }

            sharedFiles.push({
                field: fileField.name,
                name: fileName,
                type: fieldValue.type,
                size: fieldValue.size,
                lastModified,
                bytes: fileBytes
            });

        }

    }

    return sharedFiles;

}

/**
 * @param {IDBObjectStore} inboxStore
 * @param {number} currentTime
 */
function expiredSharesDelete(inboxStore, currentTime) {
    return new Promise(function expiredSharesDeleteWait(resolve, reject) {
        const cursorRequest = inboxStore.openCursor();

        cursorRequest.addEventListener('success', function expiredShareCursorMove() {
            const inboxCursor = cursorRequest.result;

            if (inboxCursor === null) {
                resolve(undefined);
                return;

            }

            const shareRecord = /** @type {Record<string, any>} */ (inboxCursor.value);

            if (typeof shareRecord.expiresAt !== 'number' || shareRecord.expiresAt <= currentTime) {
                //Deleting expired or corrupted temporary records during every inbox mutation.
                inboxCursor.delete();

            }

            inboxCursor.continue();

        });
        cursorRequest.addEventListener('error', function expiredShareCursorFailure() {
            //Passing an unexpected cleanup failure to the caller.
            reject(cursorRequest.error ?? new Error('Share inbox cleanup failed.'));

        }, {once: true});

    });

}

/**
 * @param {IDBObjectStore} inboxStore
 * @param {IDBTransaction} transactionData
 * @param {Record<string, unknown>} shareRecord
 * @param {number} maximumRecords
 */
function shareRecordStore(inboxStore, transactionData, shareRecord, maximumRecords) {
    return new Promise(function shareRecordStoreWait(resolve, reject) {
        const countRequest = inboxStore.count();

        countRequest.addEventListener('success', function shareRecordCountSuccess() {
            if (countRequest.result >= maximumRecords) {
                const capacityError = new LayerStorageError(
                    'SHARE_TARGET_INBOX_FULL',
                    'The temporary share inbox is full.'
                );

                //Aborting inside the active count task before another record can commit.
                reject(capacityError);
                transactionData.abort();

                return;

            }

            //Queuing the record inside the active count task before Safari can close the transaction.
            const addRequest = inboxStore.add(shareRecord);

            addRequest.addEventListener('success', function shareRecordAddSuccess() {
                //Confirming that the record request completed before transaction commit.
                resolve(undefined);

            }, {once: true});
            addRequest.addEventListener('error', function shareRecordAddFailure() {
                //Passing the native uniqueness or clone failure to the storage boundary.
                reject(addRequest.error ?? new Error('Share inbox write failed.'));

            }, {once: true});

        }, {once: true});
        countRequest.addEventListener('error', function shareRecordCountFailure() {
            //Passing an unexpected capacity read failure to the caller.
            reject(countRequest.error ?? new Error('Share inbox count failed.'));

        }, {once: true});

    });

}

/**
 * @param {unknown} shareData
 * @returns {LayerShareTargetRecord | null}
 */
function sharedRecordFreeze(shareData) {
    if (!plainObjectCheck(shareData)) {
        return null;

    }

    const shareRecord = /** @type {Record<string, any>} */ (shareData);

    if (!shareIdentifierPattern.test(shareRecord.shareId) ||
        typeof shareRecord.createdAt !== 'number' || typeof shareRecord.expiresAt !== 'number' ||
        !Array.isArray(shareRecord.files) ||
        (shareRecord.title !== null && typeof shareRecord.title !== 'string') ||
        (shareRecord.text !== null && typeof shareRecord.text !== 'string') ||
        (shareRecord.url !== null && typeof shareRecord.url !== 'string')) {
        return null;

    }

    const sharedFiles = /** @type {LayerShareTargetFile[]} */ ([]);

    for (const fileData of shareRecord.files) {
        if (!plainObjectCheck(fileData) || typeof fileData.field !== 'string' ||
            typeof fileData.name !== 'string' || typeof fileData.type !== 'string' ||
            !Number.isSafeInteger(fileData.size) || fileData.size < 1 ||
            !Number.isSafeInteger(fileData.lastModified) || fileData.lastModified < 0 ||
            !(fileData.bytes instanceof ArrayBuffer) || fileData.bytes.byteLength !== fileData.size) {
            return null;

        }

        //Reconstructing the public Blob from WebKit-compatible persisted bytes.
        const sharedBlob = new Blob([fileData.bytes], {
            type: String(fileData.type)
        });

        sharedFiles.push(Object.freeze({
            field: String(fileData.field),
            name: String(fileData.name),
            type: String(fileData.type),
            size: Number(fileData.size),
            lastModified: Number(fileData.lastModified),
            blob: sharedBlob
        }));

    }

    return Object.freeze({
        shareId: String(shareRecord.shareId),
        createdAt: Number(shareRecord.createdAt),
        expiresAt: Number(shareRecord.expiresAt),
        title: /** @type {string | null} */ (shareRecord.title),
        text: /** @type {string | null} */ (shareRecord.text),
        url: /** @type {string | null} */ (shareRecord.url),
        files: Object.freeze(sharedFiles)
    });

}

/**
 * @param {object} captureOptions
 * @param {string} captureOptions.appId
 * @param {string} captureOptions.applicationOrigin
 * @param {unknown} captureOptions.shareTarget
 * @param {() => string} captureOptions.shareIdCreate
 * @param {IDBFactory} [captureOptions.indexedDb]
 * @param {() => number} [captureOptions.clock]
 * @param {number} [captureOptions.maximumRequestBytes]
 * @param {number} [captureOptions.maximumFileBytes]
 * @param {number} [captureOptions.maximumFiles]
 * @param {number} [captureOptions.maximumTextBytes]
 * @param {number} [captureOptions.maximumRecords]
 * @param {number} [captureOptions.retentionMs]
 * @returns {(requestData: Request) => Promise<string>}
 */
export function layerWorkerShareTargetCaptureCreate(captureOptions) {
    if (!plainObjectCheck(captureOptions)) {
        throw new TypeError('Share Target capture options are invalid.');

    }

    const indexedDb = captureOptions.indexedDb ?? globalThis.indexedDB;
    const clock = captureOptions.clock ?? Date.now;
    const shareTarget = shareTargetContractNormalize(captureOptions.shareTarget);
    const maximumRequestBytes = positiveLimitNormalize(
        captureOptions.maximumRequestBytes,
        defaultMaximumRequestBytes,
        64 * 1024 * 1024
    );
    const maximumFileBytes = positiveLimitNormalize(
        captureOptions.maximumFileBytes,
        defaultMaximumFileBytes,
        maximumRequestBytes
    );
    const maximumFiles = positiveLimitNormalize(captureOptions.maximumFiles, defaultMaximumFiles, 32);
    const maximumTextBytes = positiveLimitNormalize(
        captureOptions.maximumTextBytes,
        defaultMaximumTextBytes,
        1024 * 1024
    );
    const maximumRecords = positiveLimitNormalize(captureOptions.maximumRecords, defaultMaximumRecords, 256);
    const retentionMs = positiveLimitNormalize(
        captureOptions.retentionMs,
        defaultRetentionMilliseconds,
        60 * 60 * 1000
    );

    if (indexedDb === undefined || !applicationIdentifierPattern.test(captureOptions.appId) ||
        typeof captureOptions.applicationOrigin !== 'string' ||
        typeof captureOptions.shareIdCreate !== 'function' || typeof clock !== 'function') {
        throw new TypeError('Share Target capture options are invalid.');

    }

    const applicationOrigin = new URL(captureOptions.applicationOrigin).origin;
    const shareActionUrl = new URL(shareTarget.action, applicationOrigin);
    const databaseName = shareTargetDatabaseNameCreate(captureOptions.appId);

    return async function shareTargetCapture(/** @type {Request} */ requestData) {
        if (!(requestData instanceof Request) || requestData.method !== 'POST') {
            throw new LayerStorageError(
                'SHARE_TARGET_REQUEST_INVALID',
                'The incoming Share Target request is invalid.'
            );

        }

        const requestUrl = new URL(requestData.url);
        const contentType = requestData.headers.get('content-type') ?? '';
        const requestMediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();

        if (requestUrl.origin !== applicationOrigin ||
            requestUrl.pathname + requestUrl.search !== shareActionUrl.pathname + shareActionUrl.search ||
            requestMediaType !== shareTarget.enctype) {
            throw new LayerStorageError(
                'SHARE_TARGET_REQUEST_INVALID',
                'The incoming Share Target request does not match the manifest.'
            );

        }

        const requestBytes = await requestBodyRead(requestData, maximumRequestBytes);
        let formData;

        try {
            //Parsing the already bounded body through the browser's standards implementation.
            formData = await new Response(requestBytes, {
                headers: {
                    'content-type': contentType
                }
            }).formData();

        } catch (formDataError) {
            throw new LayerStorageError(
                'SHARE_TARGET_REQUEST_INVALID',
                'The incoming Share Target form data is invalid.',
                {cause: formDataError}
            );

        }

        const formEntries = [...formData.entries()];

        if (formEntries.length > 32 || formEntries.some(function shareFieldUnknownCheck([fieldName]) {
            //Rejecting undeclared fields so an attacker cannot smuggle persistent data.
            return !shareTarget.fieldNames.includes(fieldName);

        })) {
            throw new LayerStorageError(
                'SHARE_TARGET_FIELD_INVALID',
                'The shared form contains an undeclared field.'
            );

        }

        const shareIdentifier = captureOptions.shareIdCreate();
        const currentTime = clock();

        if (!shareIdentifierPattern.test(shareIdentifier) ||
            !Number.isSafeInteger(currentTime) || currentTime < 0) {
            throw new TypeError('Share Target identity factories returned invalid data.');

        }

        const fileFields = /** @type {readonly Readonly<{name: string, accept: readonly string[]}>[]} */ (
            shareTarget.params.files ?? []
        );
        const shareRecord = {
            shareId: shareIdentifier,
            createdAt: currentTime,
            expiresAt: currentTime + retentionMs,
            title: shareTextFieldRead(formData, shareTarget.params.title, maximumTextBytes),
            text: shareTextFieldRead(formData, shareTarget.params.text, maximumTextBytes),
            url: shareTextFieldRead(formData, shareTarget.params.url, maximumTextBytes),
            files: await sharedFilesRead(formData, fileFields, maximumFileBytes, maximumFiles)
        };
        const shareDatabase = /** @type {IDBDatabase} */ (
            await shareTargetDatabaseOpen(indexedDb, databaseName)
        );

        try {
            const cleanupTransaction = shareDatabase.transaction([shareTargetStoreName], 'readwrite');
            const cleanupPromise = expiredSharesDelete(
                cleanupTransaction.objectStore(shareTargetStoreName),
                currentTime
            );

            //Finishing cleanup before the serialized capacity transaction counts active records.
            await Promise.all([
                cleanupPromise,
                transactionCompleteWait(cleanupTransaction)
            ]);

            const storageTransaction = shareDatabase.transaction([shareTargetStoreName], 'readwrite');
            const storagePromise = shareRecordStore(
                storageTransaction.objectStore(shareTargetStoreName),
                storageTransaction,
                shareRecord,
                maximumRecords
            );

            //Waiting for both the queued record request and its durable transaction commit.
            await Promise.all([
                storagePromise,
                transactionCompleteWait(storageTransaction)
            ]);

        } catch (captureError) {
            if (captureError instanceof LayerStorageError) {
                throw captureError;

            }

            throw new LayerStorageError(
                'SHARE_TARGET_STORAGE_FAILED',
                'The shared content could not be stored.',
                {cause: captureError}
            );

        } finally {
            shareDatabase.close();

        }

        return shareIdentifier;

    };

}

/**
 * @param {object} inboxOptions
 * @param {string} inboxOptions.appId
 * @param {IDBFactory} [inboxOptions.indexedDb]
 * @param {() => number} [inboxOptions.clock]
 * @returns {LayerShareTargetInbox}
 */
export function layerShareTargetInboxCreate(inboxOptions) {
    if (!plainObjectCheck(inboxOptions)) {
        throw new TypeError('Share Target inbox options are invalid.');

    }

    const indexedDb = inboxOptions.indexedDb ?? globalThis.indexedDB;
    const clock = inboxOptions.clock ?? Date.now;

    if (indexedDb === undefined || !applicationIdentifierPattern.test(inboxOptions.appId) ||
        typeof clock !== 'function') {
        throw new TypeError('Share Target inbox options are invalid.');

    }

    const databaseName = shareTargetDatabaseNameCreate(inboxOptions.appId);

    return Object.freeze({
        /**
         * @param {string} shareIdentifier
         */
        async consume(shareIdentifier) {
            if (!shareIdentifierPattern.test(shareIdentifier)) {
                throw new TypeError('The Share Target identifier is invalid.');

            }

            const currentTime = clock();

            if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
                throw new TypeError('The Share Target clock returned invalid data.');

            }

            const shareDatabase = /** @type {IDBDatabase} */ (
                await shareTargetDatabaseOpen(indexedDb, databaseName)
            );

            try {
                const transactionData = shareDatabase.transaction([shareTargetStoreName], 'readwrite');
                const completionPromise = transactionCompleteWait(transactionData);
                const inboxStore = transactionData.objectStore(shareTargetStoreName);
                const shareRequest = inboxStore.get(shareIdentifier);

                //Queuing one-time removal before Safari can auto-close the active transaction.
                inboxStore.delete(shareIdentifier);
                const [shareData] = await Promise.all([
                    requestResultGet(shareRequest),
                    completionPromise
                ]);
                const sharedRecord = sharedRecordFreeze(shareData);

                if (sharedRecord === null || sharedRecord.expiresAt <= currentTime) {
                    return null;

                }

                return sharedRecord;

            } finally {
                shareDatabase.close();

            }

        },

        /**
         * @param {string} shareIdentifier
         */
        async discard(shareIdentifier) {
            if (!shareIdentifierPattern.test(shareIdentifier)) {
                throw new TypeError('The Share Target identifier is invalid.');

            }

            const shareDatabase = /** @type {IDBDatabase} */ (
                await shareTargetDatabaseOpen(indexedDb, databaseName)
            );

            try {
                const transactionData = shareDatabase.transaction([shareTargetStoreName], 'readwrite');
                const completionPromise = transactionCompleteWait(transactionData);
                const inboxStore = transactionData.objectStore(shareTargetStoreName);
                const existingKeyRequest = inboxStore.getKey(shareIdentifier);

                //Queuing removal alongside the existence read for Safari transaction compatibility.
                inboxStore.delete(shareIdentifier);
                const [existingKey] = await Promise.all([
                    requestResultGet(existingKeyRequest),
                    completionPromise
                ]);

                return existingKey !== undefined;

            } finally {
                shareDatabase.close();

            }

        },

        async purge() {
            //Deleting the entire app-scoped temporary inbox during logout cleanup.
            await shareTargetDatabaseDelete(indexedDb, databaseName);

        }
    });

}
