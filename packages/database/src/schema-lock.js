import {createHash} from 'node:crypto';

/**
 * @param {{query: (queryData: {text: string, values: readonly unknown[]}) => Promise<unknown>}} transactionData
 * @param {string} schemaData
 * @param {string | undefined} kindData
 */
export const schemaMigrationLockAcquire = async function( transactionData, schemaData, kindData ){
    //Embedded storage already serializes transactions and holds its exclusive directory lock
    if ( kindData === 'embedded' ){
        return;

    }

    //Sharing one stable app lock across system migrations and every application schema plan
    const lockDigestData = createHash( 'sha256' ).update( `layer:ddl:v1:${schemaData}` ).digest();
    await transactionData.query({
        text: 'SELECT pg_advisory_xact_lock($1::bigint)',
        values: [lockDigestData.readBigInt64BE().toString()]
    });

    //The same connection releases the lock on commit or rollback, never through pool.query

};
