/** @param {IDBFactory | undefined} indexedDbData @param {string} applicationData */
export function layerPushReceiptsCreate( indexedDbData, applicationData ){
    const memoryReceiptsData = new Map();

    /** @param {string} notificationIdData @param {boolean} removeData */
    const receiptUpdateData = async function( notificationIdData, removeData ){
        //Keeping a bounded fallback when IndexedDB is unavailable or blocked by browser policy
        if ( indexedDbData === undefined ){
            //Applying the same receipt lifetime in browsers without persistent storage
            for ( const [receiptIdData, receiptTimeData] of memoryReceiptsData ){
                if ( receiptTimeData <= Date.now() - 86400000 ){
                    memoryReceiptsData.delete( receiptIdData );

                }

            }

            if ( removeData ){
                memoryReceiptsData.delete( notificationIdData );

                return false;

            }

            if ( memoryReceiptsData.has( notificationIdData ) ){
                return false;

            }

            memoryReceiptsData.set( notificationIdData, Date.now() );

            if ( memoryReceiptsData.size > 256 ){
                memoryReceiptsData.delete( memoryReceiptsData.keys().next().value );

            }

            return true;

        }

        return new Promise(function receiptWait( resolve, rejected ){
            const openRequestData = indexedDbData.open( `layer:${applicationData}:push-receipts`, 1 );
            openRequestData.onupgradeneeded = function receiptsStoreCreate(){
                //Creating one dedicated receipt store separate from application content
                openRequestData.result.createObjectStore( 'receipts', {keyPath: 'id'} );

            };
            openRequestData.onerror = function receiptsOpenError(){
                //Passing a bounded storage failure without IndexedDB internals
                rejected( new Error( 'PWA_PUSH_STORAGE_UNAVAILABLE' ) );

            };
            openRequestData.onblocked = function receiptsOpenBlocked(){
                //Failing explicitly instead of holding the push event indefinitely
                rejected( new Error( 'PWA_PUSH_STORAGE_UNAVAILABLE' ) );

            };
            openRequestData.onsuccess = function receiptsOpenComplete(){
                const databaseData = openRequestData.result;
                const transactionData = databaseData.transaction( 'receipts', 'readwrite' );
                const storeData = transactionData.objectStore( 'receipts' );
                const receiptsRequestData = storeData.getAll();
                let claimedData = false;

                receiptsRequestData.onsuccess = function receiptsPrune(){
                    const nowData = Date.now();
                    const receiptsData = receiptsRequestData.result.sort(function receiptOrder( leftData, rightData ){
                        //Retaining the most recent bounded notification receipt history
                        return rightData.time - leftData.time;

                    });
                    const priorData = receiptsData.find(function receiptFind( receiptData ){
                        //Recognizing only an unexpired notification receipt
                        return receiptData.id === notificationIdData && receiptData.time > nowData - 86400000;

                    });

                    //Pruning expired and excess IDs in the same serialized transaction as the claim
                    for ( const [indexData, receiptData] of receiptsData.entries() ){
                        if ( receiptData.time <= nowData - 86400000 || indexData >= 255 || (removeData && receiptData.id === notificationIdData) ){
                            storeData.delete( receiptData.id );

                        }

                    }

                    if ( !removeData && priorData === undefined ){
                        storeData.put({id: notificationIdData, time: nowData});
                        claimedData = true;

                    }

                };
                transactionData.oncomplete = function receiptsComplete(){
                    //Closing the storage connection only after the dedup claim is durable
                    databaseData.close();
                    resolve( claimedData );

                };
                transactionData.onabort = function receiptsAbort(){
                    //Closing failed transactions and reporting a bounded error
                    databaseData.close();
                    rejected( new Error( 'PWA_PUSH_STORAGE_UNAVAILABLE' ) );

                };

            };

        });

    };

    return Object.freeze({
        /** @param {string} notificationIdData */
        claim( notificationIdData ){
            //Claiming one notification ID before attempting browser display
            return receiptUpdateData( notificationIdData, false );

        },
        /** @param {string} notificationIdData */
        forget( notificationIdData ){
            //Releasing the receipt when the browser rejected display
            return receiptUpdateData( notificationIdData, true );

        }
    });

}
