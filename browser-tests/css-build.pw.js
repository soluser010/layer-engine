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
