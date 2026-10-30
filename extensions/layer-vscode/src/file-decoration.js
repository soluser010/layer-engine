'use strict';

/**
 * @param {string} filePath
 */
function layerFileDecorationDataCreate(filePath) {
    if (!String(filePath).toLowerCase().endsWith('.layer.js')) {
        return null;

    }

    //Identifying Layer components without replacing the developer's active file icon theme.
    return Object.freeze({
        badge: 'L',
        tooltip: 'Layer component'
    });

}

module.exports = {
    layerFileDecorationDataCreate
};
