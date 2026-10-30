import assert from 'node:assert/strict';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {configurationProfilesCreate} from './configuration.mjs';

const root = path.resolve( import.meta.dirname, '../..' );
/** @typedef {{package: string, name: string, level: string, article: string}} CallableEntry */
const packageArticles = /** @type {Record<string, string>} */ ({
    layer: 'authoring-layer-js.md',
    auth: 'layer-auth.md',
    cli: 'installation-cli.md',
    docs: 'installation-cli.md',
    compiler: 'advanced-runtime.md',
    database: 'structured-data.md',
    events: 'server-events.md',
    notifications: 'web-push.md',
    'plugin-sdk': 'advanced-runtime.md',
    protocol: 'operations.md',
    pwa: 'pwa-capabilities.md',
    render: 'advanced-runtime.md',
    router: 'routing-ssr.md',
    runtime: 'context-api.md',
    security: 'security-auth.md',
    server: 'server-runtime.md',
    storage: 'indexeddb.md',
    testkit: 'testing.md'
});
const topicRequirements = /** @type {Array<[string, string, string[]]>} */ ([
    ['structured-data.md', 'database', ['findOne', 'findMany', 'count', 'exists', 'insert', 'update', 'delete', 'transaction', 'sql', 'REVISION_CONFLICT']],
    ['indexeddb.md', 'storage', ['layerStorageSchemaDefine', 'layerStorageOpen', 'migrations', 'watch', 'estimate', 'exportUserData', 'purgeUserData', 'versionChangeHandle']],
    ['cache-outbox.md', 'cache', ['cache.update', 'cache.insert', 'cache.remove', 'cache.removeByCommandId', 'query.cacheKey', 'refresh']],
    ['cache-outbox.md', 'outbox', ['list', 'retry', 'resolveConflict', 'confirmed', 'cancel', 'OUTBOX_STATE_INVALID']],
    ['pwa-capabilities.md', 'pwa', ['badge.set', 'badge.clear', 'notifications.show', 'notifications.list', 'notifications.close', 'backgroundSync.register', 'storage.persist', 'protocols.register']],
    ['advanced-runtime.md', 'store', ['layerStoreCreate', 'layerEffect', 'delete state.notice', 'layerCommitWait']],
    ['advanced-runtime.md', 'boundaries', ['ErrorBoundary', 'mount', 'hydrate', 'renderToString', 'dispose', 'context.keyboard']],
    ['advanced-runtime.md', 'plugins', ['layerPluginRegistryCreate', 'initialize', 'PLUGIN_SETUP_FAILED', 'sandbox']],
    ['server-events.md', 'events', ['channelAuthorize', 'events.append', 'runOnce', 'eventSync', 'tenantKey']],
    ['auth-advanced.md', 'auth', ['roles.define', 'roles.assign', 'roles.remove', 'session.data.get', 'session.data.merge', 'AUTH_SESSION_CONFLICT', 'accounts.disable', 'accounts.anonymize']]
]);

async function callableCatalogCreate(){
    const result = /** @type {CallableEntry[]} */ ([]);

    //Classifying every root callable export without treating low-level primitives as missing app features
    for ( const directory of (await readdir( path.join( root, 'packages' ) )).sort() ){
        const metadata = JSON.parse( await readFile( path.join( root, 'packages', directory, 'package.json' ), 'utf8' ) );
        if ( metadata.private === true ){
            continue;

        }

        const module = await import( metadata.name );
        for ( const name of Object.keys( module ).sort() ){
            if ( typeof module[name] !== 'function' ){
                continue;

            }

            let level = 'advanced';
            if ( directory === 'layer' || ['layerStorageOpen', 'layerStorageSchemaDefine', 'layerTableDefine', 'layerDatabaseSchemaDefine'].includes( name ) ){
                level = 'application';

            } else if ( ['cli', 'compiler', 'testkit', 'docs'].includes( directory ) ){
                level = 'tooling';

            } else if ( directory === 'plugin-sdk' ){
                level = 'experimental';

            }

            const article = packageArticles[directory];
            assert.ok( article, 'Classify the new package before documenting its exports.' );
            result.push({package: metadata.name, name, level, article});

        }

    }

    return result;

}

