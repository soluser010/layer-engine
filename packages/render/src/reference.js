/**
 * Create one renderer-owned DOM reference for a dynamic ref binding.
 *
 * @returns {{current: Element | null}}
 */
export function layerReferenceCreate() {
    //Sealing the stable reference identity while leaving its current node writable.
    return Object.seal({
        current: /** @type {Element | null} */ (null)
    });

}
