/** @param {ReturnType<typeof import('@solcorp/layer-pwa').layerPwaCapabilitiesCreate>} pwa @param {number} unreadCount */
export async function unreadBadgeApply( pwa, unreadCount ){
    //Keeping the in-app counter usable when platform badging is unavailable
    if ( pwa.badge.getCapability().supported === false ){
        return {applied: false, reason: 'unavailable'};

    }

    try {
        //Clearing an empty badge instead of leaving a stale platform indicator
        if ( unreadCount === 0 ){
            await pwa.badge.clear();

        } else {
            await pwa.badge.set( unreadCount );

        }

        return {applied: true};

    } catch ( error ){
        //Handling platform refusal without losing the application's own counter
        let reason = 'platform-refused';
        if ( error instanceof Error && 'code' in error && typeof error.code === 'string' ){
            reason = error.code;

        }
        return {applied: false, reason};

    }

}
