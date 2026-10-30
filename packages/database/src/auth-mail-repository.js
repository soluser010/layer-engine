import {randomUUID} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';


const templateNamePatternData = /^[a-z][a-z0-9-]{1,79}$/u;


/**
 * Creates the durable encrypted Auth mail outbox. Recipient and template
 * payload encryption is performed by Layer Auth before this SQL boundary.
 *
 * @param {{
 *     database: {
 *         systemSchema?: string,
 *         query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, any>[], rowCount: number | null}>,
 *         transaction: <ResultData>(handlerData: (databaseData: any) => Promise<ResultData>) => Promise<ResultData>
 *     },
 *     identifierCreate?: () => string
 * }} repositoryOptions
 */
export function layerAuthMailRepositoryCreate( repositoryOptions ){
    //Checking durable storage before accepting encrypted delivery records
    if (
        repositoryOptions === null ||
        typeof repositoryOptions !== String( 'object' ) ||
        typeof repositoryOptions.database?.query !== String( 'function' ) ||
        typeof repositoryOptions.database?.transaction !== String( 'function' )
    ){
        throw new TypeError( 'Auth mail outbox requires a transactional database.' );

    }

    const mailTableData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_auth_mail_outbox' );
    const identifierCreateData = repositoryOptions.identifierCreate ?? randomUUID;

    return Object.freeze({
        /**
         * @param {{
         *     templateName: string,
         *     recipientHash: string,
         *     recipientEncrypted: Uint8Array,
         *     locale: string,
         *     payloadEncrypted: Uint8Array,
         *     database?: {query: Function}
         * }} mailData
         */
        async enqueue( mailData ){
            //Checking only non-secret metadata and encrypted envelope bounds
            if ( typeof mailData?.templateName !== 'string' || templateNamePatternData.test( mailData.templateName ) === false ){
                throw new TypeError( 'Auth mail template name is invalid.' );

            }

            if ( typeof mailData.recipientHash !== 'string' || /^[0-9a-f]{64}$/u.test( mailData.recipientHash ) === false ){
                throw new TypeError( 'Auth mail recipient hash is invalid.' );

            }

            if ( typeof mailData.locale !== 'string' || /^[a-z]{2}(?:-[A-Z]{2})?$/u.test( mailData.locale ) === false ){
                throw new TypeError( 'Auth mail locale is invalid.' );

            }

            if (
                ArrayBuffer.isView( mailData.recipientEncrypted ) === false ||
                Number( mailData.recipientEncrypted.byteLength ) < Number( 32 ) ||
                Number( mailData.recipientEncrypted.byteLength ) > Number( 2048 ) ||
                ArrayBuffer.isView( mailData.payloadEncrypted ) === false ||
                Number( mailData.payloadEncrypted.byteLength ) < Number( 32 ) ||
                Number( mailData.payloadEncrypted.byteLength ) > Number( 65536 )
            ){
                throw new TypeError( 'Auth mail encrypted envelope is invalid.' );

            }

            const mailIdentifierData = identifierCreateData();
            const queryDatabaseData = mailData.database ?? repositoryOptions.database;

            await queryDatabaseData.query({
                text: `
                    INSERT INTO ${String( mailTableData )} (
                        mail_id,
                        template_name,
                        recipient_hash,
                        recipient_encrypted,
                        locale,
                        payload_encrypted,
                        status
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, 'pending')
                `,
                values: [
                    mailIdentifierData,
                    mailData.templateName,
                    mailData.recipientHash,
                    Buffer.from( mailData.recipientEncrypted ),
                    mailData.locale,
                    Buffer.from( mailData.payloadEncrypted )
                ]
            });

            //CallBack THE STRING
            return String( mailIdentifierData );

        },

        /**
         * @param {{owner: string, limit: number, leaseUntil: number}}
         * leaseData
         */
        async lease( leaseData ){
            //Checking worker ownership and resource bounds before claiming mail
            if ( typeof leaseData?.owner !== 'string' || Number( leaseData.owner.length ) < Number( 8 ) || Number( leaseData.owner.length ) > Number( 128 ) ){
                throw new TypeError( 'Auth mail lease owner is invalid.' );

            }

            if ( Number.isInteger( leaseData.limit ) === false || Number( leaseData.limit ) < Number( 1 ) || Number( leaseData.limit ) > Number( 50 ) ){
                throw new TypeError( 'Auth mail lease limit is invalid.' );

            }

            if ( Number.isFinite( leaseData.leaseUntil ) === false || Number( leaseData.leaseUntil ) <= Number( Date.now() ) ){
                throw new TypeError( 'Auth mail lease expiry is invalid.' );

            }

            const mailLeaseResultData = await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( mailTableData )} AS mail
                    SET
                        status = 'sending',
                        attempts = mail.attempts + 1,
                        lease_owner = $1,
                        lease_until = $2,
                        updated_at = now()
                    WHERE mail.mail_id IN (
                        SELECT candidate.mail_id
                        FROM ${String( mailTableData )} AS candidate
                        WHERE (
                            candidate.status = 'pending'
                            OR (candidate.status = 'sending' AND candidate.lease_until < now())
                        )
                            AND candidate.next_attempt_at <= now()
                        ORDER BY candidate.created_at ASC
                        FOR UPDATE SKIP LOCKED
                        LIMIT $3
                    )
                    RETURNING
                        mail.mail_id,
                        mail.template_name,
                        mail.recipient_encrypted,
                        mail.locale,
                        mail.payload_encrypted,
                        mail.attempts
                `,
                values: [
                    leaseData.owner,
                    new Date( leaseData.leaseUntil ),
                    leaseData.limit
                ]
            });

            //CallBack THE OBJECT
            return Object.freeze(mailLeaseResultData.rows.map(function mailRowMap( mailRowData ){
                //Mapping only leased delivery fields while preserving encrypted recipient bytes
                return Object.freeze({
                    mailId: String( mailRowData.mail_id ),
                    templateName: String( mailRowData.template_name ),
                    recipientEncrypted: Buffer.from( mailRowData.recipient_encrypted ),
                    locale: String( mailRowData.locale ),
                    payloadEncrypted: Buffer.from( mailRowData.payload_encrypted ),
                    attempts: Number( mailRowData.attempts )
                });

            }));

        },

        /** @param {string} mailIdentifierData @param {string} ownerData */
        async sent( mailIdentifierData, ownerData ){
            const mailSentResultData = await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( mailTableData )}
                    SET
                        status = 'sent',
                        sent_at = now(),
                        lease_owner = NULL,
                        lease_until = NULL,
                        last_error_code = NULL,
                        updated_at = now()
                    WHERE mail_id = $1
                        AND lease_owner = $2
                        AND status = 'sending'
                `,
                values: [mailIdentifierData, ownerData]
            });

            //CallBack THE BOOLEAN
            return Number( mailSentResultData.rowCount ?? 0 ) === Number( 1 );

        },

        /**
         * @param {{mailId: string, owner: string, errorCode: string, nextAttemptAt: number, terminal: boolean}}
         * failureData
         */
        async failed( failureData ){
            //Recording a bounded code without storing SMTP error text or message data
            if ( typeof failureData.errorCode !== 'string' || /^[A-Z][A-Z0-9_]{2,79}$/u.test( failureData.errorCode ) === false ){
                throw new TypeError( 'Auth mail failure code is invalid.' );

            }

            let mailStatusData = 'pending';

            //Marking the message terminal only after the bounded retry policy is exhausted
            if ( failureData.terminal === true ){
                mailStatusData = 'failed';

            }

            const mailFailureResultData = await repositoryOptions.database.query({
                text: `
                    UPDATE ${String( mailTableData )}
                    SET
                        status = $3,
                        next_attempt_at = $4,
                        lease_owner = NULL,
                        lease_until = NULL,
                        last_error_code = $5,
                        updated_at = now()
                    WHERE mail_id = $1
                        AND lease_owner = $2
                        AND status = 'sending'
                `,
                values: [
                    failureData.mailId,
                    failureData.owner,
                    mailStatusData,
                    new Date( failureData.nextAttemptAt ),
                    failureData.errorCode
                ]
            });

            //CallBack THE BOOLEAN
            return Number( mailFailureResultData.rowCount ?? 0 ) === Number( 1 );

        }
    });

}
