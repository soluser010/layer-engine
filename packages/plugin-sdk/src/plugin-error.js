export class LayerPluginError extends Error {
    #internalCause;

    /**
     * @param {string} code
     * @param {string} message
     * @param {{details?: Readonly<Record<string, unknown>> | null, cause?: unknown}} [errorOptions]
     */
    constructor(code, message, errorOptions = {}) {
        super(message);

        //Keeping the operational cause private while publishing stable diagnostics.
        this.name = 'LayerPluginError';
        this.code = code;
        this.details = errorOptions.details ?? null;
        this.#internalCause = errorOptions.cause;

    }

    internalCauseGet() {
        //Returning the private cause only to trusted server diagnostics.
        return this.#internalCause;

    }

    toJSON() {
        //Serializing only fields that are safe for startup diagnostics.
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details
        };

    }

}
