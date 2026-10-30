import {layerSystemOperationCreate} from '@solcorp/layer-server/system';


const phonePatternData = '^\\+[1-9][0-9]{7,14}$';


/**
 * Creates the trusted phone boundary. An application supplies challenge
 * persistence and delivery, while Layer Auth owns identity and cookie issue.
 *
 * @param {{
 *     challenge: {start: Function, consume: Function},
 *     service: {signIn: {verifiedPhone: Function}},
 *     clock?: () => number
 * }} operationOptions
 */
export function layerAuthPhoneOperationDefinitionsCreate( operationOptions ){
    //Checking the trusted callbacks before registering public Auth commands.
    if (
        typeof operationOptions?.challenge?.start !== String( 'function' ) ||
        typeof operationOptions?.challenge?.consume !== String( 'function' ) ||
        typeof operationOptions?.service?.signIn?.verifiedPhone !== String( 'function' )
    ){
        throw new TypeError( 'Layer Auth phone operations require a challenge provider.' );

    }

    const clockData = operationOptions.clock ?? Date.now;
    const commandMetadataData = {
        commandId: {type: 'string', format: 'uuid'},
        baseRevision: {type: 'integer', minimum: 0}
    };
    const sessionOutputData = {
        type: 'object',
        additionalProperties: false,
        required: ['user', 'session'],
        properties: {
            user: {
                type: 'object',
                additionalProperties: false,
                required: ['id'],
                properties: {id: {type: 'string', minLength: 1, maxLength: 128}}
            },
            session: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'idleExpiresAt', 'absoluteExpiresAt'],
                properties: {
                    id: {type: 'string', minLength: 8, maxLength: 128},
                    idleExpiresAt: {type: 'integer', minimum: 0},
                    absoluteExpiresAt: {type: 'integer', minimum: 0}
                }
            }
        }
    };

    //CallBack THE OBJECT
    return Object.freeze([
        layerSystemOperationCreate({
            name: 'auth.phone.start',
            type: 'command',
            auth: 'none',
            rateLimitBucket: 'auth.phone.start',
            cost: 10,
            timeoutMs: 5000,
            transaction: true,
            offlineReplay: false,
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['phone', 'commandId', 'baseRevision'],
                properties: {
                    phone: {type: 'string', pattern: phonePatternData},
                    ...commandMetadataData
                }
            },
            outputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['challengeId', 'expiresAt'],
                properties: {
                    challengeId: {type: 'string', format: 'uuid'},
                    expiresAt: {type: 'integer', minimum: 0}
                }
            },
            /**
             * @param {{phone: string}} payloadData
             * @param {Record<string, any>} contextData
             */
            async handler( payloadData, contextData ){
                //Delegating challenge state to the application provider.
                const challengeResultData = await operationOptions.challenge.start(
                    payloadData,
                    contextData
                );

                //CallBack THE OBJECT
                return Object.freeze({
                    challengeId: String( challengeResultData.challengeId ),
                    expiresAt: Number( challengeResultData.expiresAt )
                });

            }
        }),
        layerSystemOperationCreate({
            name: 'auth.phone.verify',
            type: 'command',
            auth: 'none',
            rateLimitBucket: 'auth.phone.verify',
            cost: 10,
            timeoutMs: 15000,
            transaction: false,
            offlineReplay: false,
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['phone', 'challengeId', 'code', 'commandId', 'baseRevision'],
                properties: {
                    phone: {type: 'string', pattern: phonePatternData},
                    challengeId: {type: 'string', format: 'uuid'},
                    code: {type: 'string', pattern: '^[0-9]{4}$'},
                    ...commandMetadataData
                }
            },
            outputSchema: sessionOutputData,
            /**
             * @param {{phone: string, challengeId: string, code: string}} payloadData
             * @param {{response?: {authSessionSet?: Function}} & Record<string, any>} contextData
             */
            async handler( payloadData, contextData ){
                //Consuming one application-owned code before opening a session.
                const verifiedPhoneData = await operationOptions.challenge.consume(
                    payloadData,
                    contextData
                );
                const signInResultData = await operationOptions.service.signIn.verifiedPhone({
                    phone: String( verifiedPhoneData.phone ),
                    remember: true
                });
                const sessionData = signInResultData.session;
                const authSessionSetData = contextData.response?.authSessionSet;

                if ( typeof authSessionSetData !== 'function' ){
                    throw new TypeError( 'Layer Auth session response capability is unavailable.' );

                }

                //Writing opaque credentials only through the system response capability.
                authSessionSetData({
                    sessionToken: String( sessionData.sessionToken ),
                    csrfToken: String( sessionData.csrfToken ),
                    maximumAgeSeconds: Math.max(
                        Number( 1 ),
                        Math.floor( (Number( sessionData.absoluteExpiresAt ) - Number( clockData() )) / Number( 1000 ) )
                    )
                });

                //Returning safe identity metadata without credential tokens.
                return Object.freeze({
                    user: Object.freeze({id: String( signInResultData.userId )}),
                    session: Object.freeze({
                        id: String( sessionData.sessionId ),
                        idleExpiresAt: Number( sessionData.idleExpiresAt ),
                        absoluteExpiresAt: Number( sessionData.absoluteExpiresAt )
                    })
                });

            }
        })
    ]);

}
