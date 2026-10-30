import {LayerCliError} from './cli-error.js';

/**
 * @param {unknown} valueData
 */
function objectRecordCheck(valueData) {
    //Checking schema values before reading their public fields.
    return typeof valueData === 'object' && valueData !== null && !Array.isArray(valueData);

}

/**
 * @param {unknown} valueData
 */
function literalTypeSourceCreate(valueData) {
    //Preserving only JSON literal kinds that TypeScript can represent exactly.
    if (typeof valueData === 'string') {
        return JSON.stringify(valueData);

    }

    if (typeof valueData === 'number' || typeof valueData === 'boolean' || valueData === null) {
        return String(valueData);

    }

    return 'unknown';

}

/**
 * @param {unknown} schemaData
 * @param {number} [depthData]
 * @returns {string}
 */
function schemaTypeSourceCreate(schemaData, depthData = 0) {
    if (depthData > 24) {
        return 'unknown';

    }

    if (schemaData === true) {
        return 'unknown';

    }

    if (schemaData === false) {
        return 'never';

    }

    if (!objectRecordCheck(schemaData)) {
        return 'unknown';

    }

    const schemaRecord = /** @type {Record<string, unknown>} */ (schemaData);

    if (Object.hasOwn(schemaRecord, 'const')) {
        return literalTypeSourceCreate(schemaRecord.const);

    }

    if (Array.isArray(schemaRecord.enum) && schemaRecord.enum.length > 0) {
        return schemaRecord.enum.map(literalTypeSourceCreate).join(' | ');

    }

    for (const unionField of ['oneOf', 'anyOf']) {
        if (Array.isArray(schemaRecord[unionField]) && schemaRecord[unionField].length > 0) {
            return schemaRecord[unionField].map(function unionSchemaCreate(unionSchema) {
                //Converting each alternative independently before joining the union.
                return schemaTypeSourceCreate(unionSchema, depthData + 1);

            }).join(' | ');

        }

    }

    if (Array.isArray(schemaRecord.type)) {
        return schemaRecord.type.map(function schemaTypeAlternativeCreate(schemaType) {
            //Reusing the ordinary scalar conversion for nullable and multi-type schemas.
            return schemaTypeSourceCreate({
                ...schemaRecord,
                type: schemaType
            }, depthData + 1);

        }).join(' | ');

    }

    if (schemaRecord.type === 'array') {
        return `readonly (${schemaTypeSourceCreate(schemaRecord.items ?? true, depthData + 1)})[]`;

    }

    if (schemaRecord.type === 'object' || objectRecordCheck(schemaRecord.properties)) {
        let propertyData = /** @type {Record<string, unknown>} */ ({});
        let requiredFieldList = /** @type {unknown[]} */ ([]);

        //Reading object fields only after their schema containers are verified.
        if (objectRecordCheck(schemaRecord.properties)) {
            propertyData = /** @type {Record<string, unknown>} */ (schemaRecord.properties);

        }

        if (Array.isArray(schemaRecord.required)) {
            requiredFieldList = schemaRecord.required;

        }

        const requiredNames = new Set(requiredFieldList);
        const propertySources = /** @type {string[]} */ (Object.entries(propertyData).sort(function propertyNameSort(firstEntry, secondEntry) {
            //Keeping generated declaration fields deterministic.
            return firstEntry[0].localeCompare(secondEntry[0]);

        }).map(function propertyTypeCreate([propertyName, propertySchema]) {
            //Marking each generated property from the schema's required set.
            let optionalMarker = '?';

            if (requiredNames.has(propertyName)) {
                optionalMarker = '';

            }

            return `readonly ${JSON.stringify(propertyName)}${optionalMarker}: ${schemaTypeSourceCreate(
                propertySchema,
                depthData + 1
            )};`;

        }));

        if (schemaRecord.additionalProperties !== false) {
            let additionalType = 'unknown';

            if (objectRecordCheck(schemaRecord.additionalProperties) || typeof schemaRecord.additionalProperties === 'boolean') {
                additionalType = schemaTypeSourceCreate(schemaRecord.additionalProperties, depthData + 1);

            }

            propertySources.push(`readonly [fieldName: string]: ${additionalType};`);

        }

        if (propertySources.length === 0) {
            return 'Readonly<Record<string, never>>';

        }

        return `Readonly<{ ${propertySources.join(' ')} }>`;

    }

    const scalarTypeMap = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
        boolean: 'boolean',
        integer: 'number',
        null: 'null',
        number: 'number',
        string: 'string'
    }));

    if (typeof schemaRecord.type === 'string' && Object.hasOwn(scalarTypeMap, schemaRecord.type)) {
        return scalarTypeMap[schemaRecord.type] ?? 'unknown';

    }

    return 'unknown';

}

