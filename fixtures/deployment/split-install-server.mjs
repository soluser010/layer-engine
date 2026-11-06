import assert from 'node:assert/strict';
import {LayerError} from '@solcorp/layer-protocol';
import {
    layerDiagnosticsCreate,
    layerHttpRuntimeCreate,
    layerOperationExecutorCreate,
    layerOperationRegistryCreate
} from '@solcorp/layer-server';
import {layerSystemOperationCreate} from '@solcorp/layer-server/system';

export function layerServerCreate( contextData ){
    //Register managed authentication in the registry imported by the application.
    const authentication = contextData.auth.create({
        allowedOrigins: [contextData.origin],
        secureCookies: false
    });
    const operationRegistry = layerOperationRegistryCreate();
    const diagnostics = layerDiagnosticsCreate();
    authentication.register( operationRegistry );

    const testOperation = {
        name: 'test.denied',
        type: 'query',
        auth: 'none',
        inputSchema: {type: 'object'},
        outputSchema: {type: 'object'},
        handler(){
            throw new LayerError( 'PERMISSION_DENIED', 'Access denied.', {status: 403} );
        }
    };
    operationRegistry.define( layerSystemOperationCreate( testOperation ) );
    assert.equal( operationRegistry.get( 'auth.state.get' ).system, true );
    assert.equal( operationRegistry.get( 'test.denied' ).system, true );
    operationRegistry.define({
        ...testOperation,
        name: 'test.unexpected',
        handler(){
            throw Object.assign( new Error( 'private diagnostic' ), {code: 'AUTH_REQUIRED', status: 401} );
        }
    });

    const operationExecutor = layerOperationExecutorCreate({
        operationRegistry,
        security: authentication.security,
        contextExtend: authentication.contextExtend,
        rateLimiter: contextData.rateLimiter,
        diagnostics
    });

    return layerHttpRuntimeCreate({operationRegistry, operationExecutor, diagnostics});
}
