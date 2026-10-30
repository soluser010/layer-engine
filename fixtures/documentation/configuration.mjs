import {layerConfigValidate} from '@solcorp/layer-cli';

/** @returns {{defaults: ReturnType<typeof layerConfigValidate>, authDefaults: Record<string, any>, example: ReturnType<typeof layerConfigValidate>}} */
export function configurationProfilesCreate(){
    //Using public placeholder values only; validation never resolves ENV secrets here
    const secret = {env: 'REFERENCE_SECRET'};
    const defaults = layerConfigValidate({appName: 'reference'});
    const authDefaults = layerConfigValidate({
        appName: 'reference',
        auth: {enabled: true, secret}
    }).auth;
    //Requiring the enabled Auth profile before documenting its nested defaults
    if ( authDefaults === null ){
        throw new Error( 'The documentation Auth profile must be enabled.' );

    }

    const example = layerConfigValidate({
        appName: 'reference',
        deployment: {serverEntry: 'server/index.js'},
        auth: {
            enabled: true,
            secret,
            smtp: {host: 'mail.example.com', port: 465, secure: true, from: 'app@example.com', username: 'app', password: secret},
            passkey: {rpId: 'app.example.com', rpName: 'Example', origins: ['https://app.example.com']},
            totp: {issuer: 'Example'},
            oauth: {
                issuer: 'https://app.example.com',
                interactionUrl: '/authorize',
                clients: [{
                    id: 'example-client',
                    displayName: 'Example client',
                    type: 'confidential',
                    secret,
                    redirectUris: ['https://client.example.com/callback']
                }]
            },
            oidc: [{
                id: 'example-provider',
                issuer: 'https://identity.example.com',
                clientId: 'example',
                clientSecret: secret,
                redirectUri: 'https://app.example.com/oauth/callback'
            }]
        },
        database: {
            postgres: [{
                name: 'primary', role: 'primary', host: 'database.example.com', port: 5432,
                database: 'application', username: 'application', password: secret
            }]
        },
        redis: {host: 'cache.example.com', port: 6379, username: 'application', password: secret},
        notifications: {
            secret,
            webPush: {
                vapid: {subject: 'mailto:app@example.com', publicKey: secret, privateKey: secret}
            }
        },
        development: {https: {keyFile: 'certificates/key.pem', certificateFile: 'certificates/certificate.pem'}},
        security: {
            permissionsPolicy: {camera: [], microphone: [], geolocation: [], payment: []},
            csp: {sources: {
                'script-src': [], 'style-src': [], 'connect-src': [], 'img-src': [],
                'media-src': [], 'font-src': [], 'frame-src': [], 'child-src': [],
                'worker-src': [], 'manifest-src': []
            }}
        },
        links: {
            associations: {
                android: [{packageName: 'com.example.app', sha256CertFingerprints: [Array(32).fill('AA').join(':')]}],
                apple: [{appId: 'ABCDEFGHIJ.com.example.app', paths: ['/*']}],
                windows: [{packageFamilyName: 'Example.App_123456789abcd', paths: ['*'], excludePaths: []}],
                web: [{appId: 'https://related.example.com/app', scope: '/'}]
            }
        }
    });

    return {defaults, authDefaults, example};

}
