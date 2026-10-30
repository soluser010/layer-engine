export class LayerRuntimeError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {{requestId?: string | null, status?: number, retryAfterMs?: number, retryable?: boolean, details?: Readonly<Record<string, unknown>> | null, cause?: unknown}} [errorOptions]
     */
    constructor(code, message, errorOptions = {}) {
        super(message, {
            cause: errorOptions.cause
        });

        //Publishing stable recovery fields without exposing transport internals.
        this.name = 'LayerRuntimeError';
        this.code = code;
        this.requestId = errorOptions.requestId ?? null;
        this.status = errorOptions.status ?? 0;
        this.retryAfterMs = errorOptions.retryAfterMs ?? 0;
        this.retryable = errorOptions.retryable ?? false;
        this.details = errorOptions.details ?? null;

    }

}
