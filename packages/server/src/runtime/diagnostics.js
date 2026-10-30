import {layerDiagnosticCodeCheck} from './request-failure.js';


const diagnosticFields = Object.freeze([
    'timestamp',
    'level',
    'event',
    'requestId',
    'operation',
    'durationMs',
    'status',
    'code',
    'stage',
    'errorType',
    'errorCode',
    'causeType',
    'causeCode',
    'requestComplete',
    'responseDestroyed',
    'responseEnded',
    'responseHeadersSent'
]);

/**
 * @param {object} diagnosticsOptions
 * @param {(diagnosticData: Readonly<Record<string, string | number | boolean | null>>) => void} [diagnosticsOptions.sink]
 * @param {() => Date} [diagnosticsOptions.clock]
 */
export function layerDiagnosticsCreate(diagnosticsOptions = {}) {
    function defaultDiagnosticSink() {
        //Discarding diagnostics only when the host explicitly omits a sink.

    }

    function defaultClock() {
        //Providing wall-clock timestamps for runtime diagnostic records.
        return new Date();

    }

    const diagnosticSink = diagnosticsOptions.sink ?? defaultDiagnosticSink;
    const clock = diagnosticsOptions.clock ?? defaultClock;

    return Object.freeze({
        /**
         * @param {Record<string, unknown>} diagnosticData
         */
        record(diagnosticData) {
            const safeDiagnosticData = /** @type {Record<string, string | number | boolean | null>} */ ({
                timestamp: clock().toISOString()
            });

            //Copying only explicitly allowed scalar diagnostic fields.
            for (const fieldName of diagnosticFields) {
                const fieldValue = diagnosticData[fieldName];

                //Validating newly introduced technical fields instead of accepting arbitrary diagnostic strings
                if ( ['errorCode', 'causeCode'].includes( fieldName ) && !layerDiagnosticCodeCheck( fieldValue ) ){
                    continue;

                }

                if ( ['errorType', 'causeType'].includes( fieldName ) &&
                    !['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError',
                        'AggregateError', 'AbortError', 'TimeoutError', 'LayerError'].includes( String( fieldValue ) ) ){
                    continue;

                }

                if ( fieldName === 'stage' && !['readiness', 'body-read', 'protocol', 'envelope', 'client-address',
                    'stream-authorization', 'stream-open', 'operation', 'response', 'extension'].includes( String( fieldValue ) ) ){
                    continue;

                }

                if ( ['requestComplete', 'responseDestroyed', 'responseEnded', 'responseHeadersSent'].includes( fieldName ) &&
                    typeof fieldValue !== 'boolean' ){
                    continue;

                }

                if (fieldValue === null ||
                    typeof fieldValue === 'string' ||
                    typeof fieldValue === 'number' ||
                    typeof fieldValue === 'boolean') {
                    safeDiagnosticData[fieldName] = fieldValue;

                }

            }

            //Keeping a failing log sink from turning an otherwise handled request into an unhandled rejection
            try {
                diagnosticSink( Object.freeze( safeDiagnosticData ) );

            } catch( diagnosticError ){
                //Logging is best effort; raw fallback output could expose secrets and must not replace the primary result
                void diagnosticError;

            }

        }
    });

}
