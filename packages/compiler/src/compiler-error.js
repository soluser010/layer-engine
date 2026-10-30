export class LayerCompilerError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {{file?: string | undefined, line?: number | undefined, column?: number | undefined, cause?: unknown}} [errorOptions]
     */
    constructor(code, message, errorOptions = {}) {
        super(message, {
            cause: errorOptions.cause
        });

        //Publishing stable diagnostics without exposing the internal parser failure.
        this.name = 'LayerCompilerError';
        this.code = code;
        this.file = errorOptions.file ?? null;
        this.line = errorOptions.line ?? null;
        this.column = errorOptions.column ?? null;

    }

}