/**
 * @param {string} operationName
 * @param {string} operationType
 */
function operationExportNameCreate(operationName, operationType) {
    //Converting dotted protocol names into stable JavaScript identifiers.
    const operationParts = operationName.split('.');
    let exportName = operationParts[0] ?? 'operation';

    for (const operationPart of operationParts.slice(1)) {
        exportName += operationPart.charAt(0).toUpperCase() + operationPart.slice(1);

    }

    if (operationType === 'query') {
        return `${exportName}QueryCreate`;

    }

    if (operationType === 'command') {
        return `${exportName}CommandCreate`;

    }

    //Avoiding a duplicated suffix for conventional operation names ending in .sync.
    if (exportName.endsWith('Sync')) {
        return exportName;

    }

    return `${exportName}Sync`;

}

/**
 * @param {string} exportName
 */
function operationTypeNameCreate(exportName) {
    //Creating a stable PascalCase prefix from the generated callable name.
    return exportName.charAt(0).toUpperCase() + exportName.slice(1).replace(/(?:QueryCreate|CommandCreate|Sync)$/, '');

}

/**
 * @param {Readonly<Record<string, unknown>>} operationData
 */
function operationFunctionSourceCreate(operationData) {
    //Selecting the runtime call shape from the validated operation kind.
    const operationName = String(operationData.name);
    const operationType = String(operationData.type);
    const exportName = operationExportNameCreate(operationName, operationType);

    if (operationType === 'query' || operationType === 'command') {
        return `export function ${exportName}(contextData, operationOptions = {}) {
    const apiData = __layerOperationApiRead(contextData);

    return apiData.${operationType}({
        ...operationOptions,
        operation: ${JSON.stringify(operationName)}
    });
}`;

    }

    return `export function ${exportName}(contextData, payloadData = {}, syncOptions = {}) {
    const apiData = __layerOperationApiRead(contextData);

    return apiData.sync(${JSON.stringify(operationName)}, payloadData, syncOptions);
}`;

}

/**
 * @param {Readonly<Record<string, unknown>>} operationData
 */
function operationDeclarationSourceCreate(operationData) {
    const operationName = String(operationData.name);
    const operationType = String(operationData.type);
    const exportName = operationExportNameCreate(operationName, operationType);
    const typeName = operationTypeNameCreate(exportName);
    let inputSchema = operationData.inputSchema;

    //Removing protocol-owned commandId from the author payload type.
    if (operationType === 'command' && objectRecordCheck(inputSchema)) {
        const inputSchemaRecord = /** @type {Record<string, unknown>} */ (structuredClone(inputSchema));

        if (objectRecordCheck(inputSchemaRecord.properties)) {
            const propertyData = /** @type {Record<string, unknown>} */ (inputSchemaRecord.properties);

            delete propertyData.commandId;

        }

        if (Array.isArray(inputSchemaRecord.required)) {
            inputSchemaRecord.required = inputSchemaRecord.required.filter(function engineFieldRemove(fieldName) {
                //Keeping only fields supplied by application code.
                return fieldName !== 'commandId';

            });

        }

        inputSchema = inputSchemaRecord;

    }

    const inputType = schemaTypeSourceCreate(inputSchema);
    const outputType = schemaTypeSourceCreate(operationData.outputSchema);
    const typeSources = [
        `export type ${typeName}Input = ${inputType};`,
        `export type ${typeName}Output = ${outputType};`
    ];

    if (operationType === 'query') {
        typeSources.push(
            `/** Creates a reactive query handle for ${operationName}. Configure payload, cache, offline policy, and timeout once; call refresh for an explicit network attempt and dispose when the component owner is destroyed. */`,
            `export declare function ${exportName}(contextData: LayerGeneratedOperationContext, operationOptions?: LayerGeneratedQueryOptions<${typeName}Input>): LayerGeneratedQueryHandle<${typeName}Output>;`
        );

    } else if (operationType === 'command') {
        typeSources.push(
            `/** Creates an executable command handle for ${operationName}. Pass payload to execute; offline and optimistic policies are declared when the handle is created. */`,
            `export declare function ${exportName}(contextData: LayerGeneratedOperationContext, operationOptions?: LayerGeneratedCommandOptions<${typeName}Input, ${typeName}Output>): LayerGeneratedCommandHandle<${typeName}Input, ${typeName}Output>;`
        );

    } else {
        typeSources.push(
            `/** Runs the ${operationName} synchronization operation once. The optional cursor resumes an interrupted sequence and timeoutMs bounds the request. */`,
            `export declare function ${exportName}(contextData: LayerGeneratedOperationContext, payloadData?: ${typeName}Input, syncOptions?: LayerGeneratedSyncOptions): Promise<${typeName}Output>;`
        );

    }

    return typeSources.join('\n');

}

