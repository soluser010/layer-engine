import {
    layerDomainEventSchema,
    layerErrorResponseSchema,
    layerRequestEnvelopeSchema,
    layerSuccessResponseSchema
} from './schemas.js';

const uuidPattern = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(z|([+-])(\d{2})(?::?(\d{2}))?)$/i;
const dateTimeSeparatorPattern = /t/i;
const patternCache = new Map();

/**
 * @typedef {{valid: true, errors: readonly []} | {valid: false, errors: readonly LayerValidationIssue[]}} LayerValidationResult
 * @typedef {object} LayerValidationIssue
 * @property {string} instancePath
 * @property {string} keyword
 * @property {string} message
 * @property {string} schemaPath
 */

/**
 * @param {number} yearData
 */
function leapYearCheck(yearData) {
    //Checking the Gregorian leap-year rules used by RFC 3339 dates.
    return yearData % 4 === 0 && (yearData % 100 !== 0 || yearData % 400 === 0);

}

/**
 * @param {string} dateData
 */
function dateCheck(dateData) {
    //Separating the declared calendar fields before checking their ranges.
    const dateMatch = datePattern.exec(dateData);

    if (dateMatch === null) {
        return false;

    }

    const yearData = Number(dateMatch[1]);
    const monthData = Number(dateMatch[2]);
    const dayData = Number(dateMatch[3]);
    let februaryDays = 28;

    //Selecting the leap-year length for February.
    if (leapYearCheck(yearData)) {
        februaryDays = 29;

    }

    const monthDays = [
        0,
        31,
        februaryDays,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31
    ];

    //Checking the month before reading its maximum day.
    if (monthData < 1 || monthData > 12) {
        return false;

    }

    return dayData >= 1 && dayData <= /** @type {number} */ (monthDays[monthData]);

}

/**
 * @param {string} timeData
 */
function timeCheck(timeData) {
    //Separating the clock and required timezone fields.
    const timeMatch = timePattern.exec(timeData);

    if (timeMatch === null) {
        return false;

    }

    const hourData = Number(timeMatch[1]);
    const minuteData = Number(timeMatch[2]);
    const secondData = Number(timeMatch[3]);
    let timezoneSign = 1;
    const timezoneHour = Number(timeMatch[6] ?? 0);
    const timezoneMinute = Number(timeMatch[7] ?? 0);

    //Selecting the direction of the declared timezone offset.
    if (timeMatch[5] === '-') {
        timezoneSign = -1;

    }

    if (timezoneHour > 23 || timezoneMinute > 59) {
        return false;

    }

    if (hourData <= 23 && minuteData <= 59 && secondData < 60) {
        return true;

    }

    //Allowing the RFC 3339 leap second only at the adjusted final UTC minute.
    const utcMinute = minuteData - timezoneMinute * timezoneSign;
    let utcHourAdjustment = 0;

    //Carrying a negative adjusted minute into the previous UTC hour.
    if (utcMinute < 0) {
        utcHourAdjustment = 1;

    }

    const utcHour = hourData - timezoneHour * timezoneSign - utcHourAdjustment;

    return (utcHour === 23 || utcHour === -1) &&
        (utcMinute === 59 || utcMinute === -1) &&
        secondData < 61;

}

/**
 * @param {string} dateTimeData
 */
function dateTimeCheck(dateTimeData) {
    //Checking one strict RFC 3339 date and time pair.
    const dateTimeParts = dateTimeData.split(dateTimeSeparatorPattern);

    return dateTimeParts.length === 2 &&
        dateCheck(/** @type {string} */ (dateTimeParts[0])) &&
        timeCheck(/** @type {string} */ (dateTimeParts[1]));

}

/**
 * @param {unknown} inputData
 * @param {string} typeData
 */
function schemaTypeCheck(inputData, typeData) {
    //Checking the JSON Schema primitive without coercing caller-owned data.
    if (typeData === 'object') {
        return inputData !== null && typeof inputData === 'object' && !Array.isArray(inputData);

    }

    if (typeData === 'integer') {
        return typeof inputData === 'number' && Number.isInteger(inputData) && Number.isFinite(inputData);

    }

    if (typeData === 'null') {
        return inputData === null;

    }

    return typeof inputData === typeData;

}

