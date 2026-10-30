import {
    layerStorageSystemTransactionRun,
    layerSystemStoreNames
} from './storage.js';
import {LayerStorageError} from './storage-error.js';

const operationNamePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const conflictDomainPattern = /^[a-zA-Z0-9:_-]{1,160}$/;

/**
 * @param {unknown} commandIdentifier
 */
function commandIdentifierValidate(commandIdentifier) {
    //Keeping durable command lookups inside the bounded outbox key contract.
    if (typeof commandIdentifier !== 'string' || commandIdentifier.length < 1 || commandIdentifier.length > 160) {
        throw new LayerStorageError('OUTBOX_COMMAND_INVALID', 'The command identifier is invalid.');

    }

}

/**
 * @param {unknown} commandError
 */
function commandFailureClassify(commandError) {
    let errorRecord = /** @type {Record<string, unknown>} */ ({});

    //Reading only stable public fields from a rejected command.
    if (typeof commandError === 'object' && commandError !== null) {
        errorRecord = /** @type {Record<string, unknown>} */ (commandError);

    }

    let errorCode = 'COMMAND_FAILED';

    if (typeof errorRecord.code === 'string') {
        errorCode = errorRecord.code;

    }

    const errorStatus = Number(errorRecord.status);
    let requestIdentifier = /** @type {string | null} */ (null);

    if (typeof errorRecord.requestId === 'string') {
        requestIdentifier = errorRecord.requestId;

    }

    if (errorCode === 'CONFLICT' || errorStatus === 409) {
        let conflictDetails = /** @type {Record<string, unknown> | null} */ (null);

        //Preserving safe server conflict metadata for explicit application resolution.
        if (typeof errorRecord.details === 'object' && errorRecord.details !== null) {
            conflictDetails = /** @type {Record<string, unknown>} */ (errorRecord.details);

        }

        return Object.freeze({
            status: 'conflict',
            code: errorCode,
            requestId: requestIdentifier,
            retryAfterMs: 0,
            retryable: false,
            details: conflictDetails
        });

    }

    let failureStatus = 'failed';

    if (errorRecord.retryable === true) {
        failureStatus = 'retryable';

    }

    let retryAfterMs = 0;

    if (Number.isFinite(Number(errorRecord.retryAfterMs))) {
        retryAfterMs = Math.max(0, Number(errorRecord.retryAfterMs));

    }

    return Object.freeze({
        status: failureStatus,
        code: errorCode,
        requestId: requestIdentifier,
        retryAfterMs,
        retryable: errorRecord.retryable === true,
        details: null
    });

}

/**
 * @param {object} queueOptions
 * @param {string} queueOptions.operation
 * @param {Record<string, unknown>} queueOptions.payload
 * @param {number} queueOptions.baseRevision
 * @param {string} queueOptions.conflictDomain
 * @param {Record<string, unknown> | null} [queueOptions.optimisticPatch]
 */
function commandInputValidate(queueOptions) {
    //Rejecting malformed or oversized intent before it reaches durable storage.
    if (!operationNamePattern.test(queueOptions.operation) ||
        typeof queueOptions.payload !== 'object' || queueOptions.payload === null || Array.isArray(queueOptions.payload) ||
        Object.hasOwn(queueOptions.payload, 'commandId') || Object.hasOwn(queueOptions.payload, 'baseRevision') ||
        !Number.isSafeInteger(queueOptions.baseRevision) || queueOptions.baseRevision < 0 ||
        !conflictDomainPattern.test(queueOptions.conflictDomain) ||
        (queueOptions.optimisticPatch !== undefined && queueOptions.optimisticPatch !== null &&
            (typeof queueOptions.optimisticPatch !== 'object' || Array.isArray(queueOptions.optimisticPatch)))) {
        throw new LayerStorageError('OUTBOX_COMMAND_INVALID', 'The offline command is invalid.');

    }

    const serializedSize = new TextEncoder().encode(JSON.stringify({
        payload: queueOptions.payload,
        optimisticPatch: queueOptions.optimisticPatch ?? null
    })).byteLength;

    if (serializedSize > 262144) {
        throw new LayerStorageError('OUTBOX_COMMAND_INVALID', 'The offline command exceeds 256 KiB.');

    }

}

/**
 * @param {object} outboxOptions
 * @param {{watch: (storeNames: readonly string[], queryHandle: () => unknown | Promise<unknown>, listenerHandle: (resultData: any) => void | Promise<void>, watchOptions?: {immediate?: boolean}) => () => void}} outboxOptions.storage
 * @param {string} outboxOptions.ownerId
 * @param {() => string} outboxOptions.commandIdCreate
 * @param {(commandData: Readonly<{commandId: string, operation: string, payload: Record<string, unknown>, baseRevision: number}>) => Promise<unknown>} outboxOptions.commandSend
 * @param {() => Date} [outboxOptions.clock]
 * @param {number} [outboxOptions.concurrency]
 * @param {number} [outboxOptions.leaseMs]
 */
