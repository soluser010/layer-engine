/**
 * @param {object} parserOptions
 * @param {(eventData: Readonly<{id: string, event: string, data: string}>) => void | Promise<void>} parserOptions.eventHandle
 * @param {(commentData: string) => void | Promise<void>} [parserOptions.commentHandle]
 * @param {number} [parserOptions.maximumBufferBytes]
 */
export function layerEventStreamParserCreate(parserOptions) {
    const maximumBufferBytes = parserOptions.maximumBufferBytes ?? 1048576;
    let inputBuffer = '';
    let eventIdentifier = '';
    let eventName = 'message';
    let eventDataLines = /** @type {string[]} */ ([]);

    async function eventDispatch() {
        //Ignoring empty records such as a heartbeat-only separator.
        if (eventDataLines.length === 0) {
            eventIdentifier = '';
            eventName = 'message';

            return;

        }

        const eventData = Object.freeze({
            id: eventIdentifier,
            event: eventName,
            data: eventDataLines.join('\n')
        });

        eventIdentifier = '';
        eventName = 'message';
        eventDataLines = [];
        await parserOptions.eventHandle(eventData);

    }

    /**
     * @param {string} lineData
     */
    async function lineProcess(lineData) {
        if (lineData.length === 0) {
            await eventDispatch();

            return;

        }

        if (lineData.startsWith(':')) {
            await parserOptions.commentHandle?.(lineData.slice(1).trimStart());

            return;

        }

        const separatorIndex = lineData.indexOf(':');
        let fieldName = lineData;
        let fieldValue = '';

        //Splitting the first colon according to the SSE field grammar.
        if (separatorIndex >= 0) {
            fieldName = lineData.slice(0, separatorIndex);
            fieldValue = lineData.slice(separatorIndex + 1);

            if (fieldValue.startsWith(' ')) {
                fieldValue = fieldValue.slice(1);

            }

        }

        if (fieldName === 'id' && !fieldValue.includes('\u0000')) {
            eventIdentifier = fieldValue;

        } else if (fieldName === 'event') {
            eventName = fieldValue;

        } else if (fieldName === 'data') {
            eventDataLines.push(fieldValue);

        }

    }

    return Object.freeze({
        /**
         * @param {string} chunkData
         */
        async feed(chunkData) {
            inputBuffer += chunkData;

            //Bounding unframed server data before searching for line endings.
            if (new TextEncoder().encode(inputBuffer).byteLength > maximumBufferBytes) {
                throw new RangeError('The event stream frame exceeds the buffer limit.');

            }

            let newlineIndex = inputBuffer.indexOf('\n');

            while (newlineIndex >= 0) {
                let lineData = inputBuffer.slice(0, newlineIndex);
                inputBuffer = inputBuffer.slice(newlineIndex + 1);

                if (lineData.endsWith('\r')) {
                    lineData = lineData.slice(0, -1);

                }

                await lineProcess(lineData);
                newlineIndex = inputBuffer.indexOf('\n');

            }

        },

        async finish() {
            //Processing one final unterminated line, then dispatching its record.
            if (inputBuffer.length > 0) {
                await lineProcess(inputBuffer);
                inputBuffer = '';

            }

            await eventDispatch();

        }
    });

}
