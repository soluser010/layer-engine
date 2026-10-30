export class LayerDatabaseError extends Error {
    /**
     * @param {string} codeData
     * @param {string} messageData
     */
    constructor( codeData, messageData ){
        //Creating a stable server-side database contract error without query values
        super( String( messageData ) );

        this.name = 'LayerDatabaseError';
        this.code = String( codeData );

    }

}
