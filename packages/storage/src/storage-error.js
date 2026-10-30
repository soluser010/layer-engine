export class LayerStorageError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {{retryable?: boolean, details?: Readonly<Record<string, unknown>> | null, cause?: unknown}} [errorOptions]
     */
    constructor(code, message, errorOptions = {}) {
        super(message, {
            cause: errorOptions.cause
        });

        //Exposing stable recovery fields without serializing browser internals.
        this.name = 'LayerStorageError';
        this.code = code;
        this.retryable = errorOptions.retryable ?? false;
        this.details = errorOptions.details ?? null;

    }

}
