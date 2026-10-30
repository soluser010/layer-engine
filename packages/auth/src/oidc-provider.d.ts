declare module 'oidc-provider' {
    import type {
        IncomingMessage,
        ServerResponse
    } from 'node:http';

    export default class Provider {
        constructor( issuer: string, configuration: Record<string, unknown> );
        callback(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
        interactionDetails( request: IncomingMessage, response: ServerResponse ): Promise<Record<string, any>>;
        interactionFinished(
            request: IncomingMessage,
            response: ServerResponse,
            result: Record<string, unknown>,
            options?: Record<string, unknown>
        ): Promise<void>;
        Grant: new (data: Record<string, unknown>) => {
            addOIDCScope( scope: string ): void;
            save(): Promise<string>;
        };
    }
}
