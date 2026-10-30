import {
    createHmac,
    randomUUID
} from 'node:crypto';
import {layerSystemTableReferenceCreate} from './system-schema.js';

const auditOutcomes = Object.freeze([
    'success',
    'denied',
    'failed'
]);

/**
 * @param {unknown} valueData
 * @param {string} fieldName
 * @param {boolean} [nullableStatus]
 */
function auditStringAssert(valueData, fieldName, nullableStatus = false) {
    //Allowing absent identity dimensions without accepting unbounded strings.
    if (nullableStatus && valueData === null) {
        return;

    }

    if (typeof valueData !== 'string' || valueData.length < 1 || valueData.length > 500) {
        throw new TypeError(`${fieldName} is invalid.`);

    }

}

/**
 * @param {object} repositoryOptions
 * @param {{query: (queryData: {text: string, values: readonly unknown[]}) => Promise<{rows: Record<string, unknown>[], rowCount: number | null}>}} repositoryOptions.database
 * @param {string} repositoryOptions.auditPepper
 * @param {() => string} [repositoryOptions.idCreate]
 * @param {() => Date} [repositoryOptions.clock]
 */
export function layerAuditRepositoryCreate(repositoryOptions) {
    //Selecting deterministic seams only when the caller provides them for testing.
    const idCreate = repositoryOptions.idCreate ?? randomUUID;
    const clock = repositoryOptions.clock ?? function auditClockRead() {
        //Reading wall-clock time only at the durable audit boundary.
        return new Date();

    };

    //Checking durable storage and server-only key material at startup.
    if (typeof repositoryOptions.database?.query !== 'function' || typeof repositoryOptions.auditPepper !== 'string' || repositoryOptions.auditPepper.length < 32 ||
        typeof idCreate !== 'function' || typeof clock !== 'function') {
        throw new TypeError('Audit repository options are invalid.');

    }

    //Getting the app-specific audit table before recording privileged actions
    const auditLogTableReferenceData = layerSystemTableReferenceCreate( repositoryOptions.database, 'sys_audit_log' );

    return Object.freeze({
        /**
         * @param {object} auditData
         * @param {string} auditData.requestId
         * @param {string} auditData.operation
         * @param {string} auditData.category
         * @param {string} auditData.authenticationType
         * @param {string | null} auditData.credentialId
         * @param {string | null} auditData.userId
         * @param {string | null} auditData.tenantId
         * @param {string} auditData.remoteAddress
         * @param {'success' | 'denied' | 'failed'} auditData.outcome
         * @param {string | null} auditData.errorCode
         */
        async record(auditData) {
            auditStringAssert(auditData.requestId, 'requestId');
            auditStringAssert(auditData.operation, 'operation');
            auditStringAssert(auditData.category, 'category');
            auditStringAssert(auditData.authenticationType, 'authenticationType');
            auditStringAssert(auditData.credentialId, 'credentialId', true);
            auditStringAssert(auditData.userId, 'userId', true);
            auditStringAssert(auditData.tenantId, 'tenantId', true);
            auditStringAssert(auditData.remoteAddress, 'remoteAddress');
            auditStringAssert(auditData.errorCode, 'errorCode', true);

            if (!auditOutcomes.includes(auditData.outcome)) {
                throw new TypeError('Audit outcome is invalid.');

            }

            const auditIdentifier = idCreate();
            const occurredAt = clock();

            auditStringAssert(auditIdentifier, 'auditId');

            if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
                throw new TypeError('Audit clock returned an invalid date.');

            }

            //Pseudonymizing the network identifier with a server-only pepper.
            const remoteAddressHash = createHmac('sha256', repositoryOptions.auditPepper)
                .update(auditData.remoteAddress, 'utf8')
                .digest('hex');

            await repositoryOptions.database.query({
                text: `
                    INSERT INTO ${String( auditLogTableReferenceData )} (
                        audit_id,
                        request_id,
                        operation,
                        category,
                        authentication_type,
                        credential_id,
                        user_id,
                        tenant_id,
                        remote_address_hash,
                        outcome,
                        error_code,
                        occurred_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `,
                values: [
                    auditIdentifier,
                    auditData.requestId,
                    auditData.operation,
                    auditData.category,
                    auditData.authenticationType,
                    auditData.credentialId,
                    auditData.userId,
                    auditData.tenantId,
                    remoteAddressHash,
                    auditData.outcome,
                    auditData.errorCode,
                    occurredAt.toISOString()
                ]
            });

            return auditIdentifier;

        }
    });

}