export function layerOfflineOutboxCreate(outboxOptions) {
    const concurrency = outboxOptions.concurrency ?? 4;
    const leaseMs = outboxOptions.leaseMs ?? 30000;
    const clock = outboxOptions.clock ?? function outboxClockRead() {
        //Providing a UTC timestamp for durable command ordering and leases.
        return new Date();

    };

    if (!conflictDomainPattern.test(outboxOptions.ownerId) ||
        !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 ||
        !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) {
        throw new TypeError('Offline outbox configuration is invalid.');

    }

    /**
     * @param {{operation: string, payload: Record<string, unknown>, baseRevision: number, conflictDomain: string, optimisticPatch?: Record<string, unknown> | null}} queueOptions
     */
    async function commandQueue(queueOptions) {
        commandInputValidate(queueOptions);
        const commandIdentifier = outboxOptions.commandIdCreate();

        if (typeof commandIdentifier !== 'string' || commandIdentifier.length < 1 || commandIdentifier.length > 160) {
            throw new LayerStorageError('OUTBOX_COMMAND_INVALID', 'The generated command identifier is invalid.');

        }

        const commandTime = clock().toISOString();
        const commandRecord = {
            commandId: commandIdentifier,
            operation: queueOptions.operation,
            payload: structuredClone(queueOptions.payload),
            baseRevision: queueOptions.baseRevision,
            conflictDomain: queueOptions.conflictDomain,
            optimisticPatch: structuredClone(queueOptions.optimisticPatch ?? null),
            status: 'queued',
            attempts: 0,
            createdAt: commandTime,
            updatedAt: commandTime,
            leaseOwner: null,
            leaseUntil: null,
            result: null,
            failure: null,
            supersededBy: null
        };

        await layerStorageSystemTransactionRun(
            outboxOptions.storage,
            [layerSystemStoreNames.outbox],
            'readwrite',
            async function queuedCommandWrite(transactionData) {
                //Persisting command intent before any network side effect.
                await transactionData.put(layerSystemStoreNames.outbox, commandRecord);

            }
        );

        return Object.freeze(structuredClone(commandRecord));

    }

    /**
     * @param {Record<string, unknown>} commandRecord
     * @param {string} statusData
     * @param {Record<string, unknown>} resultData
     */
    async function commandComplete(commandRecord, statusData, resultData) {
        await layerStorageSystemTransactionRun(
            outboxOptions.storage,
            [layerSystemStoreNames.outbox],
            'readwrite',
            async function commandCompletionWrite(transactionData) {
                const currentRecord = /** @type {Record<string, unknown> | undefined} */ (
                    await transactionData.get(layerSystemStoreNames.outbox, /** @type {string} */ (commandRecord.commandId))
                );

                //Completing only the lease still owned by this drain process.
                if (currentRecord === undefined || currentRecord.leaseOwner !== outboxOptions.ownerId) {
                    return;

                }

                await transactionData.put(layerSystemStoreNames.outbox, {
                    ...currentRecord,
                    ...resultData,
                    status: statusData,
                    updatedAt: clock().toISOString(),
                    leaseOwner: null,
                    leaseUntil: null
                });

            }
        );

    }

    /**
     * @param {string} commandIdentifier
     */
    async function commandGet(commandIdentifier) {
        commandIdentifierValidate(commandIdentifier);
        const commandRecord = /** @type {Record<string, unknown> | undefined} */ (await layerStorageSystemTransactionRun(
            outboxOptions.storage,
            [layerSystemStoreNames.outbox],
            'readonly',
            function commandRecordRead(transactionData) {
                //Reading one durable command without exposing the system store.
                return transactionData.get(layerSystemStoreNames.outbox, commandIdentifier);

            }
        ));

        if (commandRecord === undefined) {
            return null;

        }

        return Object.freeze(structuredClone(commandRecord));

    }

    return Object.freeze({
        queue: commandQueue,
        get: commandGet,

        /**
         * @param {string} commandIdentifier
         * @param {(commandRecord: Readonly<Record<string, unknown>> | null) => void | Promise<void>} listenerHandle
         * @param {{immediate?: boolean}} [watchOptions]
         */
        watch(commandIdentifier, listenerHandle, watchOptions = {}) {
            commandIdentifierValidate(commandIdentifier);

            if (typeof listenerHandle !== 'function') {
                throw new TypeError('Outbox watch requires a listener.');

            }

            //Refreshing the selected command after every committed outbox transaction.
            return outboxOptions.storage.watch(
                [layerSystemStoreNames.outbox],
                function watchedCommandRead() {
                    //Reading the selected command after a committed outbox change.
                    return commandGet(commandIdentifier);

                },
                listenerHandle,
                watchOptions
            );

        },

        /**
         * @param {{statuses?: readonly string[]}} [listOptions]
         */
        async list(listOptions = {}) {
            const commandRecords = /** @type {Record<string, unknown>[]} */ (await layerStorageSystemTransactionRun(
                outboxOptions.storage,
                [layerSystemStoreNames.outbox],
                'readonly',
                function outboxRecordsRead(transactionData) {
                    //Reading a transactionally consistent command snapshot.
                    return transactionData.getAll(layerSystemStoreNames.outbox);

                }
            ));
            let statusSet = /** @type {Set<string> | null} */ (null);

            if (listOptions.statuses !== undefined) {
                statusSet = new Set(listOptions.statuses);

            }

            return Object.freeze(commandRecords
                .filter(function commandStatusFilter(commandRecord) {
                    //Keeping every status unless the caller supplied an allowlist.
                    return statusSet === null || statusSet.has(String(commandRecord.status));

                })
                .sort(function commandCreatedSort(firstRecord, secondRecord) {
                    //Returning commands in durable intent order.
                    return String(firstRecord.createdAt).localeCompare(String(secondRecord.createdAt));

                })
                .map(function commandRecordClone(commandRecord) {
                    //Preventing callers from mutating IndexedDB-backed snapshots.
                    return Object.freeze(structuredClone(commandRecord));

                }));

        },

        async drain() {
            const claimTime = clock();
            const leaseUntil = new Date(claimTime.getTime() + leaseMs).toISOString();
            const claimedRecords = /** @type {Record<string, unknown>[]} */ (await layerStorageSystemTransactionRun(
                outboxOptions.storage,
                [layerSystemStoreNames.outbox],
                'readwrite',
                async function commandBatchClaim(transactionData) {
                    const commandRecords = /** @type {Record<string, unknown>[]} */ (
                        await transactionData.getAll(layerSystemStoreNames.outbox)
                    );
                    const blockedDomains = new Set();
                    const selectedDomains = new Set();
                    const selectedRecords = [];

                    //Blocking domains with unresolved conflicts or another active lease.
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
                        //Claiming older intent before newer commands across domains.
                        return String(firstRecord.createdAt).localeCompare(String(secondRecord.createdAt));

                    });

                    for (const commandRecord of commandRecords) {
                        const commandStatus = String(commandRecord.status);
                        const expiredLease = commandStatus === 'sending' &&
                            typeof commandRecord.leaseUntil === 'string' &&
                            commandRecord.leaseUntil <= claimTime.toISOString();
                        const claimableStatus = commandStatus === 'queued' || commandStatus === 'retryable' || expiredLease;
                        const conflictDomain = String(commandRecord.conflictDomain);

                        if (!claimableStatus || blockedDomains.has(conflictDomain) || selectedDomains.has(conflictDomain)) {
                            continue;

                        }

                        const claimedRecord = {
                            ...commandRecord,
                            status: 'sending',
                            attempts: Number(commandRecord.attempts) + 1,
                            updatedAt: claimTime.toISOString(),
                            leaseOwner: outboxOptions.ownerId,
                            leaseUntil
                        };

                        await transactionData.put(layerSystemStoreNames.outbox, claimedRecord);
                        selectedRecords.push(claimedRecord);
                        selectedDomains.add(conflictDomain);

                        if (selectedRecords.length >= concurrency) {
                            break;

                        }

                    }

                    return selectedRecords;

                }
            ));
            const completionResults = await Promise.all(claimedRecords.map(async function claimedCommandSend(commandRecord) {
                try {
                    const commandResult = await outboxOptions.commandSend(Object.freeze({
                        commandId: String(commandRecord.commandId),
                        operation: String(commandRecord.operation),
                        payload: /** @type {Record<string, unknown>} */ (commandRecord.payload),
                        baseRevision: Number(commandRecord.baseRevision)
                    }));

                    await commandComplete(commandRecord, 'confirmed', {
                        result: structuredClone(commandResult),
                        failure: null
                    });

                    return 'confirmed';

                } catch (commandError) {
                    const failureData = commandFailureClassify(commandError);

                    await commandComplete(commandRecord, failureData.status, {
                        failure: {
                            code: failureData.code,
                            requestId: failureData.requestId,
                            retryAfterMs: failureData.retryAfterMs,
                            retryable: failureData.retryable,
                            details: failureData.details
                        }
                    });

                    return failureData.status;

                }

            }));

            const completionCounts = {
                confirmed: 0,
                retryable: 0,
                conflict: 0,
                failed: 0
            };

            for (const completionStatus of completionResults) {
                const typedStatus = /** @type {'confirmed' | 'retryable' | 'conflict' | 'failed'} */ (completionStatus);
                completionCounts[typedStatus] += 1;

            }

            return Object.freeze({
                claimed: claimedRecords.length,
                confirmed: completionCounts.confirmed,
                retryable: completionCounts.retryable,
                conflicted: completionCounts.conflict,
                failed: completionCounts.failed
            });

        },

        /**
         * @param {string} commandIdentifier
         */
        async retry(commandIdentifier) {
            commandIdentifierValidate(commandIdentifier);
            await layerStorageSystemTransactionRun(
                outboxOptions.storage,
                [layerSystemStoreNames.outbox],
                'readwrite',
                async function commandRetryWrite(transactionData) {
                    const commandRecord = /** @type {Record<string, unknown> | undefined} */ (
                        await transactionData.get(layerSystemStoreNames.outbox, commandIdentifier)
                    );

                    if (commandRecord === undefined || !['failed', 'retryable'].includes(String(commandRecord.status))) {
                        throw new LayerStorageError('OUTBOX_STATE_INVALID', 'Only failed or retryable commands can be retried.');

                    }

                    await transactionData.put(layerSystemStoreNames.outbox, {
                        ...commandRecord,
                        status: 'queued',
                        updatedAt: clock().toISOString(),
                        failure: null
                    });

                }
            );

        },

        /**
         * @param {string} commandIdentifier
         */
        async cancel(commandIdentifier) {
            commandIdentifierValidate(commandIdentifier);

            await layerStorageSystemTransactionRun(
                outboxOptions.storage,
                [layerSystemStoreNames.outbox],
                'readwrite',
                async function commandCancellationWrite(transactionData) {
                    const commandRecord = /** @type {Record<string, unknown> | undefined} */ (
                        await transactionData.get(layerSystemStoreNames.outbox, commandIdentifier)
                    );

                    if (commandRecord === undefined ||
                        !['queued', 'retryable', 'failed', 'conflict'].includes(String(commandRecord.status))) {
                        throw new LayerStorageError(
                            'OUTBOX_STATE_INVALID',
                            'Only a command without an active send can be cancelled.'
                        );

                    }

                    await transactionData.put(layerSystemStoreNames.outbox, {
                        ...commandRecord,
                        status: 'cancelled',
                        updatedAt: clock().toISOString(),
                        leaseOwner: null,
                        leaseUntil: null
                    });

                }
            );

        },

        /**
         * @param {string} commandIdentifier
         * @param {{operation: string, payload: Record<string, unknown>, baseRevision: number, conflictDomain: string, optimisticPatch?: Record<string, unknown> | null}} resolutionData
         */
        async resolveConflict(commandIdentifier, resolutionData) {
            commandIdentifierValidate(commandIdentifier);
            commandInputValidate(resolutionData);
            const replacementIdentifier = outboxOptions.commandIdCreate();
            const resolutionTime = clock().toISOString();

            await layerStorageSystemTransactionRun(
                outboxOptions.storage,
                [layerSystemStoreNames.outbox],
                'readwrite',
                async function conflictResolutionWrite(transactionData) {
                    const commandRecord = /** @type {Record<string, unknown> | undefined} */ (
                        await transactionData.get(layerSystemStoreNames.outbox, commandIdentifier)
                    );

                    if (commandRecord === undefined || commandRecord.status !== 'conflict') {
                        throw new LayerStorageError('OUTBOX_STATE_INVALID', 'Only a conflicted command can be resolved.');

                    }

                    await transactionData.put(layerSystemStoreNames.outbox, {
                        ...commandRecord,
                        status: 'resolved',
                        updatedAt: resolutionTime,
                        supersededBy: replacementIdentifier
                    });
                    await transactionData.put(layerSystemStoreNames.outbox, {
                        commandId: replacementIdentifier,
                        operation: resolutionData.operation,
                        payload: structuredClone(resolutionData.payload),
                        baseRevision: resolutionData.baseRevision,
                        conflictDomain: resolutionData.conflictDomain,
                        optimisticPatch: structuredClone(resolutionData.optimisticPatch ?? null),
                        status: 'queued',
                        attempts: 0,
                        createdAt: resolutionTime,
                        updatedAt: resolutionTime,
                        leaseOwner: null,
                        leaseUntil: null,
                        result: null,
                        failure: null,
                        supersededBy: null
                    });

                }
            );

            return replacementIdentifier;

        }
    });

}
