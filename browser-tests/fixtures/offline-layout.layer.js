import {css, html, layerComponentCreate} from '@solcorp/layer';

export const styles = css`
    header { padding-right: 23px; }
`;

export default layerComponentCreate(function(){
    //Use a distinct layout stylesheet to exercise both route resources offline.
    return html`<main><header>Offline layout</header><div data-layer-layout-outlet></div></main>`;

});
