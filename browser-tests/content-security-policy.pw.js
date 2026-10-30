import {createServer} from 'node:http';
import {expect, test} from '@playwright/test';
import {layerContentSecurityPolicyCreate} from '../packages/cli/src/content-security-policy.js';


test( 'configured CSP permits map frames without broadening scripts and preserves mixed-case wildcards', async function( {page} ){
    //Serving parser-loaded resources so debugger evaluation cannot bypass the browser CSP decision
    const serverData = createServer(function( requestData, responseData ){
        //Providing one self-hosted script before checking any optional external permissions
        if ( requestData.url === '/probe.mjs' ){
            responseData.writeHead( 200, {'Content-Type': 'text/javascript'} );
            responseData.end( 'document.documentElement.dataset.probeLoaded = "yes";' );
            return;

        }

        //Selecting a controlled policy without reading developer files or accepting arbitrary policy text
        const requestUrlData = new URL( requestData.url ?? '/', 'http://localhost' );
        const scenarioData = requestUrlData.pathname.slice( 1 );
        let modeData = /** @type {'development' | 'production'} */ ('production');
        let frameOriginData = 'https://api-maps.yandex.ru';
        let securityData = /** @type {unknown} */ (null);
        if ( scenarioData.endsWith( '-dev' ) ){
            modeData = 'development';

        }

        //Keeping iframe and script exceptions independent for the same external resource attempts
        if ( scenarioData.startsWith( 'frame-only' ) ){
            securityData = {csp: {sources: {'frame-src': [frameOriginData]}}};

        } else if ( scenarioData === 'lowercase-wildcard' ){
            frameOriginData = 'https://sub.maps.example.test';
            securityData = {csp: {sources: {'frame-src': ['https://*.maps.example.test']}}};

        } else if ( scenarioData === 'uppercase-wildcard' ){
            frameOriginData = 'https://sub.maps.example.test';
            securityData = {csp: {sources: {'frame-src': ['HTTPS://*.MAPS.EXAMPLE.TEST']}}};

        } else if ( scenarioData.startsWith( 'script-only' ) ){
            securityData = {csp: {sources: {'script-src': ['https://sdk.example.test']}}};

        }

        //Applying the actual framework policy before parser-created frames and scripts are loaded
        responseData.writeHead( 200, {
            'Content-Type': 'text/html',
            'Content-Security-Policy': layerContentSecurityPolicyCreate( securityData, modeData )
        });
        responseData.end(
            '<!doctype html><html><head><meta charset="utf-8"><title>CSP test</title>' +
            '<script src="/probe.mjs"></script></head><body><h1>CSP test</h1>' +
            '<iframe title="Map probe" src="' + frameOriginData + '/frame/v1/test?lang=ru"></iframe>' +
            '<script src="https://sdk.example.test/external.js"></script></body></html>'
        );

    });

    try {
        //Opening one ephemeral loopback port per browser fixture rather than sharing a global listener
        await new Promise(function( resolve, rejected ){
            //Propagating listener failures without leaving a pending test
            serverData.once( 'error', rejected );
            serverData.listen( 0, '127.0.0.1', function(){
                //Releasing the startup-only listener after successful readiness
                serverData.removeListener( 'error', rejected );
                resolve( undefined );

            });

        });
        const serverAddressData = serverData.address();
        expect( serverAddressData ).not.toBeNull();
        if ( serverAddressData === null || typeof serverAddressData === 'string' ){
            //Failing an unexpected native listener contract without dereferencing an invalid address
            throw new Error( 'The CSP test requires a loopback TCP address.' );

        }

        //Mocking provider responses while retaining real URL origins and browser policy enforcement
        await page.route( /^https:\/\/(?:api-maps\.yandex\.ru|sub\.maps\.example\.test)\//u, async function( routeData ){
            //Providing deterministic iframe content without depending on provider availability or credentials
            await routeData.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><html><body><h1>Mock map ready</h1></body></html>'
            });

        });
        await page.route( 'https://sdk.example.test/**', async function( routeData ){
            //Marking actual parser-loaded external execution instead of evaluating an equivalent script
            await routeData.fulfill({
                status: 200,
                contentType: 'text/javascript',
                body: 'document.documentElement.dataset.externalLoaded = "yes";'
            });

        });

        for ( const scenarioData of ['default', 'frame-only-dev', 'frame-only-prod', 'lowercase-wildcard', 'uppercase-wildcard', 'script-only-dev', 'script-only-prod'] ){
            //Waiting for all permitted resources before checking denied and allowed outcomes
            await page.goto( 'http://127.0.0.1:' + serverAddressData.port + '/' + scenarioData, {waitUntil: 'networkidle'} );
            await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-probe-loaded', 'yes' );
            const mapFrameData = page.frames().find(function( frameData ){
                //Ignoring browser-generated blocked documents and selecting only the permitted provider origin
                return /^https:\/\/(?:api-maps\.yandex\.ru|sub\.maps\.example\.test)\//u.test( frameData.url() );

            });
            let expectedFrameStatus = false;
            if ( scenarioData.startsWith( 'frame-only' ) || scenarioData.endsWith( '-wildcard' ) ){
                expectedFrameStatus = true;

            }

            //Checking the corrected uppercase case along with default denial and directive isolation
            expect( mapFrameData !== undefined, scenarioData ).toBe( expectedFrameStatus );
            if ( mapFrameData !== undefined ){
                await expect( mapFrameData.getByRole( 'heading', {name: 'Mock map ready'} ) ).toBeVisible();

            }

            const externalLoadedStatus = await page.locator( 'html' ).getAttribute( 'data-external-loaded' );
            expect( externalLoadedStatus === 'yes', scenarioData ).toBe( scenarioData.startsWith( 'script-only' ) );

        }

    } finally {
        //Closing only the fixture's listener and sockets, never an application or shared service
        serverData.closeAllConnections();
        await new Promise(function( resolve, rejected ){
            //Completing the callback-only shutdown with explicit error propagation
            serverData.close(function( closeError ){
                if ( closeError ){
                    //Passing unexpected cleanup failures to the browser test runner
                    rejected( closeError );
                    return;

                }

                resolve( undefined );

            });

        });

    }

});
