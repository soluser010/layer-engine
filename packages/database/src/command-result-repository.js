import {createHash} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';

/**
 * @param {{kind?: string, query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>}} transactionClient
 */
export function layerCommandResultRepositoryCreate(transactionClient) {
    //Getting the app-specific idempotency table from the active transaction adapter
    const commandResultsTableReferenceData = layerSystemTableReferenceCreate( transactionClient, 'sys_command_results' );

    return Object.freeze({
        /**
         * @param {object} commandIdentityData
         * @param {string} commandIdentityData.tenantKey
         * @param {string} commandIdentityData.commandId
         */
        async find(commandIdentityData) {
            //Serializing lookup and execution on the same transaction connection across workers
            if ( transactionClient.kind !== 'embedded' ){
                const lockDigestData = createHash( 'sha256' ).update( JSON.stringify([
                    commandResultsTableReferenceData,
                    commandIdentityData.tenantKey,
                    commandIdentityData.commandId
                ]) ).digest();

                await transactionClient.query({
                    text: 'SELECT pg_advisory_xact_lock($1::bigint)',
                    values: [lockDigestData.readBigInt64BE().toString()]
                });

            }

            //Loading a prior result under the transaction snapshot.
            const commandResult = await transactionClient.query({
                text: `
                    SELECT operation, result, actor_key, request_digest
                    FROM ${String( commandResultsTableReferenceData )}
                    WHERE tenant_key = $1 AND command_id = $2
                    LIMIT 1
                `,
                values: [
                    commandIdentityData.tenantKey,
                    commandIdentityData.commandId
                ]
            });

            return commandResult.rows[0] ?? null;

        },

        /**
         * @param {object} commandResultData
         * @param {string} commandResultData.tenantKey
         * @param {string} commandResultData.commandId
         * @param {string} commandResultData.operation
         * @param {unknown} commandResultData.result
         * @param {string | null} [commandResultData.actorKey]
         * @param {string | null} [commandResultData.requestDigest]
         */
        async save(commandResultData) {
            //Recording the idempotent result before the surrounding commit.
            await transactionClient.query({
                text: `
                    INSERT INTO ${String( commandResultsTableReferenceData )} (tenant_key, command_id, operation, result, actor_key, request_digest)
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6)
                `,
                values: [
                    commandResultData.tenantKey,
                    commandResultData.commandId,
                    commandResultData.operation,
                    JSON.stringify(commandResultData.result),
                    commandResultData.actorKey ?? null,
                    commandResultData.requestDigest ?? null
                ]
            });

        }
    });

}
