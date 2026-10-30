/**
 * Safe configuration or runtime error exposed by the Layer Auth package.
 */
export class LayerAuthError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {Readonly<Record<string, unknown>> | null} [details]
     * @param {unknown} [cause]
     */
    constructor( code, message, details = null, cause = undefined ){
        super( message, {cause} );

        //Recording stable public diagnostics without copying the internal cause
        this.name = String( 'LayerAuthError' );
        this.code = String( code );
        this.details = details;

    }

    toJSON(){
        //Returning only the stable safe error contract
        return {
            code: String( this.code ),
            message: String( this.message ),
            details: this.details
        };

    }
}
