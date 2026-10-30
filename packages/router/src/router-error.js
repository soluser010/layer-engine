export class LayerRouterError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {Readonly<Record<string, unknown>> | null} [details]
     */
    constructor(code, message, details = null) {
        super(message);

        //Publishing only stable routing fields to application boundaries.
        this.name = 'LayerRouterError';
        this.code = code;
        this.details = details;

    }

}
