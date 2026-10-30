import {LayerPwaError} from './pwa-error.js';

/**
 * @typedef {{packageName: string, sha256CertFingerprints: readonly string[]}} LayerAndroidAssociation
 * @typedef {{appId: string, paths: readonly string[]}} LayerAppleAssociation
 * @typedef {{packageFamilyName: string, paths: readonly string[], excludePaths: readonly string[]}} LayerWindowsAssociation
 * @typedef {{appId: string, scope: string}} LayerWebAssociation
 * @typedef {Readonly<{
 *     external: Readonly<{mode: 'viewer' | 'platform', allowedOrigins: readonly string[]}>,
 *     scopeExtensions: readonly string[],
 *     associations: Readonly<{
 *         android: readonly Readonly<{packageName: string, sha256CertFingerprints: readonly string[]}>[],
 *         apple: readonly Readonly<{appId: string, paths: readonly string[]}>[],
 *         windows: readonly Readonly<{packageFamilyName: string, paths: readonly string[], excludePaths: readonly string[]}>[],
 *         web: readonly Readonly<{appId: string, scope: string}>[]
 *     }>
 * }>} LayerLinksConfiguration
 */


/** @param {string} fieldPath @param {string} messageData */
//Function for rejecting association input without reflecting untrusted values
const configurationReject = function( fieldPath, messageData ){
    //Publishing a source-addressable path for the CLI diagnostic boundary
    throw new LayerPwaError( 'PWA_LINKS_CONFIG_INVALID', messageData, {details: {path: fieldPath}} );

};

/** @param {unknown} inputData @param {readonly string[]} fieldsData @param {string} fieldPath */
//Function for accepting only plain objects with explicitly known own properties
const objectRequire = function( inputData, fieldsData, fieldPath ){
    //Rejecting arrays, null and custom prototypes before inspecting fields
    if ( inputData === null || typeof inputData !== 'object' || Array.isArray( inputData ) ||
        ![Object.prototype, null].includes( Object.getPrototypeOf( inputData ) ) ){
        //Passing the invalid object shape to the caller
        configurationReject( fieldPath, fieldPath + ' must be a plain object.' );

    }
    const objectData = /** @type {Record<string, any>} */ (inputData);
    for ( const fieldName of Object.keys( objectData ) ){
        //Rejecting typos rather than silently widening link permissions
        if ( !fieldsData.includes( fieldName ) ){
            //Passing the exact unknown field to the diagnostic boundary
            configurationReject( fieldPath + '.' + fieldName, 'Unknown link configuration field.' );

        }

    }

    //CallBack THE OBJECT
    return objectData;

};

/** @param {unknown} inputData @param {string} fieldPath @returns {unknown[]} */
//Function for bounding every configurable list before normalizing its entries
const listRequire = function( inputData, fieldPath ){
    //Checking the list budget before processing platform metadata
    if ( !Array.isArray( inputData ) || inputData.length > 32 ){
        //Passing an invalid or oversized list to the caller
        configurationReject( fieldPath, fieldPath + ' requires an array of at most 32 entries.' );

    }

    //CallBack THE OBJECT
    return /** @type {unknown[]} */ (inputData);

};

