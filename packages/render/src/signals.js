import {LAYER_SIGNAL_READ} from '@solcorp/layer-compiler/expression';

/**
 * @typedef {'computed' | 'binding' | 'effect'} LayerObserverKind
 * @typedef {{kind: LayerObserverKind, dependencies: Set<LayerReactiveSource>, queued: boolean, disposed: boolean, invalidate: () => void, execute: () => void}} LayerReactiveObserver
 * @typedef {{subscribers: Set<LayerReactiveObserver>}} LayerReactiveSource
 */

let activeObserver = /** @type {LayerReactiveObserver | null} */ (null);
let batchDepth = 0;
let flushScheduled = false;
let flushRunning = false;
const computedQueue = /** @type {Set<LayerReactiveObserver>} */ (new Set());
const bindingQueue = /** @type {Set<LayerReactiveObserver>} */ (new Set());
const effectQueue = /** @type {Set<LayerReactiveObserver>} */ (new Set());
const commitWaiters = /** @type {{resolve: () => void, reject: (errorData: unknown) => void}[]} */ ([]);

/**
 * @param {LayerReactiveObserver} observerData
 */
function observerDependenciesClear(observerData) {
    //Removing stale graph edges before collecting the next dependency set.
    for (const sourceData of observerData.dependencies) {
        sourceData.subscribers.delete(observerData);

    }

    observerData.dependencies.clear();

}

/** @param {LayerReactiveObserver} observerData @param {Set<LayerReactiveSource>} previousSourcesData */
const observerDependenciesRestore = function( observerData, previousSourcesData ){
    //A callback may dispose its own owner before throwing
    if ( observerData.disposed === true ){
        return;

    }

    //Retaining retry triggers if user code failed before reading its previous dependencies
    for ( const sourceData of previousSourcesData ){
        sourceData.subscribers.add( observerData );
        observerData.dependencies.add( sourceData );

    }

};

/**
 * @param {LayerReactiveSource} sourceData
 */
function dependencyTrack(sourceData) {
    //Registering the active consumer only once for this source.
    if (activeObserver === null || activeObserver.disposed) {
        return;

    }

    sourceData.subscribers.add(activeObserver);
    activeObserver.dependencies.add(sourceData);

}

/**
 * @param {LayerReactiveSource} sourceData
 */
function sourceSubscribersInvalidate(sourceData) {
    const subscriberSnapshot = [...sourceData.subscribers];

    //Invalidating a stable snapshot because observers may reconnect while running.
    for (const observerData of subscriberSnapshot) {
        observerData.invalidate();

    }

}

/**
 * @param {LayerReactiveObserver} observerData
 */
function observerQueueAdd(observerData) {
    //Avoiding duplicate work while preserving observer phase order.
    if (observerData.queued || observerData.disposed) {
        return;

    }

    observerData.queued = true;

    if (observerData.kind === 'computed') {
        computedQueue.add(observerData);

    } else if (observerData.kind === 'binding') {
        bindingQueue.add(observerData);

    } else {
        effectQueue.add(observerData);

    }

    if (batchDepth === 0) {
        schedulerRequest();

    }

}

function schedulerRequest() {
    //Scheduling at most one microtask for the pending reactive commit.
    if (flushScheduled || flushRunning) {
        return;

    }

    flushScheduled = true;
    queueMicrotask(function schedulerMicrotaskRun() {
        //Committing queued work after the current synchronous action completes.
        layerSchedulerFlush();

    });

}

/**
 * @param {Set<LayerReactiveObserver>} observerQueue
 * @param {unknown[]} failuresData
 */
function observerQueueFlush(observerQueue, failuresData) {
    const pendingObservers = [...observerQueue];
    observerQueue.clear();

    //Executing each observer once for the current phase snapshot.
    for (const observerData of pendingObservers) {
        observerData.queued = false;

        if (!observerData.disposed) {
            try {
                //Letting unrelated observers finish even when one callback fails
                observerData.execute();

            } catch( observerErrorData ){
                //Retaining the failure for the caller after all queued flags have been released
                failuresData.push( observerErrorData );

            }

        }

    }

}

