import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    layerConfigLoad,
    layerProjectBuild,
    layerProjectCreate
} from '../src/index.js';

test('builds generated operations and the complete external CSS matrix', async function(testContext){
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'layer-modern-build-'));
    const projectDirectory = path.join(temporaryDirectory, 'modern-app');

    testContext.after(async function temporaryProjectRemove(){
        await rm(temporaryDirectory, {
            recursive: true,
            force: true
        });

    });
    await layerProjectCreate({
        targetDirectory: projectDirectory,
        projectName: 'modern-app'
    });

    const styleDirectory = path.join(projectDirectory, 'src', 'styles');

    await mkdir(styleDirectory, {recursive: true});
    await writeFile(path.join(styleDirectory, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n', 'utf8');
    await writeFile(path.join(styleDirectory, 'page.layer.module.css'), `
.panel {
    background-image: url('./icon.svg');
}
`, 'utf8');
    await writeFile(path.join(styleDirectory, 'page.global.layer.css'), '.application-shell { display: block; }\n', 'utf8');
    await writeFile(path.join(projectDirectory, 'src', 'operations.js'), `
import {layerOperationContractsCreate} from '@solcorp/layer';

export const operations = layerOperationContractsCreate([
    {
        name: 'message.list',
        type: 'query',
        auth: 'none',
        inputSchema: {
            type: 'object',
            additionalProperties: false
        },
        outputSchema: {
            type: 'array',
            items: {
                type: 'string'
            }
        }
    }
]);
`, 'utf8');
    await writeFile(path.join(projectDirectory, 'src', 'pages', 'index.layer.js'), `
import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';
import {messageListQueryCreate} from '#layer/operations';
import classes from '../styles/page.layer.module.css';
import '../styles/page.global.layer.css';

export const page = layerPageCreate({auth: 'none', render: 'csr'});

export default layerComponentCreate(function ModernPage(_properties, context) {
    const messagesQuery = messageListQueryCreate(context, {payload: {}});

    return html\`<main class=\${classes.panel}>\${messagesQuery.status}</main>\`;
});
`, 'utf8');

    const configurationData = await layerConfigLoad(projectDirectory);
    const buildResult = await layerProjectBuild({
        rootDirectory: projectDirectory,
        config: configurationData
    });
    const routeList = JSON.parse(await readFile(path.join(projectDirectory, 'dist', '_layer', 'routes.json'), 'utf8'));
    const routeData = routeList[0];
    const routeModule = await readFile(path.join(projectDirectory, 'dist', routeData.component), 'utf8');
    const routeStyle = await readFile(path.join(projectDirectory, 'dist', routeData.style), 'utf8');
    const operationDeclaration = await readFile(
        path.join(projectDirectory, 'dist', '_layer', 'operations.d.mts'),
        'utf8'
    );
    const styleManifest = JSON.parse(await readFile(
        path.join(projectDirectory, 'dist', '_layer', 'styles.json'),
        'utf8'
    ));
    const assetNames = buildResult.artifacts.filter(function cssAssetSelect(artifactName){
        //Selecting only content-addressed assets produced from CSS URLs
        return artifactName.startsWith('_layer/assets/');

    });

    assert.match(routeModule, /message\.list/);
    assert.match(routeModule, /panel__/);
    assert.match(routeStyle, /panel__[a-f0-9]{8}\[data-layer-scope=/);
    assert.match(routeStyle, /\.application-shell/);
    assert.match(routeStyle, /\/_layer\/assets\/[a-f0-9]{24}\.svg/);
    assert.match(operationDeclaration, /messageListQueryCreate/);
    assert.match(operationDeclaration, /readonly \(string\)\[\]/);
    assert.equal(styleManifest.routes[0].style, routeData.style);

    //Checking that the app shell is external, integrity-covered and available offline
    const shellSource = await readFile(path.join(projectDirectory, 'dist', 'index.html'), 'utf8');
    const versionManifest = /** @type {{assets: {url: string, required: boolean}[]}} */ (JSON.parse(
        await readFile(path.join(projectDirectory, 'dist', '_layer', 'version.json'), 'utf8')
    ));
    assert.match(shellSource, /href="\/_layer\/viewport.css"/u);
    assert.match(shellSource, /viewport-fit=cover, interactive-widget=resizes-visual/u);
    //Keeping browser page scale separate from custom photo-viewer transforms
    assert.match( shellSource, /minimum-scale=1.0, maximum-scale=1.0, user-scalable=no/u );
    const viewportStylesheetData = await readFile( path.join( projectDirectory, 'dist/_layer/viewport.css' ), 'utf8' );
    assert.match( viewportStylesheetData, /touch-action:pan-x pan-y/u );
    assert.doesNotMatch( viewportStylesheetData, /touch-action: manipulation|pinch-zoom/u );
    assert.ok(buildResult.integrity['_layer/viewport.css']);
    assert.ok(versionManifest.assets.some(function viewportAssetFind(assetData){
        //Requiring the same stylesheet during Service Worker installation
        return assetData.url === '/_layer/viewport.css' && assetData.required === true;

    }));
    assert.equal(assetNames.length, 1);
    assert.equal(buildResult.operations[0]?.name, 'message.list');
});
