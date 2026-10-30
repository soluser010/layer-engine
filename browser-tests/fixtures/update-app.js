export const onBeforeUpdate = function(){
    //Allowing browser gates to simulate application-owned unsaved state in either window
    return window.updateSaveAllowed !== false;

};
