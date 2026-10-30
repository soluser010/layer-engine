import {layerSystemTableReferenceCreate} from './system-schema.js';
import {cacheInvalidationInsertSqlCreate} from './cache-invalidation-sql.js';

const cacheScopesData = Object.freeze([
    'global',
    'tenant',
    'user'
]);

/**
 * @param {unknown} tagsData
 * @returns {readonly string[]}
 */
function cacheTagsNormalize( tagsData ){
    if ( Array.isArray( tagsData ) === false || Number( tagsData.length ) < Number( 1 ) || Number( tagsData.length ) > Number( 16 ) ){
        throw new TypeError( 'Cache invalidation tags are invalid.' );

    }

    const normalizedTagsData = tagsData.map(function cacheTagNormalize( tagData ){
        if ( typeof tagData !== 'string' || /^[a-z][a-z0-9:_-]{0,79}$/.test( tagData ) === false ){
            throw new TypeError( 'Cache invalidation tag is invalid.' );

        }

        return tagData;

    });

    if ( Number( new Set( normalizedTagsData ).size ) !== Number( normalizedTagsData.length ) ){
        throw new TypeError( 'Cache invalidation tags contain duplicates.' );

    }

    return Object.freeze( normalizedTagsData );

}

/**
 * @param {object} repositoryOptionsData
 * @param {{systemSchema?: string, query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>}} repositoryOptionsData.database
 */
export function layerCacheInvalidationRepositoryCreate( repositoryOptionsData ){
    if ( typeof repositoryOptionsData.database?.query !== 'function' ){
        throw new TypeError( 'Cache invalidation repository requires a database.' );

    }

    const invalidationsTableData = layerSystemTableReferenceCreate(
        repositoryOptionsData.database,
        'sys_cache_invalidations'
    );

    return Object.freeze({
        /**
         * @param {object} invalidationData
         * @param {string} invalidationData.eventId
         * @param {'global' | 'tenant' | 'user'} invalidationData.scope
         * @param {string | null} invalidationData.tenantId
         * @param {string | null} invalidationData.userId
         * @param {readonly string[]} invalidationData.tags
         */
        async record( invalidationData ){
            const normalizedTagsData = cacheTagsNormalize( invalidationData.tags );

            if (
                typeof invalidationData.eventId !== 'string' ||
                Number( invalidationData.eventId.length ) < Number( 1 ) ||
                Number( invalidationData.eventId.length ) > Number( 160 ) ||
                cacheScopesData.includes( invalidationData.scope ) === false
            ){
                throw new TypeError( 'Cache invalidation identity is invalid.' );

            }

            if (
                invalidationData.scope === 'tenant' &&
                (typeof invalidationData.tenantId !== 'string' || Number( invalidationData.tenantId.length ) < Number( 1 ))
            ){
                throw new TypeError( 'Tenant cache invalidation requires tenant identity.' );

            }

            if (
                invalidationData.scope === 'user' &&
                (typeof invalidationData.userId !== 'string' || Number( invalidationData.userId.length ) < Number( 1 ))
            ){
                throw new TypeError( 'User cache invalidation requires user identity.' );

            }

            const invalidationEnvelopeData = Object.freeze({
                scope: invalidationData.scope,
                tenantId: invalidationData.tenantId,
                userId: invalidationData.userId,
                tags: normalizedTagsData
            });
            const invalidationResultData = await repositoryOptionsData.database.query({
                text: cacheInvalidationInsertSqlCreate( invalidationsTableData ),
                values: [
                    invalidationData.eventId,
                    JSON.stringify( invalidationEnvelopeData )
                ]
            });

            return Number( invalidationResultData.rows[0]?.invalidation_id );

        },

        /**
         * @param {object} replayData
         * @param {number} replayData.cursor
         * @param {number} [replayData.limit]
         */
        async readAfter( replayData ){
            const replayLimitData = replayData.limit ?? Number( 100 );

            if (
                Number.isSafeInteger( replayData.cursor ) === false ||
                Number( replayData.cursor ) < Number( 0 ) ||
                Number.isSafeInteger( replayLimitData ) === false ||
                Number( replayLimitData ) < Number( 1 ) ||
                Number( replayLimitData ) > Number( 1000 )
            ){
                throw new TypeError( 'Cache invalidation replay bounds are invalid.' );

            }

            const invalidationResultData = await repositoryOptionsData.database.query({
                text: `
                    SELECT invalidation_id, event_id, cache_tags, occurred_at
                    FROM ${String( invalidationsTableData )}
                    WHERE invalidation_id > $1
                    ORDER BY invalidation_id ASC
                    LIMIT $2
                `,
                values: [
                    replayData.cursor,
                    replayLimitData
                ]
            });

            return Object.freeze( invalidationResultData.rows.map(function invalidationRowNormalize( rowData ){
                let invalidationEnvelopeData = rowData.cache_tags;

                if ( typeof invalidationEnvelopeData === 'string' ){
                    invalidationEnvelopeData = JSON.parse( invalidationEnvelopeData );

                }

                return Object.freeze({
                    invalidationId: Number( rowData.invalidation_id ),
                    eventId: String( rowData.event_id ),
                    occurredAt: new Date( /** @type {string | number | Date} */ (rowData.occurred_at) ).toISOString(),
                    .../** @type {Record<string, unknown>} */ (invalidationEnvelopeData)
                });

            }) );

        }
    });

}