/**
 * @param {LayerValidationIssue[]} validationIssues
 * @param {string} instancePath
 * @param {string} schemaPath
 * @param {string} keywordData
 * @param {string} messageData
 */
function validationIssueAdd(validationIssues, instancePath, schemaPath, keywordData, messageData) {
    //Recording only stable public diagnostics without exposing executable validator state.
    validationIssues.push({
        instancePath,
        keyword: keywordData,
        message: messageData,
        schemaPath
    });

}

/**
 * @param {Readonly<Record<string, any>>} schemaData
 * @param {unknown} inputData
 * @param {string} instancePath
 * @param {string} schemaPath
 * @param {LayerValidationIssue[]} validationIssues
 */
function schemaNodeValidate(schemaData, inputData, instancePath, schemaPath, validationIssues) {
    if (Array.isArray(schemaData.anyOf)) {
        //Checking alternatives independently so failed branches do not leak their diagnostics.
        const alternativeStatus = schemaData.anyOf.some(function schemaAlternativeCheck(alternativeSchema, alternativeIndex) {
            //Creating isolated diagnostics for the current alternative.
            const alternativeIssues = /** @type {LayerValidationIssue[]} */ ([]);

            schemaNodeValidate(
                alternativeSchema,
                inputData,
                instancePath,
                `${schemaPath}/anyOf/${alternativeIndex}`,
                alternativeIssues
            );

            //CallBack THE BOOLEAN
            return alternativeIssues.length === 0;

        });

        if (!alternativeStatus) {
            validationIssueAdd(validationIssues, instancePath, `${schemaPath}/anyOf`, 'anyOf', 'Value does not match an allowed schema.');

        }

        return;

    }

    if (schemaData.type !== undefined && !schemaTypeCheck(inputData, schemaData.type)) {
        validationIssueAdd(validationIssues, instancePath, `${schemaPath}/type`, 'type', `Value must be ${schemaData.type}.`);

        return;

    }

    if (schemaData.const !== undefined && !Object.is(inputData, schemaData.const)) {
        validationIssueAdd(validationIssues, instancePath, `${schemaPath}/const`, 'const', 'Value must equal the protocol constant.');

    }

    if (Array.isArray(schemaData.enum) && !schemaData.enum.includes(inputData)) {
        validationIssueAdd(validationIssues, instancePath, `${schemaPath}/enum`, 'enum', 'Value is not in the allowed set.');

    }

    if (typeof inputData === 'string') {
        const characterLength = [...inputData].length;

        if (schemaData.minLength !== undefined && characterLength < schemaData.minLength) {
            validationIssueAdd(validationIssues, instancePath, `${schemaPath}/minLength`, 'minLength', 'String is shorter than allowed.');

        }

        if (schemaData.maxLength !== undefined && characterLength > schemaData.maxLength) {
            validationIssueAdd(validationIssues, instancePath, `${schemaPath}/maxLength`, 'maxLength', 'String is longer than allowed.');

        }

        if (typeof schemaData.pattern === 'string') {
            //Reusing compiled regular expressions from trusted engine-owned schemas.
            let patternData = patternCache.get(schemaData.pattern);

            if (patternData === undefined) {
                patternData = new RegExp(schemaData.pattern, 'u');
                patternCache.set(schemaData.pattern, patternData);

            }

            if (!patternData.test(inputData)) {
                validationIssueAdd(validationIssues, instancePath, `${schemaPath}/pattern`, 'pattern', 'String does not match the required pattern.');

            }

        }

        if (schemaData.format === 'uuid' && !uuidPattern.test(inputData)) {
            validationIssueAdd(validationIssues, instancePath, `${schemaPath}/format`, 'format', 'String must be a UUID.');

        }

        if (schemaData.format === 'date-time' && !dateTimeCheck(inputData)) {
            validationIssueAdd(validationIssues, instancePath, `${schemaPath}/format`, 'format', 'String must be an RFC 3339 date-time.');

        }

    }

    if (typeof inputData === 'number' && schemaData.minimum !== undefined && inputData < schemaData.minimum) {
        validationIssueAdd(validationIssues, instancePath, `${schemaPath}/minimum`, 'minimum', 'Number is below the allowed minimum.');

    }

    if (inputData === null || typeof inputData !== 'object' || Array.isArray(inputData)) {
        return;

    }

    const objectData = /** @type {Record<string, unknown>} */ (inputData);
    const objectKeys = Object.keys(objectData);
    const propertySchemas = /** @type {Record<string, Readonly<Record<string, any>>>} */ (schemaData.properties ?? {});

    if (Array.isArray(schemaData.required)) {
        for (const requiredProperty of schemaData.required) {
            if (!Object.prototype.hasOwnProperty.call(objectData, requiredProperty)) {
                validationIssueAdd(validationIssues, instancePath, `${schemaPath}/required`, 'required', `Required property ${requiredProperty} is missing.`);

            }

        }

    }

    if (schemaData.maxProperties !== undefined && objectKeys.length > schemaData.maxProperties) {
        validationIssueAdd(validationIssues, instancePath, `${schemaPath}/maxProperties`, 'maxProperties', 'Object has too many properties.');

    }

    for (const propertyName of objectKeys) {
        const propertyPath = `${instancePath}/${propertyName.replaceAll('~', '~0').replaceAll('/', '~1')}`;

        if (schemaData.propertyNames !== undefined) {
            schemaNodeValidate(schemaData.propertyNames, propertyName, instancePath, `${schemaPath}/propertyNames`, validationIssues);

        }

        if (propertySchemas[propertyName] !== undefined) {
            schemaNodeValidate(
                propertySchemas[propertyName],
                objectData[propertyName],
                propertyPath,
                `${schemaPath}/properties/${propertyName}`,
                validationIssues
            );

        } else if (schemaData.additionalProperties === false) {
            validationIssueAdd(validationIssues, propertyPath, `${schemaPath}/additionalProperties`, 'additionalProperties', 'Additional property is not allowed.');

        } else if (schemaData.additionalProperties !== undefined && typeof schemaData.additionalProperties === 'object') {
            schemaNodeValidate(
                schemaData.additionalProperties,
                objectData[propertyName],
                propertyPath,
                `${schemaPath}/additionalProperties`,
                validationIssues
            );

        }

    }

    if (schemaData.dependentSchemas !== undefined) {
        for (const [propertyName, dependentSchema] of Object.entries(schemaData.dependentSchemas)) {
            if (Object.prototype.hasOwnProperty.call(objectData, propertyName)) {
                schemaNodeValidate(
                    /** @type {Readonly<Record<string, any>>} */ (dependentSchema),
                    objectData,
                    instancePath,
                    `${schemaPath}/dependentSchemas/${propertyName}`,
                    validationIssues
                );

            }

        }

    }

}

