import {LayerAuthError} from './auth-error.js';


const commonPasswordsData = Object.freeze(new Set([
    '123456789012',
    'adminadminadmin',
    'letmeinletmein',
    'password1234',
    'qwertyqwerty',
    'welcome123456'
]));
const argonParametersData = Object.freeze({
    //The pinned @node-rs/argon2 contract defines Argon2id as algorithm 2.
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
});


/**
 * Counts Unicode code points without normalizing or trimming a password.
 *
 * @param {string} passwordData
 */
export function layerAuthPasswordLengthGet( passwordData ){
    //Counting complete Unicode code points instead of UTF-16 units
    return Number( Array.from( passwordData ).length );

}

/**
 * Validates a new password against the configured length and common-password
 * policy. Password bytes are never normalized or trimmed.
 *
 * @param {unknown} passwordData
 * @param {{minimumLength: number, maximumLength: number, commonPasswordBlocklist: boolean}} passwordPolicyData
 */
export function layerAuthPasswordCheck( passwordData, passwordPolicyData ){
    //Checking the string boundary before measuring Unicode code points
    if ( typeof passwordData !== 'string' ){
        throw new LayerAuthError( 'AUTH_PASSWORD_INVALID', 'Password does not satisfy the configured policy.' );

    }

    const passwordLengthData = layerAuthPasswordLengthGet( passwordData );

    if (
        Number( passwordLengthData ) < Number( passwordPolicyData.minimumLength ) ||
        Number( passwordLengthData ) > Number( passwordPolicyData.maximumLength )
    ){
        throw new LayerAuthError( 'AUTH_PASSWORD_INVALID', 'Password does not satisfy the configured policy.', Object.freeze({
            minimumLength: Number( passwordPolicyData.minimumLength ),
            maximumLength: Number( passwordPolicyData.maximumLength )
        }) );

    }

    //Checking only an exact lowercase match without logging the password
    if (
        passwordPolicyData.commonPasswordBlocklist === true &&
        commonPasswordsData.has( passwordData.toLowerCase() ) === true
    ){
        throw new LayerAuthError( 'AUTH_PASSWORD_COMMON', 'Password is present in the common-password blocklist.' );

    }

    //CallBack THE BOOLEAN
    return true;

}

/**
 * @param {string} passwordData
 */
export async function layerAuthPasswordHashCreate( passwordData ){
    //Loading the native dependency only when password Auth is actually used
    const argonModuleData = await import( '@node-rs/argon2' );

    //Hashing with the pinned Layer Argon2id security parameters
    return argonModuleData.hash( passwordData, argonParametersData );

}

/**
 * @param {string} passwordHashData
 * @param {string} passwordData
 */
export async function layerAuthPasswordVerify( passwordHashData, passwordData ){
    try {
        //Loading the native dependency only for an active password verification
        const argonModuleData = await import( '@node-rs/argon2' );

        //Verifying through the library parser without reflecting malformed hashes
        return await argonModuleData.verify( passwordHashData, passwordData, {
            algorithm: argonModuleData.Algorithm.Argon2id
        } );

    } catch {
        //Treating malformed or unsupported hashes as a failed credential
        return false;

    }

}

export {argonParametersData as LAYER_AUTH_ARGON2_PARAMETERS};
