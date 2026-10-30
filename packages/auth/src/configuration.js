import {LayerAuthError} from './auth-error.js';


const registrationModesData = Object.freeze([
    'admin-only',
    'disabled',
    'invite',
    'open'
]);
const authConfigurationFieldsData = Object.freeze([
    'anonymization',
    'authorizationResolve',
    'emailVerification',
    'enabled',
    'identifiers',
    'oauth',
    'oidc',
    'passkey',
    'password',
    'passwordRecovery',
    'registration',
    'secret',
    'session',
    'smtp',
    'totp'
]);


/**
 * @param {unknown} valueData
 * @returns {valueData is Record<string, any>}
 */
//Function for checking a plain configuration object
const plainObjectCheck = function( valueData ){
    //Rejecting arrays, null, class instances, and inherited configuration records
    if ( typeof valueData !== String( 'object' ) || valueData === null || Array.isArray( valueData ) === true ){
        //CallBack THE BOOLEAN
        return false;

    }

    const valuePrototypeData = Object.getPrototypeOf( valueData );

    //CallBack THE BOOLEAN
    return valuePrototypeData === Object.prototype || valuePrototypeData === null;

};

/**
 * @param {string} pathData
 * @param {string} messageData
 * @param {readonly string[]} [suggestionsData]
 * @returns {never}
 */
//Function for passing a field-specific Auth configuration error
const configurationErrorPass = function( pathData, messageData, suggestionsData = [] ){
    //Passing a bounded diagnostic without copying the rejected value
    throw new LayerAuthError(
        String( 'AUTH_CONFIG_INVALID' ),
        String( messageData ),
        Object.freeze({
            path: String( pathData ),
            suggestions: Object.freeze( suggestionsData.map( String ) )
        })
    );

};

/**
 * @param {unknown} objectData
 * @param {string} pathData
 * @param {readonly string[]} allowedFieldsData
 */
//Function for rejecting unknown fields in an Auth configuration object
const configurationFieldsCheck = function( objectData, pathData, allowedFieldsData ){
    //Checking the object shape before reading its fields
    if ( plainObjectCheck( objectData ) === false ){
        configurationErrorPass(
            pathData,
            `${String( pathData )} must be an object.`,
            [`Use ${String( pathData )}: null when the feature is optional.`]
        );

    }

    //Finding misspelled fields before normalizing defaults
    const objectRecordData = /** @type {Record<string, any>} */ (objectData);
    const unknownFieldsData = Object.keys( objectRecordData ).filter(function unknownFieldFind( fieldNameData ){
        //Keeping only fields that are absent from the strict configuration contract
        return allowedFieldsData.includes( fieldNameData ) === false;

    });

    if ( Number( unknownFieldsData.length ) > Number( 0 ) ){
        configurationErrorPass(
            pathData,
            `${String( pathData )} contains unknown fields.`,
            [String( 'Remove the unknown field or replace it with a documented Auth field.' )]
        );

    }

};

/**
 * @param {unknown} valueData
 * @param {string} pathData
 * @param {number} minimumData
 * @param {number} maximumData
 */
//Function for normalizing a bounded integer configuration value
const boundedIntegerCreate = function( valueData, pathData, minimumData, maximumData ){
    //Checking the integer before it can control a security or resource limit
    if (
        Number.isInteger( valueData ) === false ||
        Number( valueData ) < Number( minimumData ) ||
        Number( valueData ) > Number( maximumData )
    ){
        configurationErrorPass(
            pathData,
            `${String( pathData )} must be an integer between ${Number( minimumData )} and ${Number( maximumData )}.`
        );

    }

    //CallBack THE NUMBER
    return Number( valueData );

};

/**
 * @param {unknown} secretInputData
 * @param {string} pathData
 */
//Function for normalizing an optional ENV secret reference
const secretConfigurationCreate = function( secretInputData, pathData ){
    //Allowing state-managed development secrets without inventing a browser-visible value
    if ( secretInputData === null ){
        return null;

    }

    configurationFieldsCheck( secretInputData, pathData, ['env'] );
    const secretData = /** @type {Record<string, any>} */ (secretInputData);

    //Checking the ENV variable identifier without resolving its sensitive value
    if ( typeof secretData.env !== String( 'string' ) || /^[A-Z][A-Z0-9_]{2,127}$/u.test( secretData.env ) === false ){
        configurationErrorPass(
            `${String( pathData )}.env`,
            `${String( pathData )}.env must contain an uppercase ENV variable name.`,
            [String( "Use secret: {env: 'LAYER_AUTH_SECRET'}." )]
        );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        env: String( secretData.env )
    });

};

/**
 * @param {unknown} smtpInputData
 */