/** @param {unknown} value @param {string} [prefix] @param {Map<string, unknown>} [result] */
function fieldsFlatten( value, prefix = '', result = new Map() ){
    //Retaining container defaults while expanding every declared leaf and array item shape
    if ( prefix !== '' ){
        result.set( prefix, value );

    }

    if ( Array.isArray( value ) ){
        if ( value.length > 0 && typeof value[0] === 'object' && value[0] !== null ){
            fieldsFlatten( value[0], prefix + '[]', result );

        }

    } else if ( value !== null && typeof value === 'object' ){
        for ( const [key, child] of Object.entries( value ) ){
            let childPath = key;
            //Keeping root field names separate from nested field paths
            if ( prefix !== '' ){
                childPath = prefix + '.' + key;

            }

            fieldsFlatten( child, childPath, result );

        }

    }

    return result;

}

/** @param {string} locale */
function labelsRead( locale ){
    //Selecting reviewed labels without changing the generated contract values
    if ( locale === 'ru' ){
        return {
            configHeading: '| Поле | Default или пример | Контракт |',
            catalogHeading: '| Пакет / export | Уровень | Руководство |',
            example: 'пример включённого блока',
            authDefault: 'default при auth.enabled'
        };

    }

    return {
        configHeading: '| Field | Default or example | Contract |',
        catalogHeading: '| Package / export | Level | Guide |',
        example: 'enabled-block example',
        authDefault: 'default with auth.enabled'
    };

}

/** @param {ReturnType<typeof configurationProfilesCreate>} profiles @param {string} locale */
function configurationTableCreate( profiles, locale ){
    //Preparing the same field set for both languages
    const labels = labelsRead( locale );
    const defaultFields = fieldsFlatten( profiles.defaults );
    const authFields = fieldsFlatten( profiles.authDefaults, 'auth' );
    const allFields = fieldsFlatten( profiles.example );
    const rows = [labels.configHeading, '| --- | --- | --- |'];
    const optionalArticles = /** @type {Record<string, string>} */ ({auth: 'layer-auth.md', notifications: 'web-push.md', links: 'links-navigation.md', updates: 'application-updates.md', css: 'configuration.md'});

    //Documenting normalized public fields from the same strict validator used by application builds
    for ( const [field, value] of allFields ){
        if ( value !== null && typeof value === 'object' && !Array.isArray( value ) && Object.keys( value ).length > 0 ){
            continue;

        }

        let selected = value;
        let kind = labels.example;
        if ( defaultFields.has( field ) ){
            selected = defaultFields.get( field );
            kind = 'default';

        } else if ( authFields.has( field ) ){
            selected = authFields.get( field );
            kind = labels.authDefault;

        }

        const group = field.split( '.' )[0] ?? field;
        let article = optionalArticles[group] ?? 'configuration.md';
        //Routing infrastructure fields to their shared lifecycle and secret rules
        if ( ['database', 'redis', 'runtime'].includes( group ) ){
            article = 'database-runtime.md';

        }
        const text = JSON.stringify( selected ).replaceAll( '|', '&#124;' );
        rows.push( '| `' + field + '` | ' + kind + ': `' + text + '` | [' + group + '](' + article + ') |' );

    }

    return rows.join( '\n' );

}

/** @param {CallableEntry[]} catalog @param {string} locale */
function catalogTableCreate( catalog, locale ){
    //Selecting only the display labels while keeping every export identical
    const rows = [
        labelsRead( locale ).catalogHeading,
        '| --- | --- | --- |'
    ];

    //Keeping each exported function visible even when it is intended for a custom trusted host
    for ( const entry of catalog ){
        rows.push( '| `' + entry.package + '` / `' + entry.name + '` | ' + entry.level + ' | [API](' + entry.article + ') |' );

    }

    return rows.join( '\n' );

}

