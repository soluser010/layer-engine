const mutationNames = Object.freeze([
    'attribute',
    'create',
    'move',
    'property',
    'remove',
    'text'
]);

/**
 * @param {{sink?: (eventData: Readonly<{type: string, bindingId: string | null, nodeId: string | null}>) => void}} [diagnosticOptions]
 */
export function layerRenderDiagnosticsCreate(diagnosticOptions = {}) {
    const mutationCounts = Object.create(null);
    const diagnosticSink = diagnosticOptions.sink ?? function diagnosticDiscard() {
        //Discarding detailed events when the host does not provide a sink.

    };

    //Initializing every stable mutation counter for deterministic snapshots.
    for (const mutationName of mutationNames) {
        mutationCounts[mutationName] = 0;

    }

    return Object.freeze({
        /**
         * @param {string} mutationType
         * @param {string | null} [bindingId]
         * @param {string | null} [nodeId]
         */
        mutationRecord(mutationType, bindingId = null, nodeId = null) {
            //Counting only the public mutation categories.
            if (Object.hasOwn(mutationCounts, mutationType)) {
                mutationCounts[mutationType] += 1;

            }

            diagnosticSink(Object.freeze({
                type: mutationType,
                bindingId,
                nodeId
            }));

        },

        mismatchRecord(bindingId = null, nodeId = null) {
            //Reporting hydration recovery separately from ordinary mutations.
            diagnosticSink(Object.freeze({
                type: 'hydration-mismatch',
                bindingId,
                nodeId
            }));

        },

        snapshot() {
            //Returning an immutable copy without exposing mutable counters.
            return Object.freeze({...mutationCounts});

        },

        reset() {
            //Resetting all counters between measured render actions.
            for (const mutationName of mutationNames) {
                mutationCounts[mutationName] = 0;

            }

        }
    });

}
