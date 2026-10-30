/**
 * @typedef {Readonly<{
 *     consume: (requestData: any) => Promise<Readonly<{allowed: boolean, remaining: number, retryAfterMs: number}>> | Readonly<{allowed: boolean, remaining: number, retryAfterMs: number}>
 * }>} LayerRateLimiter
 */

/**
 * @param {object} limiterOptionsData
 * @param {LayerRateLimiter} limiterOptionsData.primary
 * @param {LayerRateLimiter} limiterOptionsData.fallback
 * @param {() => boolean} [limiterOptionsData.primaryReady]
 * @param {{record: (diagnosticData: Record<string, unknown>) => void}} [limiterOptionsData.diagnostics]
 * @param {number} [limiterOptionsData.recoveryCooldownMs]
 * @param {() => number} [limiterOptionsData.clock]
 */
export function layerRateLimiterFailoverCreate( limiterOptionsData ){
    const primaryReadyData = limiterOptionsData.primaryReady ?? function primaryReadyDefault(){
        return true;

    };
    const recoveryCooldownMsData = limiterOptionsData.recoveryCooldownMs ?? Number( 5000 );
    const clockData = limiterOptionsData.clock ?? Date.now;
    let primaryRetryAtData = Number( 0 );

    if (
        typeof limiterOptionsData.primary?.consume !== 'function' ||
        typeof limiterOptionsData.fallback?.consume !== 'function' ||
        typeof primaryReadyData !== 'function'
    ){
        throw new TypeError( 'Rate limiter failover requires primary and fallback limiters.' );

    }

    if (
        Number.isInteger( recoveryCooldownMsData ) === false ||
        Number( recoveryCooldownMsData ) < Number( 100 ) ||
        Number( recoveryCooldownMsData ) > Number( 60000 )
    ){
        throw new TypeError( 'Rate limiter failover cooldown is invalid.' );

    }

    return Object.freeze({
        /** @param {any} requestData */
        async consume( requestData ){
            const currentTimeData = Number( clockData() );
            const primaryAllowedStatusData = (
                Number.isFinite( currentTimeData ) === true &&
                Number( currentTimeData ) >= Number( primaryRetryAtData ) &&
                primaryReadyData() === true
            );

            if ( primaryAllowedStatusData === true ){
                try {
                    return await limiterOptionsData.primary.consume( requestData );

                } catch( primaryErrorData ){
                    primaryRetryAtData = Number( currentTimeData ) + Number( recoveryCooldownMsData );
                    let diagnosticCodeData = String( 'DEPENDENCY_UNAVAILABLE' );

                    if ( typeof primaryErrorData === 'object' && primaryErrorData !== null && 'code' in primaryErrorData ){
                        diagnosticCodeData = String( primaryErrorData.code );

                    }

                    limiterOptionsData.diagnostics?.record({
                        level: 'warning',
                        event: 'rate-limit.primary-unavailable',
                        code: diagnosticCodeData
                    });

                }

            }

            return limiterOptionsData.fallback.consume( requestData );

        },

        isPrimaryAvailable(){
            const currentTimeData = Number( clockData() );

            return (
                Number.isFinite( currentTimeData ) === true &&
                Number( currentTimeData ) >= Number( primaryRetryAtData ) &&
                primaryReadyData() === true
            );

        }
    });

}