export function layerSchedulerFlush() {
    //Preventing nested flushes while allowing new work into the active queues.
    if (flushRunning) {
        return;

    }

    flushScheduled = false;
    flushRunning = true;
    const failuresData = /** @type {unknown[]} */ ([]);

    try {
        //Repeating phases until the dependency graph reaches a stable state.
        while (computedQueue.size > 0 || bindingQueue.size > 0 || effectQueue.size > 0) {
            while (computedQueue.size > 0) {
                observerQueueFlush(computedQueue, failuresData);

            }

            while (bindingQueue.size > 0) {
                observerQueueFlush(bindingQueue, failuresData);

                while (computedQueue.size > 0) {
                    observerQueueFlush(computedQueue, failuresData);

                }

            }

            observerQueueFlush(effectQueue, failuresData);

        }

    } finally {
        flushRunning = false;
        const waiterSnapshot = commitWaiters.splice(0);

        //Reporting a failed commit instead of resolving it as successful partial rendering
        for (const waiterData of waiterSnapshot) {
            if ( failuresData.length > 0 ){
                waiterData.reject( failuresData[0] );

            } else {
                waiterData.resolve();

            }

        }

    }

    //Preserving observable failures while keeping the remaining reactive graph usable
    if ( failuresData.length === 1 ){
        throw failuresData[0];

    } else if ( failuresData.length > 1 ){
        throw new AggregateError( failuresData, 'Reactive observers failed during commit.' );

    }

}

/**
 * @returns {Promise<void>}
 */
export function layerCommitWait() {
    //Returning immediately when no reactive commit is pending.
    if (!flushScheduled && !flushRunning &&
        computedQueue.size === 0 && bindingQueue.size === 0 && effectQueue.size === 0) {
        return Promise.resolve();

    }

    return new Promise(function commitCompletionWait(resolve, reject) {
        //Registering the caller for the end of the current scheduled commit.
        commitWaiters.push({resolve, reject});

    });

}

/**
 * @template ValueData
 * @param {ValueData} initialValue
 * @param {{equal?: (previousValue: ValueData, nextValue: ValueData) => boolean}} [signalOptions]
 */
export function signal(initialValue, signalOptions = {}) {
    let currentValue = initialValue;
    const equalCheck = signalOptions.equal ?? Object.is;
    const sourceData = /** @type {LayerReactiveSource} */ ({
        subscribers: new Set()
    });

    const signalData = {
        [LAYER_SIGNAL_READ]() {
            //Connecting compiled expressions to the same tracked signal read.
            return signalData.get();

        },

        get() {
            //Tracking this source when read by a computed, binding, or effect.
            dependencyTrack(sourceData);

            return currentValue;

        },

        peek() {
            //Reading without adding an edge to the active dependency graph.
            return currentValue;

        },

        /**
         * @param {ValueData} nextValue
         */
        set(nextValue) {
            //Skipping invalidation when the configured equality policy matches.
            if (equalCheck(currentValue, nextValue)) {
                return currentValue;

            }

            currentValue = nextValue;
            sourceSubscribersInvalidate(sourceData);

            return currentValue;

        },

        /**
         * @param {(previousValue: ValueData) => ValueData} updateHandler
         */
        update(updateHandler) {
            //Deriving the next value from the latest untracked state.
            return signalData.set(updateHandler(currentValue));

        }
    };

    return Object.freeze(signalData);

}

/**
 * @template ValueData
 * @param {() => ValueData} computeHandler
 * @param {{equal?: (previousValue: ValueData, nextValue: ValueData) => boolean}} [computedOptions]
 */