//Function for normalizing the SMTP configuration
const smtpConfigurationCreate = function( smtpInputData ){
    //Keeping email delivery explicitly disabled when SMTP was not selected
    if ( smtpInputData === null ){
        return null;

    }

    configurationFieldsCheck( smtpInputData, 'auth.smtp', [
        'from',
        'host',
        'password',
        'port',
        'secure',
        'username'
    ] );
    const smtpData = /** @type {Record<string, any>} */ (smtpInputData);

    //Checking bounded SMTP connection metadata without resolving credentials
    if ( typeof smtpData.host !== String( 'string' ) || Number( smtpData.host.length ) < Number( 1 ) || Number( smtpData.host.length ) > Number( 253 ) ){
        configurationErrorPass( 'auth.smtp.host', 'auth.smtp.host must contain a bounded hostname.' );

    }

    if ( typeof smtpData.from !== String( 'string' ) || Number( smtpData.from.length ) < Number( 3 ) || Number( smtpData.from.length ) > Number( 320 ) ){
        configurationErrorPass( 'auth.smtp.from', 'auth.smtp.from must contain a bounded sender address.' );

    }

    if ( smtpData.username !== null && typeof smtpData.username !== String( 'string' ) ){
        configurationErrorPass( 'auth.smtp.username', 'auth.smtp.username must be a string or null.' );

    }

    if ( typeof smtpData.secure !== String( 'boolean' ) ){
        configurationErrorPass( 'auth.smtp.secure', 'auth.smtp.secure must be a boolean.' );

    }

    let smtpUsernameData = null;

    //Keeping an omitted SMTP username explicit while normalizing configured credentials
    if ( smtpData.username !== null ){
        smtpUsernameData = String( smtpData.username );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        host: String( smtpData.host ),
        port: boundedIntegerCreate( smtpData.port, 'auth.smtp.port', 1, 65535 ),
        secure: Boolean( smtpData.secure ),
        username: smtpUsernameData,
        password: secretConfigurationCreate( smtpData.password, 'auth.smtp.password' ),
        from: String( smtpData.from )
    });

};

/** @param {unknown} passkeyInputData */
//Function for normalizing a strict WebAuthn relying-party configuration
const passkeyConfigurationCreate = function( passkeyInputData ){
    //Keeping Passkey explicitly disabled until an RP contract is configured
    if ( passkeyInputData === null ){
        return null;

    }

    configurationFieldsCheck( passkeyInputData, 'auth.passkey', [
        'origins',
        'rpId',
        'rpName',
        'timeoutMs',
        'userVerification'
    ] );
    const passkeyData = /** @type {Record<string, any>} */ (passkeyInputData);

    if (
        typeof passkeyData.rpId !== 'string' ||
        Number( passkeyData.rpId.length ) < Number( 1 ) ||
        Number( passkeyData.rpId.length ) > Number( 253 ) ||
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test( passkeyData.rpId ) === false ||
        passkeyData.rpId.includes( '..' ) === true
    ){
        configurationErrorPass( 'auth.passkey.rpId', 'auth.passkey.rpId must contain an ASCII hostname without scheme, path, port, or wildcard.' );

    }

    if ( typeof passkeyData.rpName !== 'string' || Number( passkeyData.rpName.length ) < Number( 1 ) || Number( passkeyData.rpName.length ) > Number( 120 ) ){
        configurationErrorPass( 'auth.passkey.rpName', 'auth.passkey.rpName must contain a bounded display name.' );

    }

    if ( Array.isArray( passkeyData.origins ) === false || Number( passkeyData.origins.length ) < Number( 1 ) || Number( passkeyData.origins.length ) > Number( 10 ) ){
        configurationErrorPass( 'auth.passkey.origins', 'auth.passkey.origins must contain 1 to 10 exact origins.' );

    }

    const originsData = /** @type {string[]} */ ([]);

    for ( const originInputData of passkeyData.origins ){
        if ( typeof originInputData !== 'string' ){
            configurationErrorPass( 'auth.passkey.origins', 'Every Passkey origin must be a string.' );

        }

        let originUrlData = /** @type {URL | null} */ (null);

        try {
            originUrlData = new URL( originInputData );

        } catch( originErrorData ){
            void originErrorData;
            configurationErrorPass( 'auth.passkey.origins', 'Every Passkey origin must be an absolute URL origin.' );

        }

        if ( originUrlData === null ){
            configurationErrorPass( 'auth.passkey.origins', 'Every Passkey origin must be an absolute URL origin.' );

        }
        const originUrlCheckedData = /** @type {URL} */ (originUrlData);

        const loopbackStatusData = ['127.0.0.1', 'localhost', '[::1]'].includes( originUrlCheckedData.hostname );

        if (
            originUrlCheckedData.origin !== originInputData ||
            (originUrlCheckedData.protocol !== String( 'https:' ) && !(originUrlCheckedData.protocol === String( 'http:' ) && loopbackStatusData === true)) ||
            originsData.includes( originInputData ) === true
        ){
            configurationErrorPass( 'auth.passkey.origins', 'Passkey origins must be unique HTTPS origins or loopback HTTP origins.' );

        }

        originsData.push( originInputData );

    }

    const userVerificationData = passkeyData.userVerification ?? 'required';

    if ( ['preferred', 'required'].includes( userVerificationData ) === false ){
        configurationErrorPass( 'auth.passkey.userVerification', 'Passkey userVerification must be required or preferred.' );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        rpId: String( passkeyData.rpId ),
        rpName: String( passkeyData.rpName ),
        origins: Object.freeze( originsData ),
        userVerification: String( userVerificationData ),
        timeoutMs: boundedIntegerCreate( passkeyData.timeoutMs ?? 60000, 'auth.passkey.timeoutMs', 15000, 120000 )
    });

};