/**
 * @param {Readonly<Record<string, any>>} schemaData
 * @param {unknown} inputData
 * @returns {LayerValidationResult}
 */
function layerDataValidationResultCreate(schemaData, inputData) {
    const validationIssues = /** @type {LayerValidationIssue[]} */ ([]);

    //Validating directly from immutable protocol schemas without generated JavaScript.
    schemaNodeValidate(schemaData, inputData, '', '#', validationIssues);

    if (validationIssues.length === 0) {
        return {
            valid: true,
            errors: Object.freeze([])
        };

    }

    return {
        valid: false,
        errors: Object.freeze(validationIssues)
    };

}

export function layerProtocolDataValidatorCreate() {
    return Object.freeze({
        /**
         * @param {unknown} inputData
         */
        requestValidate(inputData) {
            //Validating one request against the immutable request envelope schema.
            return layerDataValidationResultCreate(layerRequestEnvelopeSchema, inputData);

        },

        /**
         * @param {unknown} inputData
         */
        successResponseValidate(inputData) {
            //Validating one successful response against its public envelope schema.
            return layerDataValidationResultCreate(layerSuccessResponseSchema, inputData);

        },

        /**
         * @param {unknown} inputData
         */
        errorResponseValidate(inputData) {
            //Validating one error response without exposing internal error state.
            return layerDataValidationResultCreate(layerErrorResponseSchema, inputData);

        },

        /**
         * @param {unknown} inputData
         */
        eventValidate(inputData) {
            //Validating one ordered domain event against its public schema.
            return layerDataValidationResultCreate(layerDomainEventSchema, inputData);

        }
    });

}