export function computed(computeHandler, computedOptions = {}) {
    const equalCheck = computedOptions.equal ?? Object.is;
    const sourceData = /** @type {LayerReactiveSource} */ ({
        subscribers: new Set()
    });
    let currentValue = /** @type {ValueData} */ (undefined);
    let initializedStatus = false;
    let dirtyStatus = true;
    let failedStatus = false;

    const observerData = /** @type {LayerReactiveObserver} */ ({
        kind: 'computed',
        dependencies: new Set(),
        queued: false,
        disposed: false,
        invalidate() {
            //Marking the derived value dirty only once per source change batch.
            if (observerData.disposed) {
                return;

            }

            dirtyStatus = true;
            observerQueueAdd(observerData);

        },
        execute() {
            //Recomputing the memoized value before downstream DOM bindings.
            if (!dirtyStatus || observerData.disposed) {
                return;

            }

            const previousSourcesData = new Set( observerData.dependencies );
            observerDependenciesClear(observerData);
            const previousObserver = activeObserver;
            activeObserver = observerData;
            let nextValue;
            let changedStatus;

            try {
                nextValue = computeHandler();
                changedStatus = failedStatus || !initializedStatus || !equalCheck(currentValue, nextValue);

            } catch( computationErrorData ){
                //Retrying on the next dependency change without pretending a stale value is current
                failedStatus = true;
                observerDependenciesRestore( observerData, previousSourcesData );
                throw computationErrorData;

            } finally {
                activeObserver = previousObserver;

            }

            currentValue = nextValue;
            initializedStatus = true;
            dirtyStatus = false;
            failedStatus = false;

            if (changedStatus) {
                sourceSubscribersInvalidate(sourceData);

            }

        }
    });

    const computedData = {
        [LAYER_SIGNAL_READ]() {
            //Connecting compiled expressions to the memoized tracked read.
            return computedData.get();

        },

        get() {
            try {
                //Recomputing synchronously before subscribing a new consumer to avoid self-invalidation
                if (dirtyStatus) {
                    observerData.execute();

                }

                return currentValue;

            } finally {
                //Retaining the consumer edge even if recomputation throws during this read
                dependencyTrack(sourceData);

            }

        },

        peek() {
            //Reading the latest value without connecting the active observer.
            if (dirtyStatus) {
                observerData.execute();

            }

            return currentValue;

        },

        dispose() {
            //Disconnecting the computed node from sources and downstream work.
            observerData.disposed = true;
            observerDependenciesClear(observerData);
            sourceData.subscribers.clear();
            computedQueue.delete(observerData);

        }
    };

    return Object.freeze(computedData);

}

/**
 * @param {LayerObserverKind} observerKind
 * @param {() => void} observerHandler
 * @param {boolean} immediateStatus
 */
function reactiveObserverCreate(observerKind, observerHandler, immediateStatus) {
    const observerData = /** @type {LayerReactiveObserver} */ ({
        kind: observerKind,
        dependencies: new Set(),
        queued: false,
        disposed: false,
        invalidate() {
            //Queueing this consumer in its deterministic scheduler phase.
            observerQueueAdd(observerData);

        },
        execute() {
            //Rebuilding dependencies around one observer execution.
            const previousSourcesData = new Set( observerData.dependencies );
            observerDependenciesClear(observerData);
            const previousObserver = activeObserver;
            activeObserver = observerData;

            try {
                observerHandler();

            } catch( observerErrorData ){
                //Keeping a failed cleanup or binding eligible for the next source change
                observerDependenciesRestore( observerData, previousSourcesData );
                throw observerErrorData;

            } finally {
                activeObserver = previousObserver;

            }

        }
    });

    if (immediateStatus) {
        try {
            observerData.execute();

        } catch( observerErrorData ){
            //No disposer can reach a failed initial binding, so remove its graph ownership here
            observerData.disposed = true;
            observerDependenciesClear( observerData );
            bindingQueue.delete( observerData );
            throw observerErrorData;

        }

    } else {
        observerQueueAdd(observerData);

    }

    return function observerDispose() {
        //Removing the observer from every source and pending scheduler queue.
        observerData.disposed = true;
        observerDependenciesClear(observerData);
        computedQueue.delete(observerData);
        bindingQueue.delete(observerData);
        effectQueue.delete(observerData);

    };

}

