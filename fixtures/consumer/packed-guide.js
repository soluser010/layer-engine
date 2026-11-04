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
        /** @type {{url: string}[]} */
        const articleItemsData = await indexData.json();
        assert.ok( articleItemsData.length >= 41 );

        //Checking that nested release notes ship in the real npm archive and retain local links
        const historyPathData = '/' + languageData + '/updates/0.1.2.html';
        assert.ok( articleItemsData.some( function( articleData ){
            //Finding the release article in the same offline search index as the handbook
            return articleData.url === historyPathData;

        }) );
        const historyResponseData = await fetch( guideData.origin + historyPathData );
        assert.equal( historyResponseData.status, 200 );
        const historyHtmlData = await historyResponseData.text();
        assert.ok( historyHtmlData.includes( 'href="/' + languageData + '/updates/README.html"' ) );
        assert.ok( historyHtmlData.includes( 'href="/' + languageData + '/application-updates.html"' ) );

    }

} finally {
    //Releasing the listener so the packed-consumer gate can remove its fixture
    await guideData.close();

}