/** @param {unknown} totpInputData */
//Function for creating strict TOTP and recovery-code configuration
const totpConfigurationCreate = function( totpInputData ){
    //Keeping the second factor disabled until an application explicitly selects it
    if ( totpInputData === null ){
        return null;

    }

    configurationFieldsCheck( totpInputData, 'auth.totp', [
        'algorithm',
        'digits',
        'issuer',
        'period',
        'recoveryCodeCount',
        'window'
    ] );
    const totpData = /** @type {Record<string, any>} */ (totpInputData);

    //Checking the authenticator presentation name without accepting control characters
    if (
        typeof totpData.issuer !== String( 'string' ) ||
        Number( totpData.issuer.length ) < Number( 1 ) ||
        Number( totpData.issuer.length ) > Number( 120 ) ||
        [...totpData.issuer].some(function issuerControlCharacterFind( characterData ){
            //Rejecting control characters that would corrupt provisioning labels
            const characterCodeData = characterData.codePointAt( Number( 0 ) ) ?? Number( 0 );

            return characterCodeData < Number( 32 ) || characterCodeData === Number( 127 );

        }) === true
    ){
        configurationErrorPass( 'auth.totp.issuer', 'auth.totp.issuer must contain a bounded display name.' );

    }

    const algorithmData = totpData.algorithm ?? 'SHA1';
    const digitsData = totpData.digits ?? 6;

    //Restricting options to combinations supported by common RFC 6238 authenticators
    if ( ['SHA1', 'SHA256', 'SHA512'].includes( algorithmData ) === false ){
        configurationErrorPass( 'auth.totp.algorithm', 'auth.totp.algorithm must be SHA1, SHA256, or SHA512.' );

    }

    if ( digitsData !== Number( 6 ) && digitsData !== Number( 8 ) ){
        configurationErrorPass( 'auth.totp.digits', 'auth.totp.digits must be 6 or 8.' );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        issuer: String( totpData.issuer ),
        algorithm: String( algorithmData ),
        digits: Number( digitsData ),
        period: boundedIntegerCreate( totpData.period ?? 30, 'auth.totp.period', 15, 120 ),
        window: boundedIntegerCreate( totpData.window ?? 1, 'auth.totp.window', 0, 2 ),
        recoveryCodeCount: boundedIntegerCreate( totpData.recoveryCodeCount ?? 10, 'auth.totp.recoveryCodeCount', 5, 20 )
    });

};

/** @param {unknown} secretInputData @param {string} pathData */
//Function for normalizing one server-only OAuth client secret reference
const oauthSecretReferenceCreate = function( secretInputData, pathData ){
    configurationFieldsCheck( secretInputData, pathData, ['env'] );
    const secretData = /** @type {Record<string, any>} */ (secretInputData);

    if ( typeof secretData.env !== String( 'string' ) || /^[A-Z][A-Z0-9_]{1,127}$/u.test( secretData.env ) === false ){
        configurationErrorPass( `${String( pathData )}.env`, `${String( pathData )}.env must contain an environment variable name.` );

    }

    //CallBack THE OBJECT
    return Object.freeze({env: String( secretData.env )});

};

