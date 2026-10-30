import {css, html, layerComponentCreate, layerComputedCreate, layerPageCreate, layerSignalCreate} from '@solcorp/layer';

export const page = layerPageCreate({render: 'csr', auth: 'none'});
export const styles = css`
    .viewport-example {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
    }
    .chat {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
    }
    .messages {
        overflow: auto;
    }
    .message {
        height: 80px;
    }
`;

export default layerComponentCreate(function ViewportExample( _properties, context ){
    //Creating local reactive data without changing the composer node identity
    const title = layerSignalCreate( 'Viewport example' );
    const draft = layerSignalCreate( 'Hello viewport' );
    const availableHeight = layerComputedCreate(function(){
        //Reading the component-local geometry signal instead of a foreign chunk signal
        return context.viewport.state.get().availableHeight;

    });
    const titleChange = function(){
        //Updating one text binding while the composer owns focus and selection
        title.set( 'Updated viewport example' );

    };
    const keyboardShow = function(){
        //Requesting focus synchronously inside a real user click handler
        window.layerKeyboardResult = context.keyboard.show( document.querySelector( '#viewport-message' ) );

    };
    const keyboardHide = function(){
        //Retaining field focus through pointerdown so hide can target the active composer
        window.layerKeyboardResult = context.keyboard.hide();

    };
    context.onMount(function(){
        //Exposing a browser-only inspection handle for the isolated test fixture
        window.layerViewportFixture = {viewport: context.viewport, keyboard: context.keyboard, titleChange};

    });
    context.onDestroy(function(){
        //Removing fixture references when the route releases its owner
        delete window.layerViewportFixture;

    });

    //Rendering canonical HTML with declarative input policies and an explicit scroll region
    return html`
        <main class="viewport-example">
            <header>
                <h1>${title}</h1>
                <output id="available-height">${availableHeight}</output>
                <input id="viewport-search" type="search" aria-label="Search"
                    data-layer-keyboard="preserve" data-layer-scroll="preserve">
            </header>
            <section class="chat">
                <div class="messages" data-layer-scroll-region="messages">
                    <p class="message" data-layer-scroll-key="one">Message one</p>
                    <p class="message" data-layer-scroll-key="two">Message two</p>
                    <p class="message" data-layer-scroll-key="three">Message three</p>
                    <p class="message" data-layer-scroll-key="four">Message four</p>
                    <p class="message" data-layer-scroll-key="five">Message five</p>
                    <p class="message" data-layer-scroll-key="six">Message six</p>
                </div>
                <footer>
                    <textarea id="viewport-message" aria-label="Message" l-model=${draft}
                        data-layer-keyboard="resize" data-layer-focus="retain"></textarea>
                    <button data-layer-focus-retain @click=${titleChange}>Send</button>
                    <button id="keyboard-show" @click=${keyboardShow}>Write</button>
                    <button id="keyboard-hide" data-layer-focus-retain @click=${keyboardHide}>Hide keyboard</button>
                </footer>
            </section>
        </main>
    `;

});
