import {html, layerComponentCreate, layerComputedCreate, layerPageCreate} from '@solcorp/layer';

export const page = layerPageCreate({
    auth: 'none',
    render: 'csr',
    preload: ['chat.messages']
});

export default layerComponentCreate(function ChatScreen(_props, context) {
    // Tracking real page lifecycle and observable input without issuing a command.
    const chat = context.route.params.chat;
    const latest = layerComputedCreate(function(){
        //Follow new preload snapshots while retaining the same input and component instance.
        return context.route.preload['chat.messages'];

    });
    context.onMount(() => {
        globalThis.chatMounts = (globalThis.chatMounts ?? 0) + 1;
    });
    const read = () => {
        globalThis.chatValue = context.route.preload['chat.messages'];
    };
    return html`<section><h1>Chat ${chat}</h1><output>${latest}</output><textarea aria-label="Draft"></textarea>
        <button @click=${read}>Read</button><a href="/second/">Leave</a></section>`;
});