/** @param {unknown} urlInputData @param {string} pathData @param {{allowPath?: boolean}} [urlOptionsData] */
//Function for checking exact HTTPS or loopback HTTP OAuth URLs
const oauthUrlCreate = function( urlInputData, pathData, urlOptionsData = {} ){
    if ( typeof urlInputData !== 'string' || Number( String( urlInputData ).length ) > Number( 2048 ) ){
        configurationErrorPass( pathData, `${String( pathData )} must contain an absolute URL.` );

    }

    const urlSourceData = String( urlInputData );
    let urlData;

    try {
        urlData = new URL( urlSourceData );

    } catch( urlErrorData ){
        void urlErrorData;
        configurationErrorPass( pathData, `${String( pathData )} must contain an absolute URL.` );

    }

    const normalizedUrlData = /** @type {URL} */ (urlData);
    const loopbackStatusData = ['127.0.0.1', '::1', '[::1]', 'localhost'].includes( normalizedUrlData.hostname );

    if (
        normalizedUrlData.username !== String() ||
        normalizedUrlData.password !== String() ||
        normalizedUrlData.hash !== String() ||
        (normalizedUrlData.protocol !== String( 'https:' ) && (normalizedUrlData.protocol !== String( 'http:' ) || loopbackStatusData === false))
    ){
        configurationErrorPass( pathData, `${String( pathData )} must use HTTPS or loopback HTTP without credentials or fragments.` );

    }

    if ( urlOptionsData.allowPath !== true && normalizedUrlData.pathname !== String( '/' ) ){
        configurationErrorPass( pathData, `${String( pathData )} must contain an origin without a path.` );

    }

    //CallBack THE STRING
    return String( normalizedUrlData.href ).replace( /\/$/u, String() );

};

/** @param {unknown} scopesInputData @param {string} pathData */
//Function for creating a unique OAuth scope allowlist
const oauthScopesCreate = function( scopesInputData, pathData ){
    if ( Array.isArray( scopesInputData ) === false || Number( scopesInputData.length ) < Number( 1 ) || Number( scopesInputData.length ) > Number( 100 ) ){
        configurationErrorPass( pathData, `${String( pathData )} must contain 1 to 100 scope names.` );

    }

    const scopesInputListData = /** @type {unknown[]} */ (scopesInputData);
    const scopesData = /** @type {string[]} */ ([]);

    for ( const scopeInputData of scopesInputListData ){
        if (
            typeof scopeInputData !== 'string' ||
            /^[a-z][a-z0-9:._-]{0,79}$/u.test( String( scopeInputData ) ) === false ||
            scopesData.includes( String( scopeInputData ) ) === true
        ){
            configurationErrorPass( pathData, `${String( pathData )} contains an invalid or duplicate scope.` );

        }

        scopesData.push( String( scopeInputData ) );

    }

    //CallBack THE OBJECT
    return Object.freeze( scopesData.sort() );

};