const declarationPrelude = `/** Read-only reactive value exposed by a generated operation handle. */
export interface LayerGeneratedReadonlySignal<ValueData> {
    /** Reads the current value and registers a reactive dependency. */
    get(): ValueData;
    /** Reads the current value without registering a reactive dependency. */
    peek(): ValueData;
}

/** Options captured by a generated query handle. */
export interface LayerGeneratedQueryOptions<PayloadData> {
    /** Static payload or a callback re-evaluated before every request. Default: empty object. */
    readonly payload?: PayloadData | (() => PayloadData);
    /** Persistent query-cache policy such as ttlMs and staleWhileRevalidateMs. */
    readonly cache?: Readonly<Record<string, unknown>>;
    /** Explicit offline read policy and fallback behavior. */
    readonly offline?: Readonly<Record<string, unknown>>;
    /** Request timeout in milliseconds; operation/server limits may reduce it. */
    readonly timeoutMs?: number;
}

/** Options captured by a generated command handle. */
export interface LayerGeneratedCommandOptions<PayloadData, ResultData> {
    /** Durable outbox/replay policy for commands allowed to run offline. */
    readonly offline?: Readonly<Record<string, unknown>>;
    /** Optional cache projection applied immediately and rolled back on failure. */
    readonly optimistic?: Readonly<{
        /** Produces the optimistic cache value before transport starts. */
        apply(payloadData: PayloadData, cacheData: unknown): unknown | Promise<unknown>;
        /** Reverts application-owned effects after a rejected command. */
        rollback(errorData: unknown, cacheData: unknown, optimisticData: unknown): void | Promise<void>;
    }>;
    /** Request timeout in milliseconds; operation/server limits may reduce it. */
    readonly timeoutMs?: number;
}

/** Options for a one-shot generated synchronization request. */
export interface LayerGeneratedSyncOptions {
    /** Opaque server cursor returned by the previous successful sync. */
    readonly cursor?: unknown;
    /** Request timeout in milliseconds. */
    readonly timeoutMs?: number;
}

/** Reactive query state and lifecycle owned by one component instance. */
export interface LayerGeneratedQueryHandle<ResultData> {
    /** Latest validated result, or null before the first success. */
    readonly data: LayerGeneratedReadonlySignal<ResultData | null>;
    /** True while a request is active. */
    readonly pending: LayerGeneratedReadonlySignal<boolean>;
    /** Latest safe request error, or null. */
    readonly error: LayerGeneratedReadonlySignal<unknown>;
    /** Epoch milliseconds of the latest result, or null. */
    readonly updatedAt: LayerGeneratedReadonlySignal<number | null>;
    /** True when cached data is usable but older than its fresh policy. */
    readonly stale: LayerGeneratedReadonlySignal<boolean>;
    /** loading, success, error, cancelled, or disposed lifecycle state. */
    readonly status: LayerGeneratedReadonlySignal<string>;
    /** Current data source, for example network or cache. */
    readonly source: LayerGeneratedReadonlySignal<string>;
    /** Performs a new request using the current payload callback. */
    refresh(optionsData?: Readonly<Record<string, unknown>>): Promise<ResultData>;
    /** Cancels the active request and reports whether cancellation occurred. */
    cancel(): boolean;
    /** Replaces cached query data through the safe application cache facade. */
    cacheUpdate(updateData: unknown): Promise<unknown>;
    /** Inserts one application value into supported cached list shapes. */
    cacheInsert(valueData: unknown): Promise<unknown>;
    /** Removes cached items matching an application-owned predicate/descriptor. */
    cacheRemove(predicateData: unknown): Promise<unknown>;
    /** Resolves with the current request result or rejects with its safe error. */
    settled(): Promise<ResultData>;
    /** Cancels work, detaches listeners, and reports whether disposal occurred. */
    dispose(): boolean;
}

/** Executable command state and lifecycle owned by one component instance. */
export interface LayerGeneratedCommandHandle<PayloadData, ResultData> {
    /** True while command transport/outbox processing is active. */
    readonly pending: LayerGeneratedReadonlySignal<boolean>;
    /** Latest safe command error, or null. */
    readonly error: LayerGeneratedReadonlySignal<unknown>;
    /** Latest validated successful result, or null. */
    readonly lastResult: LayerGeneratedReadonlySignal<ResultData | null>;
    /** Stable idempotency identifier for the current command, or null. */
    readonly commandId: LayerGeneratedReadonlySignal<string | null>;
    /** idle, pending, success, error, cancelled, or disposed lifecycle state. */
    readonly state: LayerGeneratedReadonlySignal<string>;
    /** Validates and executes one command payload. Revision fields enable conflict detection. */
    execute(payloadData: PayloadData, optionsData?: Readonly<{
        /** Entity revision observed before the local edit. */
        baseRevision?: number;
        /** Application conflict domain used by its declared merge policy. */
        conflictDomain?: string;
        /** Serializable optimistic patch stored with a durable outbox command. */
        optimisticPatch?: Readonly<Record<string, unknown>> | null;
    }>): Promise<ResultData>;
    /** Cancels the active online request when cancellation is still possible. */
    cancel(): boolean;
    /** Resolves with the current command result or rejects with its safe error. */
    settled(): Promise<ResultData>;
    /** Cancels work, detaches listeners, and reports whether disposal occurred. */
    dispose(): boolean;
}

/** Low-level application API supplied by Layer component context. Prefer generated operation functions. */
export interface LayerGeneratedOperationApi {
    query(optionsData: Readonly<Record<string, unknown>>): unknown;
    command(optionsData: Readonly<Record<string, unknown>>): unknown;
    sync(operationName: string, payloadData: unknown, optionsData?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** Minimum component context accepted by generated operation functions. */
export interface LayerGeneratedOperationContext {
    readonly api: LayerGeneratedOperationApi;
}
`;

