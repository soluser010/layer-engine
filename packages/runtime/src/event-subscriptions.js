const channelNamePattern = /^[a-zA-Z0-9:_-]{1,160}$/;

/**
 * @param {object} subscriptionOptions
 * @param {(runtimeData: Readonly<{channels: readonly string[], eventReceive: (eventData: Record<string, unknown>) => Promise<void>}>) => {start: () => void | Promise<void>, stop: () => void | Promise<void>} | Promise<{start: () => void | Promise<void>, stop: () => void | Promise<void>}>} subscriptionOptions.runtimeCreate
 * @param {(errorData: unknown) => void} [subscriptionOptions.failureHandle]
 */
export function layerEventSubscriptionsCreate(subscriptionOptions) {
    if (subscriptionOptions === null || typeof subscriptionOptions !== 'object' ||
        typeof subscriptionOptions.runtimeCreate !== 'function' ||
        (subscriptionOptions.failureHandle !== undefined &&
            typeof subscriptionOptions.failureHandle !== 'function')) {
        throw new TypeError('Layer event subscription options are invalid.');

    }

    const channelListeners = new Map();
    let activeRuntime = /** @type {{start: () => void | Promise<void>, stop: () => void | Promise<void>} | null} */ (null);
    let lifecycleTask = /** @type {Promise<void>} */ (Promise.resolve());
    let lifecycleRevision = 0;
    let stoppedStatus = false;

    /**
     * @param {Record<string, unknown>} eventData
     */
    async function eventReceive(eventData) {
        const channelName = String(eventData.channel);
        const listenerSet = /** @type {Set<(eventData: Readonly<Record<string, unknown>>) => void | Promise<void>> | undefined} */ (
            channelListeners.get(channelName)
        );

        if (listenerSet === undefined) {
            return;

        }

        //Applying subscribers sequentially before the durable cursor advances.
        for (const listenerHandle of [...listenerSet]) {
            await listenerHandle(Object.freeze(structuredClone(eventData)));

        }

    }

    function lifecycleSchedule() {
        lifecycleRevision += 1;
        const scheduledRevision = lifecycleRevision;

        lifecycleTask = lifecycleTask.then(async function subscriptionRuntimeReplace() {
            //Closing the previous channel set before opening its replacement.
            if (activeRuntime !== null) {
                await activeRuntime.stop();
                activeRuntime = null;

            }

            if (stoppedStatus || scheduledRevision !== lifecycleRevision || channelListeners.size === 0) {
                return;

            }

            const channelNames = Object.freeze([...channelListeners.keys()].sort());
            const nextRuntime = await subscriptionOptions.runtimeCreate({
                channels: channelNames,
                eventReceive
            });

            if (nextRuntime === null || typeof nextRuntime !== 'object' ||
                typeof nextRuntime.start !== 'function' || typeof nextRuntime.stop !== 'function') {
                throw new TypeError('Layer event subscription runtime is invalid.');

            }

            if (stoppedStatus || scheduledRevision !== lifecycleRevision) {
                await nextRuntime.stop();

                return;

            }

            activeRuntime = nextRuntime;
            await nextRuntime.start();

        }).catch(function subscriptionLifecycleFailure(lifecycleError) {
            //Reporting stream lifecycle failures without an unhandled task rejection.
            subscriptionOptions.failureHandle?.(lifecycleError);

        });

    }

    return Object.freeze({
        /**
         * @param {string} channelName
         * @param {(eventData: Readonly<Record<string, unknown>>) => void | Promise<void>} listenerHandle
         */
        subscribe(channelName, listenerHandle) {
            if (stoppedStatus) {
                throw new Error('Layer event subscriptions are stopped.');

            }

            if (!channelNamePattern.test(channelName) || typeof listenerHandle !== 'function') {
                throw new TypeError('Layer event subscription is invalid.');

            }

            let listenerSet = /** @type {Set<(eventData: Readonly<Record<string, unknown>>) => void | Promise<void>> | undefined} */ (
                channelListeners.get(channelName)
            );
            const newChannelStatus = listenerSet === undefined;

            if (listenerSet === undefined) {
                listenerSet = new Set();
                channelListeners.set(channelName, listenerSet);

            }

            listenerSet.add(listenerHandle);

            if (newChannelStatus) {
                lifecycleSchedule();

            }

            let disposedStatus = false;

            return function eventSubscriptionDispose() {
                //Removing exactly one listener and closing an unused channel.
                if (disposedStatus) {
                    return false;

                }

                disposedStatus = true;
                listenerSet?.delete(listenerHandle);

                if (listenerSet?.size === 0) {
                    channelListeners.delete(channelName);
                    lifecycleSchedule();

                }

                return true;

            };

        },

        list() {
            //Returning a stable channel snapshot for diagnostics.
            return Object.freeze([...channelListeners.keys()].sort());

        },

        async ready() {
            //Waiting until the latest channel lifecycle operation settles.
            await lifecycleTask;

        },

        async stop() {
            //Permanently closing the facade and its active transport.
            if (stoppedStatus) {
                return false;

            }

            stoppedStatus = true;
            lifecycleRevision += 1;
            channelListeners.clear();
            await lifecycleTask;

            if (activeRuntime !== null) {
                await activeRuntime.stop();
                activeRuntime = null;

            }

            return true;

        }
    });

}
