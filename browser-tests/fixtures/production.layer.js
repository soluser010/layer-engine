import {html, layerComponentCreate, layerPageCreate, layerSignalCreate} from '@solcorp/layer';

export const page = layerPageCreate({render: 'ssr', auth: 'none', offline: 'shell', cache: 'public'});

export default layerComponentCreate(function ProductionFixture(){
    //Keeping one observable binding for the real deployment hydration check
    const countData = layerSignalCreate( 0 );
    const countIncrease = function(){
        //Updating the binding without replacing the document
        countData.set( countData.get() + 1 );

    };

    //Rendering a signal and a route link through the public authoring contract
    return html`<main>
        <h1>Production fixture</h1>
        <output id="counter">${countData}</output>
        <button @click=${countIncrease}>Increase</button>
        <a href="/second/?source=fixture#content">Second page</a>
    </main>`;

});