/**
 * Generates one runtime module and one declaration module from validated schemas.
 *
 * @param {readonly Readonly<Record<string, unknown>>[]} operationList
 */
export function layerOperationFacadeCreate(operationList) {
    //Rejecting foreign collection shapes before generating any source text.
    if (!Array.isArray(operationList)) {
        throw new LayerCliError('CLI_OPERATION_CONTRACT_INVALID', 'Operation contracts must be an array.');

    }

    const exportNames = new Set();
    const runtimeSources = [];
    const declarationSources = [];

    for (const operationData of operationList) {
        //Generating runtime and declaration entries from the same contract record.
        const operationName = String(operationData.name);
        const operationType = String(operationData.type);
        const exportName = operationExportNameCreate(operationName, operationType);

        if (exportNames.has(exportName)) {
            throw new LayerCliError('CLI_OPERATION_EXPORT_COLLISION', 'Operation names produce the same generated export.', {
                exportName,
                operation: operationName
            });

        }

        exportNames.add(exportName);
        runtimeSources.push(operationFunctionSourceCreate(operationData));
        declarationSources.push(operationDeclarationSourceCreate(operationData));

    }

    const manifestSource = `${JSON.stringify(operationList, null, 4)}\n`;
    const runtimeSource = `const operationContracts = Object.freeze(${JSON.stringify(operationList, null, 4)});

function __layerOperationApiRead(contextData) {
    if (!contextData || typeof contextData !== 'object' || !contextData.api ||
        typeof contextData.api.query !== 'function' ||
        typeof contextData.api.command !== 'function' ||
        typeof contextData.api.sync !== 'function') {
        throw new TypeError('A generated Layer operation requires component context.api.');
    }

    return contextData.api;
}

export {operationContracts};

${runtimeSources.join('\n\n')}
`;
    const declarationSource = `${declarationPrelude}
export declare const operationContracts: readonly Readonly<Record<string, unknown>>[];

${declarationSources.join('\n\n')}
`;

    return Object.freeze({
        declarationSource,
        manifestSource,
        runtimeSource
    });

}
