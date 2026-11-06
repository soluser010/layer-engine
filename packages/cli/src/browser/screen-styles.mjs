//Share a route stylesheet across pending navigations, visible links and retained screens.
export function screenStylesCreate(){
    const styles = new Map();

    function acquire( path, marker, existingLink ){
        let record = styles.get(path);
        if (!record){
            //Adopt the SSR stylesheet or load a disabled sheet without affecting the visible page.
            const link = existingLink ?? document.createElement('link');
            let settle;
            const ready = new Promise(function(resolve){
                //All owners wait for one load result, including failure or disposal.
                settle = resolve;

            });
            record = {link, ready, settle, owners: 0};
            styles.set(path, record);
            if (existingLink){
                settle(link);

            } else {
                link.rel = 'stylesheet';
                link.media = 'not all';
                link.href = '/' + path;
                link.setAttribute(marker, '');
                link.onload = function(){
                    //Keep this exact link attached so navigation can activate it synchronously.
                    link.onload = link.onerror = null;
                    settle(link);

                };
                link.onerror = function(){
                    //Drop the failed entry immediately so the next navigation can retry.
                    styles.delete(path);
                    link.onload = link.onerror = null;
                    link.remove();
                    settle(null);

                };
                document.head.append(link);

            }

        }
        record.owners++;
        let released = false;
        return {ready: record.ready, release(){
            //Another route or an in-flight click can still own this resource.
            if (released){
                return;

            }
            released = true;
            record.owners--;
            if (!record.owners && styles.get(path) === record){
                styles.delete(path);
                record.link.onload = record.link.onerror = null;
                record.link.remove();
                record.settle(null);

            }

        }};

    }

    return {acquire};

}
