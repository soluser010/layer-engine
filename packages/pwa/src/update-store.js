/** @param {IDBFactory | undefined} indexedDb @param {string} appKey */
//Function for retaining only public release bookkeeping outside application databases
export const layerUpdateStoreCreate = function( indexedDb, appKey ){
    //Opening lazily so browser capability failures remain explicit at the update boundary
    let databasePromise = /** @type {Promise<IDBDatabase> | null} */ (null);
    const databaseGet = function(){
        //Reusing a single database connection for the worker lifetime
        if (databasePromise !== null) {
            return databasePromise;

        }
        databasePromise = new Promise(function(resolve, rejected){
            //Failing closed rather than pretending a release marker was persisted
            if (!indexedDb) {
                rejected(new Error('Update metadata storage is unavailable.'));
                return;

            }
            const request = indexedDb.open('layer-pwa-updates-' + appKey, 1);
            request.onupgradeneeded = function(){
                //Separating release records from all user identities and outboxes
                request.result.createObjectStore('records');

            };
            request.onsuccess = function(){
                //Closing on a future version upgrade instead of pinning another installer
                request.result.onversionchange = function(){
                    //Releasing this idle metadata handle
                    request.result.close();
                    databasePromise = null;

                };
                resolve(request.result);

            };
            request.onerror = function(){
                //Propagating storage failure without private application data
                databasePromise = null;
                rejected(request.error);

            };
            request.onblocked = function(){
                //Reporting a blocked metadata upgrade instead of hanging update preparation
                rejected(new Error('Update metadata storage is blocked.'));

            };

        });
        return databasePromise;

    };
    /** @param {string} keyData @param {unknown} [valueData] @param {boolean} [writeStatus] */
    const transactionRun = async function( keyData, valueData, writeStatus = false ){
        //Waiting for committed writes before returning a complete-cache marker
        const database = await databaseGet();
        return new Promise(function(resolve, rejected){
            //Choosing a read-only transaction unless metadata is explicitly being persisted
            let transactionMode = /** @type {IDBTransactionMode} */ ('readonly');
            if (writeStatus) {
                transactionMode = 'readwrite';

            }
            const transaction = database.transaction('records', transactionMode);
            const store = transaction.objectStore('records');
            let request = store.get(keyData);
            if (writeStatus) {
                request = store.put(valueData, keyData);

            }
            let result = /** @type {any} */ (null);
            request.onsuccess = function(){
                //Retaining the request result until the enclosing transaction commits
                result = request.result ?? null;

            };
            transaction.oncomplete = function(){
                //Returning only committed metadata
                resolve(result);

            };
            transaction.onabort = transaction.onerror = function(){
                //Preserving persistence failures for the caller's safe error mapping
                rejected(transaction.error ?? new Error('Update metadata transaction failed.'));

            };

        });

    };
    //CallBack THE OBJECT
    return Object.freeze({
        get: function(/** @type {string} */ keyData){
            //Reading only this application's public release metadata
            return transactionRun(keyData);

        },
        put: function(/** @type {string} */ keyData, /** @type {unknown} */ valueData){
            //Committing one release or client marker atomically
            return transactionRun(keyData, valueData, true);

        }
    });

};
