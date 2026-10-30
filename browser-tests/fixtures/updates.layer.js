import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({render: 'csr', auth: 'none', offline: 'shell', cache: 'public'});

export default layerComponentCreate(function UpdateFixture(){
    //Keeping an ordinary input mounted throughout update preparation and dismissal
    return html`<main><h1>Update edition __EDITION__</h1><input aria-label="Draft" value=""></main>`;

});
