import {css, html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({render: 'csr', auth: 'none'});
export const styles = css`
    /* Exercising prefixing and nested selector lowering without changing app structure */
    .css-example {
        user-select: none;
        & > .css-child {
            padding: 0px 0px 0px 0px;
            width: calc(10px * 2);
            color: color-mix(in srgb, red 100%, blue);
        }
    }
    @media (width >= 600px) {
        .css-child {
            height: 30px;
        }
    }
`;

export default layerComponentCreate(function(){
    //Keeping the browser fixture independent of application data and network operations
    return html`<main class="css-example"><p class="css-child">CSS compatibility</p></main>`;

});
