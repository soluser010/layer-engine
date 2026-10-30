import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {Linter} from 'eslint';
import {layerJavascriptComponentCompile} from '@solcorp/layer-compiler';

test( 'viewport RU and EN examples have matching contracts and compile through the real component compiler', async function(){
    //Reading the two public articles without running browser side effects
    const languageLists = [];
    for ( const localeName of ['ru', 'en'] ){
        const articleSource = await readFile( new URL( '../docs/' + localeName + '/viewport.md', import.meta.url ), 'utf8' );
        const codeBlocks = [...articleSource.matchAll( /```(\w+)\n([\s\S]*?)```/gu )];
        const blockLanguages = [];
        for ( const blockData of codeBlocks ){
            const languageName = String( blockData[1] );
            const exampleSource = String( blockData[2] );
            blockLanguages.push( languageName );
            if ( languageName === 'js' ){
                //Checking every JS block, including application-owned anchor callbacks, as module syntax
                const syntaxErrors = new Linter().verify( exampleSource, [{languageOptions: {ecmaVersion: 2024, sourceType: 'module'}}] );
                assert.equal( syntaxErrors.length, 0 );
                if ( exampleSource.includes( 'layerComponentCreate' ) ){
                    const componentData = layerJavascriptComponentCompile( exampleSource, {componentId: 'docs/' + localeName + '/viewport'} );
                    assert.ok( componentData.template );

                }

            } else if ( languageName === 'html' ){
                //Compiling declarative policies as native Layer tagged templates
                const componentSource = "import {html, layerComponentCreate} from '@solcorp/layer';\n" +
                    'export default layerComponentCreate(function Example(){ return html`' + exampleSource + '`; });';
                assert.ok( layerJavascriptComponentCompile( componentSource, {componentId: 'docs/' + localeName + '/html'} ).template );

            }

        }

        //Checking local links and metadata rather than masking the unrelated configuration article failure
        for ( const fieldName of ['title', 'description', 'audience', 'order', 'status', 'updated'] ){
            assert.match( articleSource, new RegExp( '^' + fieldName + ': .+', 'mu' ) );

        }

        for ( const linkData of articleSource.matchAll( /\]\(([^)]+\.md)\)/gu ) ){
            const linkedSource = await readFile( new URL( '../docs/' + localeName + '/' + linkData[1], import.meta.url ), 'utf8' );
            assert.ok( linkedSource.length > 0 );

        }

        languageLists.push( blockLanguages );

    }

    assert.deepEqual( languageLists[0], languageLists[1] );

});