/** @param {unknown} oauthInputData */
//Function for creating strict OAuth authorization-server configuration
const oauthConfigurationCreate = function( oauthInputData ){
    if ( oauthInputData === null ){
        return null;

    }

    configurationFieldsCheck( oauthInputData, 'auth.oauth', [
        'clients',
        'interactionUrl',
        'issuer',
        'scopes'
    ] );
    const oauthData = /** @type {Record<string, any>} */ (oauthInputData);
    const issuerData = oauthUrlCreate( oauthData.issuer, 'auth.oauth.issuer' );

    if ( typeof oauthData.interactionUrl !== String( 'string' ) || /^\/[A-Za-z0-9/_-]{1,255}$/u.test( oauthData.interactionUrl ) === false ){
        configurationErrorPass( 'auth.oauth.interactionUrl', 'auth.oauth.interactionUrl must contain a same-origin absolute path.' );

    }

    const scopesData = oauthScopesCreate( oauthData.scopes ?? ['openid', 'offline_access'], 'auth.oauth.scopes' );

    if ( scopesData.includes( 'openid' ) === false ){
        configurationErrorPass( 'auth.oauth.scopes', 'auth.oauth.scopes must include openid.' );

    }

    if ( Array.isArray( oauthData.clients ) === false || Number( oauthData.clients.length ) < Number( 1 ) || Number( oauthData.clients.length ) > Number( 100 ) ){
        configurationErrorPass( 'auth.oauth.clients', 'auth.oauth.clients must contain 1 to 100 registered clients.' );

    }

    const clientIdentifiersData = new Set();
    const clientInputsData = /** @type {unknown[]} */ (oauthData.clients);
    const clientsData = clientInputsData.map(function oauthClientCreate( /** @type {unknown} */ clientInputData, /** @type {number} */ clientIndexData ){
        const clientPathData = `auth.oauth.clients[${Number( clientIndexData )}]`;
        configurationFieldsCheck( clientInputData, clientPathData, [
            'displayName',
            'dpop',
            'grantTypes',
            'id',
            'redirectUris',
            'scopes',
            'secret',
            'type'
        ] );
        const clientData = /** @type {Record<string, any>} */ (clientInputData);

        if (
            typeof clientData.id !== String( 'string' ) ||
            /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u.test( clientData.id ) === false ||
            clientIdentifiersData.has( clientData.id ) === true
        ){
            configurationErrorPass( `${String( clientPathData )}.id`, 'OAuth client identifiers must be valid and unique.' );

        }

        clientIdentifiersData.add( clientData.id );

        if ( clientData.type !== String( 'public' ) && clientData.type !== String( 'confidential' ) ){
            configurationErrorPass( `${String( clientPathData )}.type`, 'OAuth client type must be public or confidential.' );

        }

        if ( typeof clientData.displayName !== String( 'string' ) || Number( clientData.displayName.length ) < Number( 1 ) || Number( clientData.displayName.length ) > Number( 120 ) ){
            configurationErrorPass( `${String( clientPathData )}.displayName`, 'OAuth client displayName is invalid.' );

        }

        if ( Array.isArray( clientData.redirectUris ) === false || Number( clientData.redirectUris.length ) < Number( 1 ) || Number( clientData.redirectUris.length ) > Number( 20 ) ){
            configurationErrorPass( `${String( clientPathData )}.redirectUris`, 'OAuth client redirectUris must contain exact URLs.' );

        }

        const redirectUriInputsData = /** @type {unknown[]} */ (clientData.redirectUris);
        const redirectUrisData = redirectUriInputsData.map(function redirectUriCreate( /** @type {unknown} */ redirectUriData, /** @type {number} */ redirectIndexData ){
            //Normalizing every redirect URI with its precise configuration path
            return oauthUrlCreate(
                redirectUriData,
                `${String( clientPathData )}.redirectUris[${Number( redirectIndexData )}]`,
                {allowPath: true}
            );

        });

        if ( new Set( redirectUrisData ).size !== Number( redirectUrisData.length ) ){
            configurationErrorPass( `${String( clientPathData )}.redirectUris`, 'OAuth redirectUris must be unique.' );

        }

        const grantTypesData = clientData.grantTypes ?? ['authorization_code', 'refresh_token'];
        const supportedGrantTypesData = ['authorization_code', 'client_credentials', 'refresh_token'];

        if (
            Array.isArray( grantTypesData ) === false ||
            Number( grantTypesData.length ) < Number( 1 ) ||
            grantTypesData.some(function unsupportedGrantTypeFind( grantTypeData ){
                //Finding grant types outside the supported OAuth allowlist
                return supportedGrantTypesData.includes( grantTypeData ) === false;

            }) === true ||
            new Set( grantTypesData ).size !== Number( grantTypesData.length )
        ){
            configurationErrorPass( `${String( clientPathData )}.grantTypes`, 'OAuth client grantTypes contain an unsupported or duplicate value.' );

        }

        if ( clientData.type === String( 'public' ) && grantTypesData.includes( 'client_credentials' ) === true ){
            configurationErrorPass( `${String( clientPathData )}.grantTypes`, 'Public OAuth clients cannot use client_credentials.' );

        }

        let secretData = null;

        if ( clientData.type === String( 'confidential' ) ){
            secretData = oauthSecretReferenceCreate( clientData.secret, `${String( clientPathData )}.secret` );

        } else if ( clientData.secret !== undefined && clientData.secret !== null ){
            configurationErrorPass( `${String( clientPathData )}.secret`, 'Public OAuth clients must not define a client secret.' );

        }

        const clientScopesData = oauthScopesCreate( clientData.scopes ?? scopesData, `${String( clientPathData )}.scopes` );

        for ( const clientScopeData of clientScopesData ){
            if ( scopesData.includes( clientScopeData ) === false ){
                configurationErrorPass( `${String( clientPathData )}.scopes`, 'OAuth client scopes must belong to auth.oauth.scopes.' );

            }

        }

        const dpopData = clientData.dpop ?? 'optional';

        if ( dpopData !== String( 'optional' ) && dpopData !== String( 'required' ) ){
            configurationErrorPass( `${String( clientPathData )}.dpop`, 'OAuth client dpop must be optional or required.' );

        }

        //CallBack THE OBJECT
        return Object.freeze({
            id: String( clientData.id ),
            type: String( clientData.type ),
            secret: secretData,
            displayName: String( clientData.displayName ),
            redirectUris: Object.freeze( redirectUrisData ),
            grantTypes: Object.freeze([...grantTypesData].sort()),
            scopes: clientScopesData,
            dpop: String( dpopData )
        });

    });

    //CallBack THE OBJECT
    return Object.freeze({
        issuer: issuerData,
        interactionUrl: String( oauthData.interactionUrl ),
        scopes: scopesData,
        clients: Object.freeze( clientsData )
    });

};