/** @param {unknown} inputData @param {string} fieldPath @param {boolean} developmentStatus */
//Function for normalizing exact origins without accepting paths, credentials or wildcard grants
const originCreate = function( inputData, fieldPath, developmentStatus ){
    //Checking text and length before the URL parser can normalize it
    if ( typeof inputData !== 'string' || inputData.length > 512 || /[\s*\\?#]/u.test( inputData ) ){
        //Passing unsafe origin syntax to the caller
        configurationReject( fieldPath, 'Use an exact HTTPS origin without paths or credentials.' );

    }
    let originUrl;
    try {
        //Parsing without a base so relative values never become origins
        originUrl = new URL( /** @type {string} */ (inputData) );

    } catch( originParseError ){
        //Reporting invalid URL syntax without exposing its input
        void originParseError;
        configurationReject( fieldPath, 'Use an absolute HTTPS origin.' );

    }
    const normalizedUrl = /** @type {URL} */ (originUrl);
    const localPlaintextStatus = developmentStatus && normalizedUrl.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes( normalizedUrl.hostname );
    if ( normalizedUrl.username !== '' || normalizedUrl.password !== '' || normalizedUrl.pathname !== '/' ||
        normalizedUrl.search !== '' || normalizedUrl.hash !== '' ||
        (normalizedUrl.protocol !== 'https:' && !localPlaintextStatus) ){
        //Rejecting plaintext remote hosts and permission scopes hidden in URL components
        configurationReject( fieldPath, 'HTTPS is required; HTTP is allowed only for loopback development.' );

    }

    //CallBack THE STRING
    return normalizedUrl.origin;

};

/** @param {unknown} inputData @param {string} fieldPath @param {boolean} [windowsStatus] */
//Function for validating platform path patterns without accepting traversal or query syntax
const pathsCreate = function( inputData, fieldPath, windowsStatus = false ){
    //Cloning the bounded path list before validating each pattern
    const pathItems = listRequire( inputData, fieldPath );
    const normalizedPaths = [];
    let unsafePathPattern = /[\s\\?#%]/u;
    if (windowsStatus) {
        //Allowing Windows single-character wildcards without accepting encoded traversal
        unsafePathPattern = /[\s\\#%]/u;

    }
    for ( const [pathIndex, pathData] of pathItems.entries() ){
        //Allowing Windows' all-paths marker separately from slash-prefixed patterns
        if ( typeof pathData !== 'string' || pathData.length < 1 || pathData.length > 512 ||
            (!pathData.startsWith( '/' ) && !(windowsStatus && pathData === '*')) ||
            unsafePathPattern.test( pathData ) || pathData.startsWith( '//' ) || pathData.split( '/' ).includes( '..' ) ){
            //Passing the indexed path failure to the caller
            configurationReject( fieldPath + '[' + pathIndex + ']', 'Use a slash-prefixed path pattern without traversal.' );

        }
        normalizedPaths.push( /** @type {string} */ (pathData) );

    }

    //CallBack THE OBJECT
    return Object.freeze( Array.from( new Set( normalizedPaths ) ) );

};

/** @param {unknown} inputData @param {{development?: boolean}} [configurationOptions] @returns {LayerLinksConfiguration} */
//Function for creating the immutable browser-safe link and platform-association configuration
export const layerLinksConfigurationCreate = function( inputData, configurationOptions = {} ){
    //Reading strict envelopes while retaining safe defaults for existing projects
    const rootData = objectRequire( inputData ?? {}, ['external', 'scopeExtensions', 'associations'], 'links' );
    const externalData = objectRequire( rootData.external ?? {}, ['mode', 'allowedOrigins'], 'links.external' );
    const associationData = objectRequire( rootData.associations ?? {}, ['android', 'apple', 'windows', 'web'], 'links.associations' );
    const developmentStatus = configurationOptions.development === true;
    const modeData = externalData.mode ?? 'viewer';
    if ( !['viewer', 'platform'].includes( modeData ) ){
        //Passing unsupported external-link behavior to the caller
        configurationReject( 'links.external.mode', 'Use viewer or platform.' );

    }
    const originLists = /** @type {Record<string, readonly string[]>} */ ({});
    for ( const [listName, listData] of Object.entries({
        'external.allowedOrigins': externalData.allowedOrigins ?? [],
        scopeExtensions: rootData.scopeExtensions ?? []
    }) ){
        //Normalizing each origin independently without sharing mutable caller arrays
        const originItems = listRequire( listData, 'links.' + listName );
        const normalizedOrigins = [];
        for ( const [originIndex, originData] of originItems.entries() ){
            //Recording one verified origin at the indexed configuration path
            normalizedOrigins.push( originCreate( originData, 'links.' + listName + '[' + originIndex + ']', developmentStatus ) );

        }
        originLists[listName] = Object.freeze( Array.from( new Set( normalizedOrigins ) ).sort() );

    }
    const android = [];
    const apple = [];
    const windows = [];
    const web = [];
    for ( const [entryIndex, entryData] of listRequire( associationData.android ?? [], 'links.associations.android' ).entries() ){
        //Checking the real application ID and public signing-certificate fingerprints
        const entryPath = 'links.associations.android[' + entryIndex + ']';
        const entry = objectRequire( entryData, ['packageName', 'sha256CertFingerprints'], entryPath );
        if ( typeof entry.packageName !== 'string' || entry.packageName.length > 255 ||
            !/^[A-Za-z][A-Za-z0-9_]*(?:[.][A-Za-z][A-Za-z0-9_]*)+$/u.test( entry.packageName ) ){
            //Passing a malformed Android application ID to the caller
            configurationReject( entryPath + '.packageName', 'Use the Android applicationId, not a display name.' );

        }
        const fingerprintItems = listRequire( entry.sha256CertFingerprints, entryPath + '.sha256CertFingerprints' );
        if ( fingerprintItems.length === 0 ){
            //Requiring at least one actual signing certificate
            configurationReject( entryPath + '.sha256CertFingerprints', 'At least one SHA-256 certificate fingerprint is required.' );

        }
        const fingerprints = [];
        for ( const [fingerprintIndex, fingerprintData] of fingerprintItems.entries() ){
            //Checking all 32 certificate-hash bytes before canonical uppercase serialization
            if ( typeof fingerprintData !== 'string' || !/^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/iu.test( fingerprintData ) ){
                //Passing the indexed fingerprint failure without echoing its value
                configurationReject( entryPath + '.sha256CertFingerprints[' + fingerprintIndex + ']', 'Use 32 colon-separated SHA-256 bytes.' );

            }
            fingerprints.push( /** @type {string} */ (fingerprintData).toUpperCase() );

        }
        android.push( Object.freeze({packageName: entry.packageName, sha256CertFingerprints: Object.freeze( [...new Set( fingerprints )].sort() )}) );

    }
    for ( const [entryIndex, entryData] of listRequire( associationData.apple ?? [], 'links.associations.apple' ).entries() ){
        //Checking App ID prefix plus bundle ID rather than inventing an Apple identity
        const entryPath = 'links.associations.apple[' + entryIndex + ']';
        const entry = objectRequire( entryData, ['appId', 'paths'], entryPath );
        if ( typeof entry.appId !== 'string' || entry.appId.length > 255 || !/^[A-Z0-9]{10}[.][A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)+$/u.test( entry.appId ) ){
            //Passing an invalid Apple app identifier to the caller
            configurationReject( entryPath + '.appId', 'Use App ID prefix plus bundle identifier.' );

        }
        apple.push( Object.freeze({appId: entry.appId, paths: pathsCreate( entry.paths ?? ['/*'], entryPath + '.paths' )}) );

    }
    for ( const [entryIndex, entryData] of listRequire( associationData.windows ?? [], 'links.associations.windows' ).entries() ){
        //Checking the Windows package family identity before creating URL handler grants
        const entryPath = 'links.associations.windows[' + entryIndex + ']';
        const entry = objectRequire( entryData, ['packageFamilyName', 'paths', 'excludePaths'], entryPath );
        if ( typeof entry.packageFamilyName !== 'string' || entry.packageFamilyName.length > 255 ||
            !/^[A-Za-z0-9.-]+_[a-z0-9]{13}$/u.test( entry.packageFamilyName ) ){
            //Passing a malformed Package Family Name to the caller
            configurationReject( entryPath + '.packageFamilyName', 'Use the Windows Package Family Name.' );

        }
        windows.push( Object.freeze({
            packageFamilyName: entry.packageFamilyName,
            paths: pathsCreate( entry.paths ?? ['*'], entryPath + '.paths', true ),
            excludePaths: pathsCreate( entry.excludePaths ?? [], entryPath + '.excludePaths', true )
        }) );

    }
    for ( const [entryIndex, entryData] of listRequire( associationData.web ?? [], 'links.associations.web' ).entries() ){
        //Keeping the complete manifest ID, including its path, as the association key
        const entryPath = 'links.associations.web[' + entryIndex + ']';
        const entry = objectRequire( entryData, ['appId', 'scope'], entryPath );
        let applicationIdUrl;
        try {
            //Parsing a genuine absolute app ID without trusting arbitrary coercion
            if ( typeof entry.appId !== 'string' || entry.appId.length > 2048 ){
                throw new TypeError( 'App ID must be text.' );

            }
            applicationIdUrl = new URL( entry.appId );

        } catch( appIdError ){
            //Converting malformed application IDs into a safe indexed diagnostic
            void appIdError;
            configurationReject( entryPath + '.appId', 'Use the complete absolute manifest ID.' );

        }
        const validatedId = /** @type {URL} */ (applicationIdUrl);
        originCreate( validatedId.origin, entryPath + '.appId', developmentStatus );
        if ( validatedId.username !== '' || validatedId.password !== '' || validatedId.hash !== '' ){
            //Rejecting credentials and unstable fragments in a public application identity
            configurationReject( entryPath + '.appId', 'App IDs must not contain credentials or fragments.' );

        }
        const scope = pathsCreate( [entry.scope ?? '/'], entryPath + '.scope' )[0] ?? '/';
        if ( scope.includes( '*' ) ){
            //Keeping web scope an actual local path rather than a platform matcher
            configurationReject( entryPath + '.scope', 'Web association scope is a path, not a wildcard.' );

        }
        web.push( Object.freeze({appId: validatedId.href, scope}) );

    }
    for ( const [listName, entries] of Object.entries({android, apple, windows, web}) ){
        //Rejecting ambiguous duplicate identities instead of selecting one grant silently
        const identifiers = entries.map(function( entry ){
            //Selecting the platform-specific stable identifier for duplicate detection
            const recordData = /** @type {Record<string, any>} */ (entry);
            return recordData.packageName ?? recordData.appId ?? recordData.packageFamilyName;

        });
        if ( new Set( identifiers ).size !== identifiers.length ){
            //Passing the repeated platform identity to the caller
            configurationReject( 'links.associations.' + listName, 'Duplicate application association.' );

        }
        entries.sort(function( firstEntry, secondEntry ){
            //Keeping generated files deterministic regardless of application-list ordering
            const firstRecord = /** @type {Record<string, any>} */ (firstEntry);
            const secondRecord = /** @type {Record<string, any>} */ (secondEntry);
            return String( firstRecord.packageName ?? firstRecord.appId ?? firstRecord.packageFamilyName )
                .localeCompare( String( secondRecord.packageName ?? secondRecord.appId ?? secondRecord.packageFamilyName ), 'en' );

        });

    }

    //CallBack THE OBJECT
    return Object.freeze({
        external: Object.freeze({mode: modeData, allowedOrigins: originLists['external.allowedOrigins'] ?? []}),
        scopeExtensions: originLists.scopeExtensions ?? [],
        associations: Object.freeze({android: Object.freeze( android ), apple: Object.freeze( apple ), windows: Object.freeze( windows ), web: Object.freeze( web )})
    });

};
