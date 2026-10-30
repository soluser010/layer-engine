import {LayerCliError} from './cli-error.js';

const permissionsPolicyFeatures = Object.freeze(['camera', 'microphone', 'geolocation', 'payment']);

const contentSecuritySourceDirectives = Object.freeze([
    'script-src', 'style-src', 'connect-src', 'img-src', 'media-src', 'font-src',
    'frame-src', 'child-src', 'worker-src', 'manifest-src'
]);
const contentSecuritySchemeDirectives = /** @type {Readonly<Record<string, readonly string[]>>} */ (Object.freeze({
    'data:': Object.freeze(['img-src', 'font-src']),
    'blob:': Object.freeze(['style-src', 'img-src', 'media-src', 'worker-src'])
}));


/** @param {string} configurationPathData @param {string} explanationData @returns {never} */
//Function for rejecting invalid policy input with a source-addressable diagnostic
const contentSecurityConfigurationReject = function( configurationPathData, explanationData ){
    //Passing the invalid field path without reflecting its supplied value
    throw new LayerCliError( 'CLI_CONFIG_INVALID', String( explanationData ), {path: String( configurationPathData )} );

};

/** @param {unknown} configurationData @returns {configurationData is Record<string, unknown>} */
//Function for checking a plain configuration envelope before reading its fields
const contentSecurityObjectCheck = function( configurationData ){
    //Checking both ordinary literals and deliberately prototype-free records
    if ( configurationData === null || typeof configurationData !== String( 'object' ) ){
        //CallBack THE BOOLEAN
        return false;

    }

    //Getting the envelope prototype without accepting arrays or class instances
    const configurationPrototypeData = Object.getPrototypeOf( configurationData );

    //CallBack THE BOOLEAN
    return configurationPrototypeData === Object.prototype || configurationPrototypeData === null;

};