/** @param {unknown} providersInputData */
//Function for creating strict external OpenID Connect provider configuration
const oidcConfigurationCreate = function( providersInputData ){
    if ( Array.isArray( providersInputData ) === false || Number( providersInputData.length ) > Number( 20 ) ){
        configurationErrorPass( 'auth.oidc', 'auth.oidc must contain up to 20 trusted provider configurations.' );

    }

    const providerIdentifiersData = new Set();
    const providerInputsData = /** @type {unknown[]} */ (providersInputData);
    const providersData = providerInputsData.map(function oidcProviderCreate( /** @type {unknown} */ providerInputData, /** @type {number} */ providerIndexData ){
        const providerPathData = `auth.oidc[${Number( providerIndexData )}]`;
        configurationFieldsCheck( providerInputData, providerPathData, [
            'clientId',
            'clientSecret',
            'id',
            'issuer',
            'redirectUri',
            'scopes'
        ] );
        const providerData = /** @type {Record<string, any>} */ (providerInputData);

        if (
            typeof providerData.id !== String( 'string' ) ||
            /^[a-z][a-z0-9-]{1,63}$/u.test( providerData.id ) === false ||
            providerIdentifiersData.has( providerData.id ) === true
        ){
            configurationErrorPass( `${String( providerPathData )}.id`, 'OIDC provider ids must be valid and unique.' );

        }

        providerIdentifiersData.add( providerData.id );

        if ( typeof providerData.clientId !== String( 'string' ) || Number( providerData.clientId.length ) < Number( 1 ) || Number( providerData.clientId.length ) > Number( 256 ) ){
            configurationErrorPass( `${String( providerPathData )}.clientId`, 'OIDC provider clientId is invalid.' );

        }

        const scopesData = oauthScopesCreate( providerData.scopes ?? ['openid', 'email', 'profile'], `${String( providerPathData )}.scopes` );

        if ( scopesData.includes( 'openid' ) === false ){
            configurationErrorPass( `${String( providerPathData )}.scopes`, 'External OIDC scopes must include openid.' );

        }

        //CallBack THE OBJECT
        return Object.freeze({
            id: String( providerData.id ),
            issuer: oauthUrlCreate( providerData.issuer, `${String( providerPathData )}.issuer`, {allowPath: true} ),
            clientId: String( providerData.clientId ),
            clientSecret: oauthSecretReferenceCreate( providerData.clientSecret, `${String( providerPathData )}.clientSecret` ),
            redirectUri: oauthUrlCreate( providerData.redirectUri, `${String( providerPathData )}.redirectUri`, {allowPath: true} ),
            scopes: scopesData
        });

    });

    //CallBack THE OBJECT
    return Object.freeze( providersData );

};

/**
 * @overload
 * @param {null | undefined} authInputData
 * @returns {null}
 */
/**
 * @overload
 * @param {Readonly<Record<string, unknown>>} authInputData
 * @returns {Readonly<Record<string, any>>}
 */
/**
 * Creates the strict server-only Auth configuration. `null` keeps Auth disabled.
 * Secrets remain unresolved ENV references and must be resolved by the server runtime.
 *
 * @param {unknown} authInputData
 * @returns {null | Readonly<Record<string, any>>}
 * @throws {LayerAuthError}
 */
