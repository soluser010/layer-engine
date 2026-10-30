import {
    mkdir,
    readdir,
    stat,
    writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {LayerCliError} from './cli-error.js';
import {frameworkVersionsRead, packageVersionRead} from './package-versions.js';

/**
 * @param {string} applicationName
 */
export function layerProjectNameNormalize(applicationName) {
    //Getting the trimmed developer name before applying filesystem rules.
    const applicationNameSource = String(applicationName).trim();

    //Rejecting Cyrillic explicitly instead of silently transliterating an application identity.
    if (/\p{Script=Cyrillic}/u.test(applicationNameSource)) {
        throw new LayerCliError('CLI_CREATE_NAME_CYRILLIC_FORBIDDEN', 'Application name must use Latin characters.');

    }

    //Checking the bounded ASCII source before normalizing spaces and letter case.
    if (
        applicationNameSource.length === 0 ||
        applicationNameSource.length > 160 ||
        !/^[A-Za-z][A-Za-z0-9 -]*$/u.test(applicationNameSource)
    ) {
        throw new LayerCliError('CLI_CREATE_NAME_INVALID', 'Application name must start with a Latin letter and contain only Latin letters, numbers, spaces, or hyphens.');

    }

    //Converting case and separator groups into one stable package and directory name.
    const applicationNameNormalized = applicationNameSource.toLowerCase().replace(/[ -]+/gu, '-');

    //Checking the final package-safe name and excluding trailing separators.
    if (!/^[a-z](?:[a-z0-9-]{0,78}[a-z0-9])?$/u.test(applicationNameNormalized)) {
        throw new LayerCliError('CLI_CREATE_NAME_INVALID', 'Normalized application name must contain 1 to 80 Latin letters, numbers, or internal hyphens.');

    }

    return applicationNameNormalized;

}

/**
 * Creates the documented configuration generated for every new Layer application.
 * Active values form the safe embedded single-worker default; commented recipes are
 * complete alternatives that can be copied without guessing enum or disable values.
 *
 * @param {string} projectName
 * @returns {string}
 */
function projectConfigurationSourceCreate( projectName ){
    //Creating the active configuration with explicit disable and fallback values
    return `export default {
    // Stable lowercase application identity used by schemas, caches, and artifacts.
    appName: '${projectName}',
    appVersion: '0.1.0',
    sourceDirectory: 'src',
    publicDirectory: 'public',
    outputDirectory: 'dist',

    // null disables Layer Auth and creates no identity, credential, or session flows.
    auth: null,
    // Disabled by default; Web Push requires serverEntry, VAPID ENV and a stable encryption secret.
    notifications: null,

    // Empty CSP additions preserve the strict browser security defaults.
    // Add only required origins, for example: {'connect-src': ['https://api.example.com']}.
    security: {
        csp: {
            sources: {}
        }
    },

    // CSS browser floors apply to dev and production; minification is always enabled.
    // A supplied targets object replaces these defaults; versions must be strings.
    css: {
        targets: {chrome: '109', edge: '109', firefox: '115', safari: '16.4', ios_saf: '16.4'}
    },

    development: {
        // Development accepts only 127.0.0.1, localhost, or ::1.
        host: '127.0.0.1',
        port: 5173,
        // false disables local HTTPS; use the certificate recipe below to enable it.
        https: false,
        // false disables the dev SSE client and automatic browser reload.
        liveReload: true
    },

    database: {
        embedded: {
            // null stores PGlite under LAYER_STATE_DIRECTORY; otherwise use a project-relative path.
            dataDirectory: null
        },
        // [] enables embedded PGlite for Layer system data and limits runtime to one worker.
        postgres: [],
        schema: {
            // Keep an empty table list when the application does not need application SQL tables.
            file: 'src/server/database.js',
            synchronization: 'additive'
        },
        replica: {
            maximumLagMs: 2000
        },
        pool: {
            maximumConnectionsPerWorker: 5,
            // Required when runtime.workers.maximum is 'auto'.
            connectionBudget: null
        }
    },

    // null disables Redis; PostgreSQL/PGlite remains the source of truth and fallback.
    redis: null,

    // Only listed external origins can open in the built-in iframe viewer.
    // Disable only the default card with ui: false; native Service Worker registration remains enabled.
    updates: {
        enabled: true,
        ui: true,
        checkIntervalMs: 300000
    },
    links: {
        external: {mode: 'viewer', allowedOrigins: []},
        scopeExtensions: [],
        associations: {android: [], apple: [], windows: [], web: []}
    },

    runtime: {
        workers: {
            // Embedded PGlite requires 1/1. External PostgreSQL permits fixed or ranged workers.
            minimum: 1,
            maximum: 1
        }
    },

    deployment: {
        // null requires LAYER_DOMAIN at production start; use 'localhost' only for local bundle tests.
        domain: null,
        // null creates a static PWA and starts no Node API worker.
        serverEntry: null,
        originPort: 8787,
        // Only exact external runtime versions belong here; Layer packages are bundled.
        dependencies: {}
    }
};

/*
Configuration recipes — copy only the fields needed by the selected mode.

Server Web Push (requires serverEntry, authenticated users and persistent ENV secrets):
    notifications: {
        secret: {env: 'LAYER_NOTIFICATIONS_SECRET'},
        webPush: {
            vapid: {
                subject: 'mailto:notifications@example.com',
                publicKey: {env: 'LAYER_PUSH_PUBLIC_KEY'},
                privateKey: {env: 'LAYER_PUSH_PRIVATE_KEY'}
            }
        }
    },
    // Optional Redis accelerates wakeups; SQL polling remains authoritative.
    // Disable completely with notifications: null.

Headless Layer Auth with password sessions and optional username:
    auth: {
        enabled: true,
        secret: {env: 'LAYER_AUTH_SECRET'},
        registration: {
            // Supported modes: disabled, open, invite, admin-only.
            mode: 'open'
        },
        identifiers: {
            email: true,
            username: true
        },
        emailVerification: {
            // true also requires the SMTP block described below.
            required: false,
            lifetimeMs: 86400000
        },
        password: {
            minimumLength: 12,
            maximumLength: 128,
            commonPasswordBlocklist: true
        },
        passwordRecovery: {
            // true requires SMTP and enables enumeration-safe recovery requests.
            enabled: false,
            lifetimeMs: 1800000
        },
        session: {
            idleLifetimeMs: 1800000,
            absoluteLifetimeMs: 43200000,
            rememberIdleLifetimeMs: 604800000,
            rememberAbsoluteLifetimeMs: 2592000000,
            touchIntervalMs: 300000,
            maximumPerUser: 20,
            dataMaximumBytes: 16384
        },
        // null disables email delivery, password recovery mail, and required verification.
        smtp: null,
        // null disables each optional credential or protocol adapter.
        passkey: null,
        totp: null,
        oauth: null,
        oidc: []
    }

SMTP for verification and recovery:
    auth.smtp: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        username: 'layer@example.com',
        password: {env: 'LAYER_SMTP_PASSWORD'},
        from: 'Layer <layer@example.com>'
    }

Passkey and authenticator-app MFA:
    auth.passkey: {
        rpId: 'app.example.com',
        rpName: 'Example application',
        origins: ['https://app.example.com'],
        userVerification: 'required',
        timeoutMs: 60000
    }

    auth.totp: {
        issuer: 'Example application',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        window: 1,
        recoveryCodeCount: 10
    }

Embedded OAuth 2.1 / OpenID Connect authorization server:
    auth.oauth: {
        // HTTPS is required outside loopback development.
        issuer: 'https://auth.example.com',
        // The application renders this trusted login/consent route.
        interactionUrl: '/auth/oauth',
        // Every custom scope must match a permission of a registered operation.
        scopes: ['openid', 'offline_access', 'profile.read'],
        clients: [{
            id: 'browser-application',
            type: 'public',
            displayName: 'Browser application',
            redirectUris: ['https://client.example.com/auth/callback'],
            grantTypes: ['authorization_code', 'refresh_token'],
            scopes: ['openid', 'offline_access', 'profile.read'],
            dpop: 'required'
        }, {
            id: 'server-integration',
            type: 'confidential',
            displayName: 'Server integration',
            redirectUris: ['https://client.example.com/auth/server-callback'],
            grantTypes: ['client_credentials'],
            scopes: ['openid', 'profile.read'],
            secret: {env: 'LAYER_OAUTH_SERVER_CLIENT_SECRET'},
            dpop: 'optional'
        }]
    }
    Register application operations before authRuntime.register(operationRegistry).
    A DPoP-bound token calls POST /api with Authorization: DPoP <token>
    and a signed DPoP request header.

External OpenID Connect sign-in providers:
    auth.oidc: [{
        id: 'company-identity',
        issuer: 'https://identity.example.com',
        clientId: 'layer-application',
        clientSecret: {env: 'LAYER_OIDC_COMPANY_SECRET'},
        redirectUri: 'https://app.example.com/auth/callback',
        scopes: ['openid', 'email', 'profile']
    }]
    External first sign-in requires auth.registration.mode: 'open' and a verified email.
    Layer never auto-links an existing account by matching an upstream email.

Static PWA without Node, PostgreSQL, PGlite, or Redis processes:
    deployment.serverEntry: null
    The database, Redis, and worker blocks are not started by a static production bundle.

Embedded full-stack application:
    database.postgres: []
    redis: null
    runtime.workers: {minimum: 1, maximum: 1}
    deployment.serverEntry: 'server/index.js'
    PGlite stores Layer system data; application SQL tables require external PostgreSQL.

Local PostgreSQL without a password:
    database.postgres: [{
        name: 'primary',
        role: 'primary',
        host: '127.0.0.1',
        port: 5432,
        database: 'layer_application',
        username: 'postgres',
        password: null,
        tls: {
            mode: 'disable'
        }
    }]

Remote PostgreSQL primary and replica with ENV secrets:
    database.postgres: [{
        name: 'primary',
        role: 'primary',
        host: 'database.example.com',
        port: 5432,
        database: 'layer_application',
        username: 'layer_application',
        password: {env: 'LAYER_POSTGRES_PRIMARY_PASSWORD'},
        tls: {
            mode: 'verify-full',
            serverName: 'database.example.com',
            caFile: './certificates/postgres-ca.pem'
        }
    }, {
        name: 'replica-one',
        role: 'replica',
        host: 'replica.example.com',
        port: 5432,
        database: 'layer_application',
        username: 'layer_application_read',
        password: {env: 'LAYER_POSTGRES_REPLICA_PASSWORD'},
        tls: {
            mode: 'verify-full',
            serverName: 'replica.example.com',
            caFile: './certificates/postgres-ca.pem'
        }
    }]

Local Redis without a password:
    redis: {
        host: '127.0.0.1',
        port: 6379,
        username: null,
        password: null,
        database: 0,
        tls: {
            mode: 'disable'
        }
    }

Remote Redis:
    redis: {
        host: 'redis.example.com',
        port: 6379,
        username: 'layer_application',
        password: {env: 'LAYER_REDIS_PASSWORD'},
        database: 0,
        tls: {
            mode: 'verify-full',
            serverName: 'redis.example.com',
            caFile: './certificates/redis-ca.pem'
        }
    }

Development HTTPS:
    development.https: {
        keyFile: 'certificates/local.key',
        certificateFile: 'certificates/local.crt'
    }

Worker profiles with external PostgreSQL:
    fixed two:  {minimum: 2, maximum: 2}
    fixed four: {minimum: 4, maximum: 4}
    range:      {minimum: 2, maximum: 8}
    automatic:  {minimum: 2, maximum: 'auto'} plus database.pool.connectionBudget
*/
`;

}

/**
 * @param {string} projectName
 */
function projectTemplateCreate(projectName) {
    //Using installed release metadata rather than a version left behind in generator source
    frameworkVersionsRead();
    const dependencyNamesData = ['@solcorp/layer'];
    const dependenciesData = Object.fromEntries( dependencyNamesData.map(function( dependencyNameData ){
        //Pinning each generated dependency to the exact version tested with this CLI
        return [dependencyNameData, packageVersionRead( dependencyNameData )];

    }) );
    //Declaring the complete minimal application as deterministic text files.
    const packageData = {
        name: projectName,
        version: '0.1.0',
        private: true,
        type: 'module',
        imports: {
            '#layer/operations': './dist/_layer/operations.mjs'
        },
        engines: {
            node: '>=24.22.1 <25'
        },
        scripts: {
            build: 'layer build',
            'database:apply': 'layer database schema apply',
            'database:plan': 'layer database schema plan',
            dev: 'layer dev',
            doctor: 'layer doctor',
            docs: 'layer docs',
            inspect: 'layer inspect'
        },
        dependencies: dependenciesData
    };

    return Object.freeze({
        'package.json': `${JSON.stringify(packageData, null, 4)}\n`,
        'jsconfig.json': `${JSON.stringify({
            compilerOptions: {
                allowJs: true,
                checkJs: false,
                lib: [
                    'ES2022',
                    'DOM',
                    'DOM.Iterable'
                ],
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                noEmit: true,
                target: 'ES2022'
            },
            include: [
                'src/**/*.js',
                'dist/_layer/operations.d.mts',
                'dist/_layer/database.d.ts',
                'dist/_layer/styles.d.ts',
                'dist/_layer/types/**/*.d.ts'
            ]
        }, null, 4)}\n`,
        'layer.config.js': projectConfigurationSourceCreate( projectName ),
        'src/pages/index.layer.js': `import {\n    css,\n    html,\n    layerComponentCreate,\n    layerPageCreate\n} from '@solcorp/layer';\n\nexport const page = layerPageCreate({\n    render: 'ssr',\n    auth: 'none',\n    offline: 'shell',\n    cache: 'public',\n    metadata: {\n        title: 'Layer application'\n    }\n});\n\nexport const styles = css\`\nmain {\n    display: block;\n}\n\`;\n\nexport default layerComponentCreate(function HomePage(){\n    return html\`\n        <main>\n            <h1>${projectName}</h1>\n        </main>\n    \`;\n\n});\n`,
        'src/operations.js': 'import {layerOperationContractsCreate} from \'@solcorp/layer\';\n\nexport const operations = layerOperationContractsCreate([]);\n',
        'src/server/database.js': 'import {layerDatabaseSchemaDefine} from \'@solcorp/layer-database\';\n\nexport const databaseSchema = layerDatabaseSchemaDefine([]);\n',
        'src/app.js': 'export const context = Object.freeze({});\n\nexport function onError( errorData ){\n    //Reporting bootstrap failures without hiding them from development diagnostics\n    console.error( errorData );\n\n}\n',
        'public/manifest.webmanifest': `${JSON.stringify({
            name: projectName,
            short_name: projectName,
            start_url: '/',
            scope: '/',
            id: '/',
            lang: 'en',
            dir: 'ltr',
            orientation: 'any',
            icons: [{
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable'
            }],
            display: 'standalone',
            launch_handler: {client_mode: 'focus-existing'}
        }, null, 4)}\n`,
        'public/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#111827"/><path d="M128 128h96v208h160v48H128z" fill="#f9fafb"/><path d="M272 128h112v48H320v64h56v48h-56v48h64v48H272z" fill="#38bdf8"/></svg>\n',
        'public/index.html': `<!doctype html>\n<html lang="en">\n<head>\n    <meta charset="utf-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-visual">\n    <link rel="icon" href="/icon.svg" type="image/svg+xml">\n    <link rel="manifest" href="/manifest.webmanifest">\n    <title>${projectName}</title>\n</head>\n<body>\n    <div id="layer-app" data-layer-root></div>\n</body>\n</html>\n`,
        'README.md': `# ${projectName}\n\nCreated with Layer-Engine.\n\n## Development\n\n\`\`\`text\nnpm run dev\n\`\`\`\n\n## Production bundle\n\nSet \`deployment.domain\` in \`layer.config.js\` or provide \`LAYER_DOMAIN\` on the server. Build and deploy only \`dist\`:\n\n\`\`\`text\nnpm run build\ncd dist\nnpm run check\nnpm start\n\`\`\`\n\nThe target requires Node.js 24 and npm 11. Keep \`npm start\` under an external service supervisor.\n`
    });

}

/**
 * @param {{targetDirectory: string, projectName: string, dryRun?: boolean}} createOptions
 */
export async function layerProjectCreate(createOptions) {
    if (createOptions === null || typeof createOptions !== 'object' || typeof createOptions.targetDirectory !== 'string' ||
        typeof createOptions.projectName !== 'string') {
        throw new LayerCliError('CLI_CREATE_INVALID', 'Project target and application name are required.');

    }

    const projectName = layerProjectNameNormalize(createOptions.projectName);
    const targetDirectory = path.resolve(createOptions.targetDirectory);
    const targetRoot = path.parse(targetDirectory).root;

    if (targetDirectory === targetRoot) {
        throw new LayerCliError('CLI_CREATE_TARGET_UNSAFE', 'A filesystem root cannot be used as a project target.');

    }

    const templateFiles = projectTemplateCreate(projectName);
    const creationPlan = Object.freeze({
        targetDirectory,
        projectName,
        files: Object.freeze(Object.keys(templateFiles))
    });

    if (createOptions.dryRun === true) {
        return creationPlan;

    }

    try {
        const targetStatus = await stat(targetDirectory).catch(function missingTargetHandle(targetError) {
            if (/** @type {NodeJS.ErrnoException} */ (targetError).code === 'ENOENT') {
                return null;

            }

            throw targetError;

        });

        //Refusing to merge a new project into an existing non-empty directory.
        if (targetStatus !== null) {
            if (!targetStatus.isDirectory() || (await readdir(targetDirectory)).length > 0) {
                throw new LayerCliError('CLI_CREATE_TARGET_NOT_EMPTY', 'Project target must be absent or empty.');

            }

        }

        //Creating each declared template file under the validated target.
        for (const [relativeFile, fileContent] of Object.entries(templateFiles)) {
            const targetFile = path.join(targetDirectory, relativeFile);
            await mkdir(path.dirname(targetFile), {recursive: true});
            await writeFile(targetFile, fileContent, {
                encoding: 'utf8',
                flag: 'wx'
            });

        }

        return creationPlan;

    } catch (creationError) {
        if (creationError instanceof LayerCliError) {
            throw creationError;

        }

        throw new LayerCliError('CLI_CREATE_FAILED', 'Project files could not be created.', {
            targetDirectory
        });

    }

}
