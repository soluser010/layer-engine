import {expect, test} from '@playwright/test';

test( 'compiled CSS preserves computed layout after lowering and minification', async function( {page} ){
    //Loading the emitted route stylesheet through the real application bootstrap
    await page.goto( '/css/' );
    const childData = page.locator( '.css-child' );
    await expect( childData ).toHaveCSS( 'width', '20px' );
    await expect( childData ).toHaveCSS( 'height', '30px' );
    await expect( childData ).toHaveCSS( 'padding-top', '0px' );
    await expect( childData ).toHaveCSS( 'color', 'rgb(255, 0, 0)' );
    await expect( page.locator('.css-example') ).toHaveCSS( 'user-select', 'none' );

});

test( 'the browser decodes the WOFF2 emitted for an imported stylesheet', async function( {page} ){
    //Wait for the route stylesheet before requesting its single-glyph test font.
    await page.goto( '/css/' );
    await expect( page.locator( '.css-child' ) ).toHaveCSS( 'width', '20px' );
    const fontStates = await page.evaluate(async function(){
        //Require an actual registered FontFace so a system fallback cannot pass the test.
        const faces = await document.fonts.load( '16px LayerTriangle', 'A' );
        return faces.map(face => face.status);

    });
    expect( fontStates ).toEqual(['loaded']);

});