export function layerAuthConfigurationCreate( authInputData ){
    //Keeping Auth disabled until the application selects an identity lifecycle
    if ( authInputData === null || authInputData === undefined ){
        return null;

    }

    configurationFieldsCheck( authInputData, 'auth', authConfigurationFieldsData );
    const authData = /** @type {Record<string, any>} */ (authInputData);

    //Checking the explicit activation flag before accepting credential settings
    if ( authData.enabled !== true ){
        configurationErrorPass(
            'auth.enabled',
            'auth.enabled must be true when the Auth configuration object is present.',
            [String( 'Use auth: null to disable Layer Auth completely.' )]
        );

    }

    const registrationInputData = authData.registration ?? {};
    const identifiersInputData = authData.identifiers ?? {};
    const verificationInputData = authData.emailVerification ?? {};
    const passwordInputData = authData.password ?? {};
    const passwordRecoveryInputData = authData.passwordRecovery ?? {};
    const sessionInputData = authData.session ?? {};

    configurationFieldsCheck( registrationInputData, 'auth.registration', ['mode'] );
    configurationFieldsCheck( identifiersInputData, 'auth.identifiers', ['email', 'username', 'phone'] );
    configurationFieldsCheck( verificationInputData, 'auth.emailVerification', ['lifetimeMs', 'required'] );
    configurationFieldsCheck( passwordInputData, 'auth.password', [
        'commonPasswordBlocklist',
        'maximumLength',
        'minimumLength'
    ] );
    configurationFieldsCheck( passwordRecoveryInputData, 'auth.passwordRecovery', ['enabled', 'lifetimeMs'] );
    configurationFieldsCheck( sessionInputData, 'auth.session', [
        'absoluteLifetimeMs',
        'dataMaximumBytes',
        'idleLifetimeMs',
        'maximumPerUser',
        'rememberAbsoluteLifetimeMs',
        'rememberIdleLifetimeMs',
        'touchIntervalMs'
    ] );

    const registrationModeData = registrationInputData.mode ?? 'disabled';

    //Checking the registration policy before it reaches a public operation
    if ( registrationModesData.includes( registrationModeData ) === false ){
        configurationErrorPass(
            'auth.registration.mode',
            'auth.registration.mode must be disabled, open, invite, or admin-only.'
        );

    }

    const emailIdentifierStatusData = identifiersInputData.email ?? true;
    const usernameIdentifierStatusData = identifiersInputData.username ?? false;
    const phoneIdentifierStatusData = identifiersInputData.phone ?? false;
    const emailVerificationStatusData = verificationInputData.required ?? false;
    const commonPasswordBlocklistStatusData = passwordInputData.commonPasswordBlocklist ?? true;
    const passwordRecoveryStatusData = passwordRecoveryInputData.enabled ?? false;

    //Checking identity switches as strict booleans
    if (
        typeof emailIdentifierStatusData !== String( 'boolean' ) ||
        typeof usernameIdentifierStatusData !== String( 'boolean' ) ||
        typeof phoneIdentifierStatusData !== String( 'boolean' ) ||
        typeof emailVerificationStatusData !== String( 'boolean' ) ||
        typeof commonPasswordBlocklistStatusData !== String( 'boolean' ) ||
        typeof passwordRecoveryStatusData !== String( 'boolean' )
    ){
        configurationErrorPass( 'auth.identifiers', 'Auth identity and verification switches must be booleans.' );

    }

    //Requiring at least one stable login identifier
    if ( emailIdentifierStatusData === false && usernameIdentifierStatusData === false && phoneIdentifierStatusData === false ){
        configurationErrorPass( 'auth.identifiers', 'Layer Auth requires at least one login identifier.' );

    }

    //Checking server-only hooks before they can participate in authorization or deletion
    if (
        authData.authorizationResolve !== undefined &&
        authData.authorizationResolve !== null &&
        typeof authData.authorizationResolve !== String( 'function' )
    ){
        configurationErrorPass( 'auth.authorizationResolve', 'auth.authorizationResolve must be a server function.' );

    }

    if (
        authData.anonymization !== undefined &&
        authData.anonymization !== null &&
        typeof authData.anonymization !== String( 'function' )
    ){
        configurationErrorPass( 'auth.anonymization', 'auth.anonymization must be a server function.' );

    }

    const minimumPasswordLengthData = boundedIntegerCreate( passwordInputData.minimumLength ?? 12, 'auth.password.minimumLength', 8, 128 );
    const maximumPasswordLengthData = boundedIntegerCreate( passwordInputData.maximumLength ?? 128, 'auth.password.maximumLength', 12, 1024 );

    if ( Number( maximumPasswordLengthData ) < Number( minimumPasswordLengthData ) ){
        configurationErrorPass( 'auth.password.maximumLength', 'auth.password.maximumLength must be greater than or equal to minimumLength.' );

    }

    const smtpConfigurationData = smtpConfigurationCreate( authData.smtp ?? null );
    const oidcConfigurationData = oidcConfigurationCreate( authData.oidc ?? [] );

    //Requiring a verified email identity for safe first-time external provisioning
    if ( Number( oidcConfigurationData.length ) > Number( 0 ) && emailIdentifierStatusData !== true ){
        configurationErrorPass(
            'auth.identifiers.email',
            'auth.identifiers.email must be enabled when external OIDC providers are configured.',
            [String( 'Enable email identities or remove auth.oidc providers.' )]
        );

    }

    //Requiring delivery capability when registration cannot complete without email verification
    if ( emailVerificationStatusData === true && smtpConfigurationData === null ){
        configurationErrorPass(
            'auth.smtp',
            'auth.smtp is required when email verification is mandatory.',
            [String( 'Configure SMTP or set auth.emailVerification.required to false.' )]
        );

    }

    //Requiring delivery capability before enabling enumeration-safe recovery mail
    if ( passwordRecoveryStatusData === true && smtpConfigurationData === null ){
        configurationErrorPass(
            'auth.smtp',
            'auth.smtp is required when password recovery is enabled.',
            [String( 'Configure SMTP or set auth.passwordRecovery.enabled to false.' )]
        );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        enabled: true,
        secret: secretConfigurationCreate( authData.secret ?? null, 'auth.secret' ),
        registration: Object.freeze({mode: String( registrationModeData )}),
        identifiers: Object.freeze({
            email: Boolean( emailIdentifierStatusData ),
            username: Boolean( usernameIdentifierStatusData ),
            phone: Boolean( phoneIdentifierStatusData )
        }),
        emailVerification: Object.freeze({
            required: Boolean( emailVerificationStatusData ),
            lifetimeMs: boundedIntegerCreate( verificationInputData.lifetimeMs ?? 86400000, 'auth.emailVerification.lifetimeMs', 300000, 604800000 )
        }),
        password: Object.freeze({
            minimumLength: Number( minimumPasswordLengthData ),
            maximumLength: Number( maximumPasswordLengthData ),
            commonPasswordBlocklist: Boolean( commonPasswordBlocklistStatusData )
        }),
        passwordRecovery: Object.freeze({
            enabled: Boolean( passwordRecoveryStatusData ),
            lifetimeMs: boundedIntegerCreate( passwordRecoveryInputData.lifetimeMs ?? 1800000, 'auth.passwordRecovery.lifetimeMs', 300000, 86400000 )
        }),
        session: Object.freeze({
            idleLifetimeMs: boundedIntegerCreate( sessionInputData.idleLifetimeMs ?? 1800000, 'auth.session.idleLifetimeMs', 60000, 31536000000 ),
            absoluteLifetimeMs: boundedIntegerCreate( sessionInputData.absoluteLifetimeMs ?? 43200000, 'auth.session.absoluteLifetimeMs', 300000, 31536000000 ),
            rememberIdleLifetimeMs: boundedIntegerCreate( sessionInputData.rememberIdleLifetimeMs ?? 604800000, 'auth.session.rememberIdleLifetimeMs', 300000, 31536000000 ),
            rememberAbsoluteLifetimeMs: boundedIntegerCreate( sessionInputData.rememberAbsoluteLifetimeMs ?? 2592000000, 'auth.session.rememberAbsoluteLifetimeMs', 300000, 31536000000 ),
            touchIntervalMs: boundedIntegerCreate( sessionInputData.touchIntervalMs ?? 300000, 'auth.session.touchIntervalMs', 10000, 3600000 ),
            maximumPerUser: boundedIntegerCreate( sessionInputData.maximumPerUser ?? 20, 'auth.session.maximumPerUser', 1, 100 ),
            dataMaximumBytes: boundedIntegerCreate( sessionInputData.dataMaximumBytes ?? 16384, 'auth.session.dataMaximumBytes', 1024, 65536 )
        }),
        smtp: smtpConfigurationData,
        passkey: passkeyConfigurationCreate( authData.passkey ?? null ),
        totp: totpConfigurationCreate( authData.totp ?? null ),
        oauth: oauthConfigurationCreate( authData.oauth ?? null ),
        oidc: oidcConfigurationData,
        authorizationResolve: authData.authorizationResolve ?? null,
        anonymization: authData.anonymization ?? null
    });

}

