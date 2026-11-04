export const onBeforeUpdate = function(){
    //Allowing browser gates to simulate application-owned unsaved state in either window
    return window.updateSaveAllowed !== false;

};


export const onReady = function(){
    //Testing the app hook failure boundary without changing production runtime behavior
    if ( new URLSearchParams( window.location.search ).has( 'startup-error' ) ){
        throw new Error( 'Private fixture startup detail' );

    }

};

//Allowing a fixture app to explicitly opt out without changing the generated registration owner
export const serviceWorker = !new URLSearchParams( globalThis.window?.location.search ?? '' ).has( 'no-sw' );