/**
 * @param {() => void} bindingHandler
 */
export function layerBindingObserve(bindingHandler) {
    //Running the first DOM binding immediately, then scheduling later changes.
    return reactiveObserverCreate('binding', bindingHandler, true);

}

/**
 * @param {() => void | (() => void)} effectHandler
 */
export function effect(effectHandler) {
    let cleanupHandler = /** @type {(() => void) | undefined} */ (undefined);

    const disposeObserver = reactiveObserverCreate('effect', function effectExecute() {
        //Cleaning the previous side effect before creating its next instance.
        if (cleanupHandler !== undefined) {
            const previousCleanupData = cleanupHandler;
            cleanupHandler = undefined;
            previousCleanupData();

        }

        const effectResult = effectHandler();

        if (typeof effectResult === 'function') {
            cleanupHandler = effectResult;

        }

    }, false);

    return function effectDispose() {
        //Disposing graph dependencies and the final user cleanup together.
        disposeObserver();

        if (cleanupHandler !== undefined) {
            const finalCleanupData = cleanupHandler;
            cleanupHandler = undefined;
            finalCleanupData();

        }

    };

}

/**
 * @template ResultData
 * @param {() => ResultData} batchHandler
 * @returns {ResultData}
 */
export function batch(batchHandler) {
    batchDepth += 1;

    try {
        //Executing all writes before requesting one consolidated commit.
        return batchHandler();

    } finally {
        batchDepth -= 1;

        if (batchDepth === 0 &&
            (computedQueue.size > 0 || bindingQueue.size > 0 || effectQueue.size > 0)) {
            schedulerRequest();

        }

    }

}

/**
 * @template {Record<string, unknown>} StoreData
 * @param {StoreData} initialData
 * @returns {StoreData}
 */
export function store(initialData) {
    const propertySignalMap = new Map();

    //Creating one signal per declared property for field-level invalidation.
    for (const [propertyName, propertyValue] of Object.entries(initialData)) {
        propertySignalMap.set(propertyName, signal(propertyValue));

    }

    return new Proxy({...initialData}, {
        get(targetData, propertyName) {
            //Creating a tracked field even when the first read precedes its assignment.
            if (typeof propertyName === 'string') {
                let propertySignal = propertySignalMap.get(propertyName);

                if (propertySignal === undefined) {
                    propertySignal = signal(Reflect.get(targetData, propertyName));
                    propertySignalMap.set(propertyName, propertySignal);

                }

                return propertySignal.get();

            }

            return Reflect.get(targetData, propertyName);

        },
        set(targetData, propertyName, propertyValue) {
            //Updating an existing field signal or creating one for a new field.
            if (typeof propertyName === 'string') {
                let propertySignal = propertySignalMap.get(propertyName);

                if (propertySignal === undefined) {
                    propertySignal = signal(Reflect.get(targetData, propertyName));
                    propertySignalMap.set(propertyName, propertySignal);

                }

                propertySignal.set(propertyValue);

            }

            return Reflect.set(targetData, propertyName, propertyValue);

        },
        deleteProperty(targetData, propertyName) {
            //Invalidating readers with undefined before removing a declared field.
            if (typeof propertyName === 'string') {
                let propertySignal = propertySignalMap.get(propertyName);

                if (propertySignal === undefined) {
                    propertySignal = signal(Reflect.get(targetData, propertyName));
                    propertySignalMap.set(propertyName, propertySignal);

                }

                propertySignal.set(undefined);

            }

            return Reflect.deleteProperty(targetData, propertyName);

        }
    });

}
