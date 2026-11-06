import {css, html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({render: 'csr', layout: 'offline', auth: 'none', offline: 'shell', cache: 'public'});
export const styles = css`
    h1 { padding-left: 37px; }
`;

export default layerComponentCreate(function(){
    //Expose the cached destination through its rendered heading and computed style.
    return html`<h1>Offline styles</h1>`;

});