/**
 * Removes secrets and executable hooks before configuration reaches diagnostics.
 *
 * @param {null | Readonly<Record<string, any>>} authConfigurationData
 */
export function layerAuthConfigurationRedact( authConfigurationData ){
    //Keeping the disabled contract explicit in public diagnostics
    if ( authConfigurationData === null ){
        return null;

    }

    const smtpConfigurationData = authConfigurationData.smtp;
    const oauthConfigurationData = authConfigurationData.oauth;
    let oauthPublicConfigurationData = null;

    //Removing every confidential client ENV reference from public diagnostics
    if ( oauthConfigurationData !== null ){
        oauthPublicConfigurationData = Object.freeze({
            ...oauthConfigurationData,
            clients: Object.freeze(oauthConfigurationData.clients.map(function oauthClientRedact( /** @type {any} */ clientData ){
                let clientSecretData = null;

                //Replacing a configured secret reference with a non-sensitive marker
                if ( clientData.secret !== null ){
                    clientSecretData = Object.freeze({configured: true});

                }

                return Object.freeze({
                    ...clientData,
                    secret: clientSecretData
                });

            }))
        });

    }

    let authSecretData = null;
    let smtpPublicConfigurationData = null;
    let authorizationResolveData = null;
    let anonymizationData = null;

    //Replacing server-only values with safe public diagnostic markers
    if ( authConfigurationData.secret !== null ){
        authSecretData = Object.freeze({configured: true});

    }

    if ( smtpConfigurationData !== null ){
        let smtpPasswordData = null;

        if ( smtpConfigurationData.password !== null ){
            smtpPasswordData = Object.freeze({configured: true});

        }

        smtpPublicConfigurationData = Object.freeze({
            ...smtpConfigurationData,
            password: smtpPasswordData
        });

    }

    if ( authConfigurationData.authorizationResolve !== null ){
        authorizationResolveData = String( '[server function]' );

    }

    if ( authConfigurationData.anonymization !== null ){
        anonymizationData = String( '[server function]' );

    }

    //CallBack THE OBJECT
    return Object.freeze({
        ...authConfigurationData,
        secret: authSecretData,
        smtp: smtpPublicConfigurationData,
        oauth: oauthPublicConfigurationData,
        authorizationResolve: authorizationResolveData,
        anonymization: anonymizationData,
        oidc: Object.freeze([])
    });

}