/** @param {unknown} sourceData @param {string} directiveData @param {string} configurationPathData */
//Function for normalizing one additional resource source without header or Caddy injection
const contentSecuritySourceNormalize = function( sourceData, directiveData, configurationPathData ){
    //Rejecting policy delimiters, source keywords and unbounded protocol wildcards
    if ( typeof sourceData !== 'string' || sourceData.length > Number( 500 ) ||
        /[\s'";{},\\]/u.test( sourceData ) || sourceData.length === Number( 0 ) ){
        //Passing an invalid source to the configuration caller
        contentSecurityConfigurationReject( configurationPathData, 'CSP sources must be explicit HTTP(S) origins or supported data:/blob: schemes.' );

    }

    //Preparing the checked textual source for the remaining normalization steps
    const sourceTextData = String( sourceData );

    //Allowing local resource schemes only in the directives where they are meaningful
    if ( Object.hasOwn( contentSecuritySchemeDirectives, sourceTextData ) ){
        //Checking whether this resource type supports the selected scheme
        if ( ( contentSecuritySchemeDirectives[sourceTextData] ?? [] ).includes( directiveData ) === false ){
            //Passing an incompatible scheme to the configuration caller
            contentSecurityConfigurationReject( configurationPathData, 'The CSP resource scheme is not supported for this directive.' );

        }

        //CallBack THE STRING
        return sourceTextData;

    }

    //Separating the single supported subdomain wildcard before parsing the origin
    const wildcardStatusData = /^(?:https|wss):\/\/\*\./iu.test( sourceTextData );
    const originInputData = sourceTextData.replace( '://*.', '://' );
    let originData;

    //Parsing the origin while keeping malformed source values out of diagnostics
    try {
        originData = new URL( originInputData );

    } catch( error ){
        //Passing URL syntax failures through the stable configuration contract
        if ( error instanceof TypeError ){
            contentSecurityConfigurationReject( configurationPathData, 'The CSP source origin is invalid.' );

        }

        //Propagating unexpected parser failures
        throw error;

    }

    //Checking transport, credentials and path boundaries before serializing a header
    const loopbackStatusData = ['localhost', '127.0.0.1', '[::1]'].includes( originData.hostname );
    const socketStatusData = originData.protocol === String( 'wss:' ) || originData.protocol === String( 'ws:' );
    const secureStatusData = originData.protocol === String( 'https:' ) || originData.protocol === String( 'wss:' );
    const localPlaintextStatusData = loopbackStatusData &&
        ( originData.protocol === String( 'http:' ) || originData.protocol === String( 'ws:' ) );

    //Rejecting remote plaintext, arbitrary paths and websocket sources outside connect-src
    if ( ( secureStatusData === false && localPlaintextStatusData === false ) ||
        ( socketStatusData && directiveData !== String( 'connect-src' ) ) ||
        originData.username !== String() || originData.password !== String() ||
        originData.pathname !== String( '/' ) || originData.search !== String() || originData.hash !== String() ||
        /[^a-z0-9.\-:[\]]/u.test( originData.hostname ) ){
        //Passing an unsupported origin to the configuration caller
        contentSecurityConfigurationReject( configurationPathData, 'CSP sources require secure origins without credentials, paths, queries or fragments; plaintext is loopback-only.' );

    }

    //Keeping wildcard permissions limited to real DNS subdomains rather than IP addresses
    if ( wildcardStatusData && ( loopbackStatusData || originData.hostname.includes( '.' ) === false ||
        /^[0-9.]+$/u.test( originData.hostname ) ) ){
        //Passing an unsupported wildcard host to the configuration caller
        contentSecurityConfigurationReject( configurationPathData, 'CSP wildcards require a DNS parent domain.' );

    }

    //Restoring the validated wildcard after canonical URL normalization
    let normalizedSourceData = String( originData.origin );
    if ( wildcardStatusData ){
        normalizedSourceData = normalizedSourceData.replace( '://', '://*.' );

    }

    //CallBack THE STRING
    return normalizedSourceData;

};

/** @param {unknown} securityConfigurationData */
//Function for creating additive CSP permissions while preserving the framework defaults
export const layerSecurityConfigurationCreate = function( securityConfigurationData ){
    //Using an empty envelope when security configuration was not supplied
    let securityData = securityConfigurationData;
    if ( securityData === undefined || securityData === null ){
        securityData = {};

    }

    //Checking the security envelope before reading either supported policy subsystem
    if ( contentSecurityObjectCheck( securityData ) === false ||
        Object.keys( securityData ).some(function( fieldData ){
            //Finding fields outside the public security contract
            return !['csp', 'permissionsPolicy'].includes( fieldData );

        }) ){
        //Passing unknown security fields to the configuration caller
        contentSecurityConfigurationReject( 'security', 'security supports only csp and permissionsPolicy configuration.' );

    }

    //Getting optional policy additions without removing any default source
    const securityEnvelopeData = /** @type {Record<string, unknown>} */ (securityData);
    const policyData = securityEnvelopeData.csp ?? {};
    if ( contentSecurityObjectCheck( policyData ) === false ||
        Object.keys( policyData ).some(function( fieldData ){
            //Finding fields outside the additive source permissions
            return fieldData !== String( 'sources' );

        }) ){
        //Passing unknown policy fields to the configuration caller
        contentSecurityConfigurationReject( 'security.csp', 'security.csp supports only additive sources.' );

    }

    //Checking source directives before normalizing their permission lists
    const policyEnvelopeData = /** @type {Record<string, unknown>} */ (policyData);
    const sourcesData = policyEnvelopeData.sources ?? {};
    if ( contentSecurityObjectCheck( sourcesData ) === false ){
        //Passing an invalid directives envelope to the configuration caller
        contentSecurityConfigurationReject( 'security.csp.sources', 'security.csp.sources must be an object of resource directives.' );

    }

    //Creating an immutable permission record in a deterministic directive order
    const sourcesEnvelopeData = /** @type {Record<string, unknown>} */ (sourcesData);
    const normalizedSourcesData = /** @type {Record<string, readonly string[]>} */ ({});
    for ( const directiveData of Object.keys( sourcesData ) ){
        //Rejecting protected or unknown directives instead of overriding the policy
        if ( contentSecuritySourceDirectives.includes( directiveData ) === false ){
            //Passing the exact unknown directive path to the configuration caller
            contentSecurityConfigurationReject( 'security.csp.sources.' + String( directiveData ), 'The CSP resource directive is not supported.' );

        }

    }

    //Normalizing each configured list and eliminating duplicate source permissions
    for ( const directiveData of contentSecuritySourceDirectives ){
        //Skipping directives that rely entirely on their original defaults
        if ( Object.hasOwn( sourcesData, directiveData ) === false ){
            //Next the cycle
            continue;

        }

        //Checking list bounds before inspecting any source values
        const sourceListData = sourcesEnvelopeData[directiveData];
        const directivePathData = 'security.csp.sources.' + String( directiveData );
        if ( Array.isArray( sourceListData ) === false || sourceListData.length > Number( 32 ) ){
            //Passing an invalid permission list to the configuration caller
            contentSecurityConfigurationReject( directivePathData, 'Each CSP directive requires an array of at most 32 sources.' );

        }

        //Preparing canonical origins separately from the immutable outgoing record
        const sourceValuesData = /** @type {unknown[]} */ (sourceListData);
        const normalizedListData = [];
        for ( let sourceIndexData = Number( 0 ); sourceIndexData < sourceValuesData.length; sourceIndexData++ ){
            //Normalizing every indexed source, including invalid sparse array entries
            const normalizedSourceData = contentSecuritySourceNormalize(
                sourceValuesData[sourceIndexData], directiveData, directivePathData + '[' + Number( sourceIndexData ) + ']'
            );
            normalizedListData.push( normalizedSourceData );

        }
        normalizedSourcesData[directiveData] = Object.freeze( Array.from( new Set( normalizedListData ) ) );

    }

    //Bounding the complete header contribution instead of allowing many large source lists
    if ( JSON.stringify( normalizedSourcesData ).length > Number( 6000 ) ){
        //Passing an oversized policy to the configuration caller before any server starts
        contentSecurityConfigurationReject( 'security.csp.sources', 'The total CSP source configuration must not exceed 6000 characters.' );

    }

    //Validating explicit device permissions without granting arbitrary origins or wildcards
    let permissionsPolicyData = /** @type {Readonly<Record<string, readonly string[]>> | undefined} */ (undefined);
    if ( securityEnvelopeData.permissionsPolicy !== undefined ){
        //Checking the device policy envelope before reading any feature values
        const suppliedPermissionsData = securityEnvelopeData.permissionsPolicy;
        if ( contentSecurityObjectCheck( suppliedPermissionsData ) === false ){
            //Passing an invalid policy envelope to the configuration caller
            contentSecurityConfigurationReject( 'security.permissionsPolicy', 'Permissions-Policy must be an object of supported features.' );

        }
        //Rejecting feature names outside the explicitly supported device capabilities
        const validatedPermissionsData = /** @type {Record<string, unknown>} */ (suppliedPermissionsData);
        for ( const featureData of Object.keys( validatedPermissionsData ) ){
            //Checking the feature before constructing its normalized permission list
            if ( permissionsPolicyFeatures.includes( featureData ) === false ){
                //Passing an unknown feature path without reflecting its supplied value
                contentSecurityConfigurationReject( 'security.permissionsPolicy.' + featureData, 'The Permissions-Policy feature is not supported.' );

            }

        }
        //Creating every capability with a denied default before accepting explicit self access
        const normalizedPermissionsData = /** @type {Record<string, readonly string[]>} */ ({});
        for ( const featureData of permissionsPolicyFeatures ){
            //Reading only an own feature field so inherited values cannot grant device access
            let featureSourcesData = /** @type {unknown} */ ([]);
            if ( Object.hasOwn( validatedPermissionsData, featureData ) ){
                featureSourcesData = validatedPermissionsData[featureData];

            }

            //Accepting only a denied capability or one self-origin permission
            if ( Array.isArray( featureSourcesData ) === false || featureSourcesData.length > Number( 1 ) ||
                (featureSourcesData.length === Number( 1 ) && featureSourcesData[0] !== String( 'self' )) ){
                //Passing an invalid permission list to the configuration caller
                contentSecurityConfigurationReject( 'security.permissionsPolicy.' + featureData, 'Device permissions require an empty list or a single self origin.' );

            }

            //Cloning and freezing caller arrays before storing the validated policy
            normalizedPermissionsData[featureData] = Object.freeze( /** @type {string[]} */ (featureSourcesData).slice() );

        }

        //Publishing the immutable complete capability policy
        permissionsPolicyData = Object.freeze( normalizedPermissionsData );

    }

    //Keeping absent permissions absent so existing development headers remain compatible
    const normalizedPolicyData = Object.freeze({sources: Object.freeze( normalizedSourcesData )});
    const normalizedSecurityData = /** @type {{csp: typeof normalizedPolicyData, permissionsPolicy?: Readonly<Record<string, readonly string[]>>}} */ ({
        csp: normalizedPolicyData
    });
    if ( permissionsPolicyData !== undefined ){
        normalizedSecurityData.permissionsPolicy = permissionsPolicyData;

    }

    //CallBack THE OBJECT
    return Object.freeze( normalizedSecurityData );

};

/** @param {unknown} securityData */
//Function for rendering bounded device permissions with the unchanged deny-by-default production policy
export const layerPermissionsPolicyCreate = function( securityData ){
    //Getting a validated policy before emitting a browser header
    const configurationData = layerSecurityConfigurationCreate( securityData );
    const permissionPartsData = permissionsPolicyFeatures.map(function( featureData ){
        //Serializing only previously validated self permissions in deterministic order
        const featureSourcesData = configurationData.permissionsPolicy?.[featureData] ?? [];

        //CallBack THE STRING
        return String( featureData ) + '=(' + featureSourcesData.join( ' ' ) + ')';

    });

    //CallBack THE STRING
    return permissionPartsData.join( ', ' );

};

/** @param {unknown} securityData @param {'development' | 'production'} [modeData] */
//Function for rendering the same configured resource permissions for development and production
export const layerContentSecurityPolicyCreate = function( securityData, modeData = 'production' ){
    //Checking both caller-supplied and already normalized configuration before serialization
    const configurationData = layerSecurityConfigurationCreate( securityData );
    if ( ['development', 'production'].includes( modeData ) === false ){
        //Passing an unsupported rendering mode to the caller
        throw new TypeError( 'The CSP rendering mode is invalid.' );

    }

    //Keeping the existing protective defaults and resource sources
    const directiveSourcesData = /** @type {Record<string, string[]>} */ ({
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'connect-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:'],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'frame-ancestors': ["'none'"]
    });

    //Preserving the development-only style tooling exception
    if ( modeData === String( 'development' ) ){
        const developmentStyleSourcesData = /** @type {string[]} */ (directiveSourcesData['style-src']);
        developmentStyleSourcesData.push( "'unsafe-inline'" );

    } else {
        //Keeping production Trusted Types without allowing child-src to broaden workers in development
        directiveSourcesData['require-trusted-types-for'] = ["'script'"];

    }

    //Adding configured origins without replacing inherited self permissions
    for ( const [directiveData, additionalSourcesData] of Object.entries( configurationData.csp.sources ) ){
        //Creating explicit defaults for directives that previously inherited default-src
        if ( Object.hasOwn( directiveSourcesData, directiveData ) === false ){
            directiveSourcesData[directiveData] = ["'self'"];

        }

        //Recording unique additional sources in the serialized directive
        const inheritedSourcesData = /** @type {string[]} */ (directiveSourcesData[directiveData]);
        directiveSourcesData[directiveData] = Array.from( new Set( [...inheritedSourcesData, ...additionalSourcesData] ) );

    }

    //Preparing the bounded HTTP header from validated source values
    const policyPartsData = Object.entries( directiveSourcesData ).map(function( [directiveData, sourceListData] ){
        //Formatting one directive without injecting unvalidated policy text
        return String( directiveData ) + ' ' + sourceListData.join( ' ' );

    });

    //CallBack THE STRING
    return policyPartsData.join( '; ' );

};
