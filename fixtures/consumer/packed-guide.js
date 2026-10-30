import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

//Loading the installed archive directly rather than resolving the workspace package
assert.ok( process.argv[2], 'Installed documentation entry is required.' );
const moduleData = await import( pathToFileURL( process.argv[2] ).href );
const guideData = await moduleData.layerGuideServe({lang: 'en'});
try {
    //Requiring readable pages and a complete local search index in both languages
    for ( const languageData of ['en', 'ru'] ){
        const pageData = await fetch( guideData.origin + '/' + languageData + '/README.html' );
        assert.equal( pageData.status, 200 );
        assert.ok( (await pageData.text()).includes( 'Layer' ) );
        const indexData = await fetch( guideData.origin + '/' + languageData + '/search.json' );
        assert.ok( (await indexData.json()).length >= 41 );

    }

} finally {
    //Releasing the listener so the packed-consumer gate can remove its fixture
    await guideData.close();

}
