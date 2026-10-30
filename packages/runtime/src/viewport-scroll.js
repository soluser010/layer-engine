/**
 * @typedef {Readonly<{region: HTMLElement, anchor: Element | null, offset: number,
 *     left: number, top: number}>} LayerScrollAnchor
 */

//Function for retaining an item-relative position in a scroll region
/** @param {HTMLElement} regionNode @param {Element | null} [anchorNode] @returns {LayerScrollAnchor} */
export const layerScrollAnchorCapture = function( regionNode, anchorNode = null ){
    //Checking ownership before storing a reference to the visible item
    if ( anchorNode !== null && !regionNode.contains( anchorNode ) ){
        throw new TypeError( 'The scroll anchor must belong to its region.' );

    }

    //Recording an explicit anchor or the first keyed item intersecting the region
    if ( anchorNode === null ){
        const regionTop = regionNode.getBoundingClientRect().top;
        for ( const itemNode of regionNode.querySelectorAll( '[data-layer-scroll-key]' ) ){
            if ( itemNode.getBoundingClientRect().bottom > regionTop ){
                anchorNode = itemNode;
                break;

            }

        }

    }

    let anchorOffset = 0;
    if ( anchorNode !== null ){
        anchorOffset = anchorNode.getBoundingClientRect().top - regionNode.getBoundingClientRect().top;

    }

    //CallBack THE OBJECT
    return Object.freeze({
        region: regionNode,
        anchor: anchorNode,
        offset: anchorOffset,
        left: regionNode.scrollLeft,
        top: regionNode.scrollTop
    });

};

//Function for restoring an anchor without replacing keyed message nodes
/** @param {LayerScrollAnchor} anchorData @returns {boolean} */
export const layerScrollAnchorRestore = function( anchorData ){
    //Rejecting references released by navigation or component disposal
    const regionNode = anchorData.region;
    if ( !regionNode.isConnected ){
        return false;

    }

    //Restoring the relative position when the original item still belongs to this list
    if ( anchorData.anchor !== null && regionNode.contains( anchorData.anchor ) ){
        const currentOffset = anchorData.anchor.getBoundingClientRect().top - regionNode.getBoundingClientRect().top;
        regionNode.scrollTop += currentOffset - anchorData.offset;

    } else {
        //Falling back to the numeric position when the item was removed intentionally
        regionNode.scrollTop = anchorData.top;

    }

    regionNode.scrollLeft = anchorData.left;
    return true;

};
