/** @param {any} client @param {{url: string, appKey: string|null, timeoutMs?: number}} options */
//Function for offering a notification URL to a running app before requesting native navigation
export const layerNavigationHandoff = function( client, options ){
    //Keeping legacy clients without messaging on their existing native fallback path
    if (typeof client.postMessage !== 'function' || typeof MessageChannel !== 'function' || options.appKey === null) {
        return Promise.resolve(false);

    }
    return new Promise(function( resolve ){
        //Binding the acknowledgement to one transferable channel rather than a shared broadcast
        const channel = new MessageChannel();
        let finished = false;
        const finish = function( /** @type {boolean} */ accepted ){
            //Settling late replies, timeout and delivery failures only once
            if (finished) {
                return;

            }
            finished = true;
            clearTimeout(timer);
            channel.port1.close();
            channel.port2.close();
            resolve(accepted);

        };
        const timer = setTimeout(function(){
            //Allowing an old or suspended app to recover through a native document load
            finish(false);

        }, options.timeoutMs ?? 2000);
        channel.port1.onmessage = function( event ){
            //Accepting only a matching app, protocol and target acknowledgement
            const data = event.data;
            finish(data?.type === 'layer-navigation-result' && data.protocol === 1 &&
                data.appKey === options.appKey && data.url === options.url && data.accepted === true);

        };
        try {
            client.postMessage({type: 'layer-navigation-open', protocol: 1,
                appKey: options.appKey, url: options.url}, [channel.port2]);

        } catch (closedClientError) {
            //Tolerating a window that closed after client enumeration
            void closedClientError;
            finish(false);

        }

    });

};
