import {layerSystemTableReferenceCreate} from './system-schema.js';

/**
 * @param {unknown} valueData
 * @param {string} fieldNameData
 */
function leaseIdentityAssert( valueData, fieldNameData ){
    if (
        typeof valueData !== 'string' ||
        /^[a-zA-Z0-9:_-]{1,160}$/.test( valueData ) === false
    ){
        throw new TypeError( `${String( fieldNameData )} is invalid.` );

    }

}

/**
 * @param {object} managerOptionsData
 * @param {{systemSchema?: string, query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>}} managerOptionsData.database
 * @param {string} managerOptionsData.owner
 */
export function layerDatabaseLeaseManagerCreate( managerOptionsData ){
    leaseIdentityAssert( managerOptionsData.owner, 'Lease owner' );

    if ( typeof managerOptionsData.database?.query !== 'function' ){
        throw new TypeError( 'Database lease manager requires a database.' );

    }

    const leasesTableData = layerSystemTableReferenceCreate(
        managerOptionsData.database,
        'sys_leases'
    );
    const leaseBoundsAssert = function( /** @type {string} */ leaseKeyData, /** @type {number} */ timeToLiveData ){
        leaseIdentityAssert( leaseKeyData, 'Lease key' );

        if (
            Number.isInteger( timeToLiveData ) === false ||
            Number( timeToLiveData ) < Number( 1000 ) ||
            Number( timeToLiveData ) > Number( 3600000 )
        ){
            throw new TypeError( 'Lease TTL is invalid.' );

        }

    };

    return Object.freeze({
        /** @param {string} leaseKeyData @param {number} timeToLiveData */
        async acquire( leaseKeyData, timeToLiveData ){
            leaseBoundsAssert( leaseKeyData, timeToLiveData );

            const leaseResultData = await managerOptionsData.database.query({
                text: `
                    INSERT INTO ${String( leasesTableData )} (lease_key, lease_owner, lease_until, updated_at)
                    VALUES ($1, $2, now() + ($3 * interval '1 millisecond'), now())
                    ON CONFLICT (lease_key) DO UPDATE
                    SET lease_owner = EXCLUDED.lease_owner,
                        lease_until = EXCLUDED.lease_until,
                        updated_at = now()
                    WHERE ${String( leasesTableData )}.lease_until <= now()
                        OR ${String( leasesTableData )}.lease_owner = EXCLUDED.lease_owner
                    RETURNING lease_owner
                `,
                values: [
                    leaseKeyData,
                    managerOptionsData.owner,
                    timeToLiveData
                ]
            });

            return String( leaseResultData.rows[0]?.lease_owner ?? '' ) === managerOptionsData.owner;

        },

        /** @param {string} leaseKeyData @param {number} timeToLiveData */
        async renew( leaseKeyData, timeToLiveData ){
            leaseBoundsAssert( leaseKeyData, timeToLiveData );

            const leaseResultData = await managerOptionsData.database.query({
                text: `
                    UPDATE ${String( leasesTableData )}
                    SET lease_until = now() + ($3 * interval '1 millisecond'),
                        updated_at = now()
                    WHERE lease_key = $1
                        AND lease_owner = $2
                        AND lease_until > now()
                    RETURNING lease_owner
                `,
                values: [
                    leaseKeyData,
                    managerOptionsData.owner,
                    timeToLiveData
                ]
            });

            return String( leaseResultData.rows[0]?.lease_owner ?? '' ) === managerOptionsData.owner;

        },

        /** @param {string} leaseKeyData */
        async release( leaseKeyData ){
            leaseIdentityAssert( leaseKeyData, 'Lease key' );

            const leaseResultData = await managerOptionsData.database.query({
                text: `
                    DELETE FROM ${String( leasesTableData )}
                    WHERE lease_key = $1 AND lease_owner = $2
                `,
                values: [
                    leaseKeyData,
                    managerOptionsData.owner
                ]
            });

            return Number( leaseResultData.rowCount ?? 0 ) > Number( 0 );

        }
    });

}
