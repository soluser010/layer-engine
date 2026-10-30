const opaqueTokenPatternData = /^[A-Za-z0-9_-]{32,512}$/u;


/**
 * Creates the request-local response capability exposed only to system
 * operations. Ordinary application operations never receive this object.
 *
 * @param {{secure: boolean}} effectOptions
 */
export function layerResponseEffectsCreate( effectOptions ){
    const responseCookiesData = /** @type {string[]} */ ([]);
    let sessionCookieNameData = 'layer_session';
    let csrfCookieNameData = 'layer_csrf';

    //Using host-only cookie names whenever the response is protected by HTTPS
    if ( effectOptions.secure === true ){
        sessionCookieNameData = '__Host-layer_session';
        csrfCookieNameData = '__Host-layer_csrf';

    }

    return Object.freeze({
        /**
         * @param {{sessionToken: string, csrfToken: string, maximumAgeSeconds: number}} sessionData
         */
        authSessionSet( sessionData ){
            //Checking opaque values and bounded lifetime before creating headers
            if (
                opaqueTokenPatternData.test( sessionData.sessionToken ) === false ||
                opaqueTokenPatternData.test( sessionData.csrfToken ) === false ||
                Number.isInteger( sessionData.maximumAgeSeconds ) === false ||
                Number( sessionData.maximumAgeSeconds ) < Number( 1 ) ||
                Number( sessionData.maximumAgeSeconds ) > Number( 31536000 )
            ){
                throw new TypeError( 'Auth session response effect is invalid.' );

            }

            let secureAttributeData = '';

            //Adding the Secure attribute only for HTTPS responses
            if ( effectOptions.secure === true ){
                secureAttributeData = '; Secure';

            }

            //Adding the HttpOnly identity cookie and readable CSRF double-submit cookie
            responseCookiesData.push(
                `${String( sessionCookieNameData )}=${String( sessionData.sessionToken )}; Path=/; Max-Age=${Number( sessionData.maximumAgeSeconds )}; HttpOnly; SameSite=Lax${String( secureAttributeData )}`,
                `${String( csrfCookieNameData )}=${String( sessionData.csrfToken )}; Path=/; Max-Age=${Number( sessionData.maximumAgeSeconds )}; SameSite=Lax${String( secureAttributeData )}`
            );

        },

        authSessionClear(){
            let secureAttributeData = '';

            //Matching the issuance attributes so both cookies are removed reliably
            if ( effectOptions.secure === true ){
                secureAttributeData = '; Secure';

            }

            //Expiring both cookies with the same origin/path contract used at issuance
            responseCookiesData.push(
                `${String( sessionCookieNameData )}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${String( secureAttributeData )}`,
                `${String( csrfCookieNameData )}=; Path=/; Max-Age=0; SameSite=Lax${String( secureAttributeData )}`
            );

        },

        headersGet(){
            //Returning an isolated header array only after successful execution
            if ( Number( responseCookiesData.length ) === Number( 0 ) ){
                return Object.freeze({});

            }

            return Object.freeze({
                'set-cookie': Object.freeze([...responseCookiesData])
            });

        }
    });

}
