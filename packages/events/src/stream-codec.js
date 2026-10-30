/**
 * @param {{eventId: string, channel: string, sequence: number, entityRevision: number, type: string, payload: Record<string, unknown>, occurredAt: string}} eventData
 */
export function layerEventFrameCreate(eventData) {
    //Encoding one complete SSE record so proxies can flush it immediately.
    return `id: ${eventData.eventId}\nevent: layer.event\ndata: ${JSON.stringify(eventData)}\n\n`;

}

/**
 * @param {string} controlType
 * @param {Record<string, unknown>} controlData
 */
export function layerControlFrameCreate(controlType, controlData) {
    //Encoding runtime control state separately from immutable domain events.
    return `event: layer.control\ndata: ${JSON.stringify({
        type: controlType,
        ...controlData
    })}\n\n`;

}

/**
 * @param {Date} heartbeatTime
 */
export function layerHeartbeatFrameCreate(heartbeatTime) {
    //Using an SSE comment so heartbeat traffic does not enter application state.
    return `: heartbeat ${heartbeatTime.toISOString()}\n\n`;

}
