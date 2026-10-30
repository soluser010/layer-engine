import {createHash} from 'node:crypto';

/** @param {string} tableReferenceData */
export function cacheInvalidationInsertSqlCreate( tableReferenceData ){
    //Serializing journal allocation before nextval so its cursor follows transaction commit order
    const lockIdentifierData = createHash( 'sha256' )
        .update( `cache-invalidation:${tableReferenceData}` )
        .digest().readBigInt64BE().toString();

    //The table reference is created only by the system schema allowlist, never from application input
    return `
        WITH invalidation_lock AS MATERIALIZED (
            SELECT pg_advisory_xact_lock(${lockIdentifierData}::bigint)
        )
        INSERT INTO ${tableReferenceData} (event_id, cache_tags)
        SELECT $1, $2::jsonb FROM invalidation_lock
        RETURNING invalidation_id
    `;

}
