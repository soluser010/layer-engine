/**
 * @param {Record<string, string | string[] | undefined>} headersData
 * @param {string} headerName
 * @returns {string | undefined}
 */
export function layerHeaderValueGet(headersData, headerName) {
    let matchingHeaderName;

    //Getting the header value through a case-insensitive lookup.
    for (const candidateName of Object.keys(headersData)) {
        if (candidateName.toLowerCase() === headerName.toLowerCase()) {
            matchingHeaderName = candidateName;

            break;

        }

    }

    //Checking the header before normalizing its value.
    if (matchingHeaderName === undefined) {
        return undefined;

    }

    const headerValue = headersData[matchingHeaderName];

    //Rejecting ambiguous repeated security headers.
    if (Array.isArray(headerValue)) {
        return undefined;

    }

    return headerValue;

}

/**
 * @param {string | undefined} cookieHeader
 * @param {string} cookieName
 * @returns {string | undefined}
 */
export function layerCookieValueGet(cookieHeader, cookieName) {
    //Checking the cookie header before splitting untrusted input.
    if (cookieHeader === undefined || cookieHeader.length === 0) {
        return undefined;

    }

    const matchingValues = [];

    //Searching every cookie pair without decoding opaque identifiers.
    for (const cookiePart of cookieHeader.split(';')) {
        const separatorIndex = cookiePart.indexOf('=');

        //Skipping malformed cookie pairs.
        if (separatorIndex <= 0) {
            continue;

        }

        const candidateName = cookiePart.slice(0, separatorIndex).trim();

        //Checking the exact cookie name to avoid prefix confusion.
        if (candidateName !== cookieName) {
            continue;

        }

        matchingValues.push(cookiePart.slice(separatorIndex + 1).trim());

    }

    //Rejecting missing, empty, or duplicated session cookies.
    if (matchingValues.length !== 1 || matchingValues[0]?.length === 0) {
        return undefined;

    }

    return matchingValues[0];

}
