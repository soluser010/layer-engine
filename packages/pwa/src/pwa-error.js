export class LayerPwaError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {{retryable?: boolean, details?: Readonly<Record<string, unknown>> | null, cause?: unknown}} [errorOptions]
     */
    constructor(code, message, errorOptions = {}) {
        super(message, {
            cause: errorOptions.cause
        });

        //Publishing stable capability and lifecycle fields to the application.
        this.name = 'LayerPwaError';
        this.code = code;
        this.retryable = errorOptions.retryable ?? false;
        this.details = errorOptions.details ?? null;

    }

}
