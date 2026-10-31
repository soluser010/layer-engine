import {readdir} from 'node:fs/promises';
import {test, expect} from '@playwright/test';
import {layerGuideServe} from '../packages/docs/src/index.js';

test( 'installed guide provides local search, highlighted examples and both languages', async function({page}){
    //Using the same package listener exposed by layer guide without network dependencies
    const guideData = await layerGuideServe({lang: 'ru'});
    //Matching the guide inventory to application articles instead of a frozen article count
    const articleFilesData = await readdir( new URL( '../docs/ru/', import.meta.url ) );
    const articleCountData = articleFilesData.filter(function( filenameData ){
        //Counting published Markdown articles only
        return filenameData.endsWith( '.md' );

    }).length;
    const errorsData = [];
    page.on( 'pageerror', function( errorData ){
        //Recording script and CSP failures instead of relying on the visible heading alone
        errorsData.push( errorData.message );

    });
    try {
        await page.route( '**/*', function( routeData ){
            //Proving that the installed handbook needs only its own loopback resources
            if ( new URL( routeData.request().url() ).origin === guideData.origin ){
                return routeData.continue();

            }
            return routeData.abort();

        });
        await page.goto( guideData.url );
        await expect( page.locator( '#articles li' ) ).toHaveCount( articleCountData );
        await page.locator( '#search' ).fill( 'несуществующийтермин123' );
        await expect( page.locator( '#articles li' ) ).toHaveCount( 0 );
        await page.locator( '#search' ).fill( 'layerPageCreate' );
        await expect( page.locator( '#articles li' ) ).not.toHaveCount( 0 );
        await page.goto( guideData.origin + '/en/installation-cli.html' );
        await expect( page.locator( 'html' ) ).toHaveAttribute( 'lang', 'en' );
        await expect( page.locator( '#articles li' ) ).toHaveCount( articleCountData );
        await page.goto( guideData.origin + '/en/components.html' );
        await expect( page.locator( '#articles li' ) ).toHaveCount( articleCountData );
        await expect( page.locator( '.hljs-keyword' ).first() ).toBeVisible();
        await page.setViewportSize({width: 390, height: 844});
        expect( await page.evaluate( function(){
            //Checking that code blocks scroll locally instead of expanding the whole document
            return document.documentElement.scrollWidth <= window.innerWidth;

        }) ).toBe( true );
        //Verifying navigation to the new reference without losing mobile overflow containment
        await page.goto( guideData.origin + '/en/page-configuration.html' );
        await expect( page.locator( '#articles li' ) ).toHaveCount( articleCountData );
        await expect( page.getByRole( 'heading', {level: 1}) ).toHaveText( 'Complete page configuration' );
        await expect( page.locator( 'body' ) ).toContainText( 'does not switch HTTP headers' );
        await page.goto( guideData.origin + '/ru/api-reference-runtime.html' );
        await expect( page.locator( '#articles li' ) ).toHaveCount( articleCountData );
        await expect( page.locator( '.hljs-keyword' ).first() ).toBeVisible();
        expect( await page.evaluate(function(){
            //Keeping wide signatures scrollable within their code blocks
            return document.documentElement.scrollWidth <= window.innerWidth;

        }) ).toBe( true );
        expect( errorsData ).toEqual( [] );

    } finally {
        //Releasing the owned server even after a failed assertion
        await guideData.close();

    }

});
