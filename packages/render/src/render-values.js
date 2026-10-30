const urlAttributeSet = new Set([
    'action',
    'formaction',
    'href',
    'poster',
    'src'
]);

/**
 * @param {unknown} textValue
 * @returns {string}
 */
export function layerTextValueNormalize(textValue) {
    //Rendering absent values as empty text while preserving other scalar output.
    if (textValue === null || textValue === undefined) {
        return '';

    }

    return String(textValue);

}

/**
 * @param {string} textValue
 * @returns {string}
 */
export function layerHtmlTextEscape(textValue) {
    //Escaping characters with meaning in HTML text nodes.
    return textValue
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

}

/**
 * @param {string} attributeValue
 * @returns {string}
 */
export function layerHtmlAttributeEscape(attributeValue) {
    //Escaping characters with meaning in quoted HTML attributes.
    return layerHtmlTextEscape(attributeValue).replaceAll('"', '&quot;');

}

/**
 * @param {string} attributeName
 * @param {unknown} attributeValue
 * @returns {string | null}
 */
export function layerAttributeValueNormalize(attributeName, attributeValue) {
    //Removing false and absent bindings rather than serializing misleading text.
    if (attributeValue === false || attributeValue === null || attributeValue === undefined) {
        return null;

    }

    if (attributeValue === true) {
        return '';

    }

    const normalizedValue = String(attributeValue);

    //Applying an explicit protocol policy to URL-bearing attributes.
    if (urlAttributeSet.has(attributeName.toLowerCase())) {
        let compactValue = '';

        //Removing ASCII control and spacing characters before scheme inspection.
        for (const characterData of normalizedValue.trim()) {
            if (characterData.charCodeAt(0) > 32) {
                compactValue += characterData;

            }

        }

        const schemeMatch = compactValue.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);

        if (schemeMatch !== null &&
            !['http', 'https', 'mailto', 'tel'].includes((schemeMatch[1] ?? '').toLowerCase())) {
            return null;

        }

    }

    return normalizedValue;

}
