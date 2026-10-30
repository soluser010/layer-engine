import {html, layerComponentCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({render: 'csr', auth: 'none', offline: 'shell', cache: 'public'});

export default layerComponentCreate(function LinksPage(properties, context){
    //Publishing fixture-owned observations without adding a framework global API
    context.onMount(function(){
        //Exposing the actual compiled component owner for its browser gate
        window.layerLinksFixture = {owner: context.links};

    });
    //Rendering ordinary anchors to exercise the real generated click policy
    return html`
        <main>
            <h1>Links fixture</h1>
            <input aria-label="Draft" value="untouched">
            <a id="internal-link" href="/second/?room=42#message">Internal route</a>
            <a id="viewer-link" href="http://localhost:5330/external-content">External viewer</a>
            <a id="denied-link" href="http://localhost:5330/external-denied">Blocked embedding</a>
            <a id="target-link" target="_blank" rel="noopener" href="http://localhost:5330/external-content">Separate target</a>
        </main>
    `;

});