/** @param {string} file @param {string} body @param {boolean} write */
async function generatedSectionHandle( file, body, write ){
    const source = await readFile( file, 'utf8' );
    const section = '<!-- generated-contract:start -->\n' + body + '\n<!-- generated-contract:end -->';
    const expression = /<!-- generated-contract:start -->[\s\S]*?<!-- generated-contract:end -->/u;

    //Updating only the generated table while preserving reviewed explanatory prose
    const sectionMatch = source.match( expression );
    assert.ok( sectionMatch, 'Missing generated section: ' + file );
    if ( write ){
        await writeFile( file, source.replace( expression, section ), 'utf8' );

    } else {
        assert.equal( sectionMatch[0], section, 'Documentation contract drift: ' + file );

    }

}

export async function documentationContractsVerify( write = false ){
    const catalog = await callableCatalogCreate();
    const profiles = configurationProfilesCreate();
    const metadataDirectory = path.join( root, 'docs', 'contracts' );
    await mkdir( metadataDirectory, {recursive: true} );

    //Comparing checked-in contract data so an API/config change requires documentation review
    for ( const [name, data] of Object.entries({'api-catalog.json': catalog, 'configuration.json': profiles}) ){
        const serialized = JSON.stringify( data, null, 4 ) + '\n';
        const file = path.join( metadataDirectory, name );
        if ( write ){
            await writeFile( file, serialized, 'utf8' );

        } else {
            assert.equal( await readFile( file, 'utf8' ), serialized, 'Review documentation metadata: ' + name );

        }

    }

    for ( const locale of ['ru', 'en'] ){
        //Requiring the same semantic sections and API methods in both localized guides
        for ( const [article, topic, names] of topicRequirements ){
            const source = await readFile( path.join( root, 'docs', locale, article ), 'utf8' );
            assert.ok( source.includes( '<!-- contract: ' + topic + ' -->' ), locale + '/' + article + ': ' + topic );
            for ( const name of names ){
                assert.ok( source.includes( name ), locale + '/' + article + ': missing ' + name );

            }

        }

        await generatedSectionHandle( path.join( root, 'docs', locale, 'api-catalog.md' ), catalogTableCreate( catalog, locale ), write );
        await generatedSectionHandle( path.join( root, 'docs', locale, 'configuration-reference.md' ), configurationTableCreate( profiles, locale ), write );

        //Binding runnable code blocks to the exact modules executed by docs:check
        for ( const article of ['structured-data.md', 'indexeddb.md', 'pwa-capabilities.md', 'cache-outbox.md', 'server-events.md'] ){
            const source = await readFile( path.join( root, 'docs', locale, article ), 'utf8' );
            const blocks = [...source.matchAll( /<!-- example: (application\/[a-z]+\.mjs) -->\s*\x60{3}js\r?\n([\s\S]*?)\r?\n\x60{3}/gu )];
            assert.equal( blocks.length, 1, 'Expected one executable example in ' + article );
            for ( const match of blocks ){
                const fixtureName = match[1];
                const block = match[2];
                assert.ok( fixtureName && block );
                const fixture = await readFile( path.join( import.meta.dirname, fixtureName ), 'utf8' );
                assert.equal( block.replaceAll( '\r\n', '\n' ).trim(), fixture.replaceAll( '\r\n', '\n' ).trim(), locale + '/' + article + ': executable example drift' );

            }

        }

    }

    return {exports: catalog.length, topics: topicRequirements.length};

}

//Supporting explicit maintainer regeneration without modifying documents during normal checks
if ( process.argv.includes( '--write-contracts' ) ){
    await documentationContractsVerify( true );

}
