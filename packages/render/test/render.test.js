import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LAYER_COMPILER_VERSION,
    layerComponentCompile
} from '@solcorp/layer-compiler';
import {JSDOM} from 'jsdom';
import {
    batch,
    computed,
    effect,
    layerCommitWait,
    layerComponentContextCreate,
    layerComponentDefinitionCreate,
    layerComponentHydrate,
    layerComponentInstanceHydrate,
    layerComponentInstanceMount,
    layerComponentInstanceRenderToString,
    layerComponentMount,
    layerComponentRenderToString,
    layerRenderDiagnosticsCreate,
    layerSlotContentCreate,
    signal,
    store
} from '../src/index.js';

const dialogSource = `
<template>
    <section class="dialog" :data-state="dialogState">
        <h1>{{ title }}</h1>
        <ul>
            <li l-for="(message, index) in messages" l-key="message.id" :data-status="message.status">
                <span>{{ index }}:{{ message.text }}</span>
                <button @click="messageSelect">Select</button>
            </li>
        </ul>
        <p l-if="typingVisible">Typing…</p>
        <a :href="profileUrl">Profile</a>
    </section>
</template>
<style scoped>
.dialog {
    display: grid;
}
</style>
`;

const dialogComponent = layerComponentCompile(dialogSource, {
    componentId: 'chat/dialog'
});

const formComponent = layerComponentCompile(`
<template>
    <section>
        <p data-branch="first" l-if="mode === 'first'">First</p>
        <p data-branch="second" l-else-if="mode === 'second'">Second</p>
        <p data-branch="fallback" l-else>Fallback</p>
        <input l-model="name" l-ref="nameInput">
        <input type="checkbox" l-model="enabled" l-ref="enabledInput">
        <textarea l-model="profile.bio" l-ref="bioInput"></textarea>
        <select l-model="role" l-ref="roleInput">
            <option value="user">User</option>
            <option value="admin">Admin</option>
        </select>
    </section>
</template>
`, {
    componentId: 'forms/profile'
});

const shellComponent = layerComponentCompile(`
<template>
    <article>
        <h1>{{ title }}</h1>
        <slot name="body"><p data-fallback="true">Fallback</p></slot>
        <button @click="save">Save</button>
    </article>
</template>
`, {
    componentId: 'components/shell'
});

const shellBodyComponent = layerComponentCompile(`
<template>
    <section l-ref="slotBody">{{ text }}</section>
</template>
`, {
    componentId: 'components/shell-body'
});

const regionComponent = layerComponentCompile(`
<template>
    <main>
        <section l-region="feed">
            <article class="empty"><p>No messages</p></article>
        </section>
    </main>
</template>
`, {
    componentId: 'chat/feed-region'
});

function browserRootCreate() {
    const browserData = new JSDOM('<!doctype html><div id="root"></div>');
    const rootNode = browserData.window.document.querySelector('#root');

    if (rootNode === null) {
        throw new Error('The test root is unavailable.');
    }

    return {
        browserData,
        rootNode
    };
}

function dialogScopeCreate() {
    const selectedEvents = /** @type {string[]} */ ([]);

    return {
        dialogState: signal('ready'),
        title: signal('General'),
        messages: signal([
            {
                id: 'm1',
                status: 'sent',
                text: 'First'
            },
            {
                id: 'm2',
                status: 'sent',
                text: 'Second'
            }
        ]),
        typingVisible: signal(true),
        profileUrl: signal('/people/current'),
        messageSelect: function messageSelect(/** @type {Event} */ eventData) {
            selectedEvents.push(eventData.type);
        },
        selectedEvents
    };
}

function formScopeCreate() {
    //Creating independent reactive form state for mount and hydration tests.
    return {
        mode: signal('second'),
        name: signal('Anna'),
        enabled: signal(true),
        profile: store({
            bio: 'Offline & safe'
        }),
        role: signal('admin')
    };

}

test('signals batch computed values and run effects after bindings', async function() {
    const firstValue = signal(2);
    const secondValue = signal(3);
    const totalValue = computed(function totalCompute() {
        return firstValue.get() + secondValue.get();
    });
    const effectValues = /** @type {number[]} */ ([]);
    const disposeEffect = effect(function totalEffect() {
        effectValues.push(totalValue.get());
    });

    assert.equal(totalValue.get(), 5);
    await layerCommitWait();
    assert.deepEqual(effectValues, [5]);

    batch(function valuesUpdate() {
        firstValue.set(7);
        secondValue.update(function secondIncrement(previousValue) {
            return previousValue + 1;
        });
    });

    await layerCommitWait();
    assert.equal(totalValue.peek(), 11);
    assert.deepEqual(effectValues, [
        5,
        11
    ]);

    firstValue.set(7);
    await layerCommitWait();
    assert.deepEqual(effectValues, [
        5,
        11
    ]);

    disposeEffect();
    totalValue.dispose();
});

test('store invalidates only the reactive field read by an effect', async function() {
    const profileStore = store({
        name: 'Anna',
        visits: 1
    });
    const observedNames = /** @type {string[]} */ ([]);
    const disposeEffect = effect(function nameObserve() {
        observedNames.push(profileStore.name);
    });

    await layerCommitWait();
    profileStore.visits = 2;
    await layerCommitWait();
    assert.deepEqual(observedNames, ['Anna']);

    profileStore.name = 'Maria';
    await layerCommitWait();
    assert.deepEqual(observedNames, [
        'Anna',
        'Maria'
    ]);

    const dynamicStore = store(/** @type {Record<string, string | undefined>} */ ({}));
    const observedAliases = /** @type {(string | undefined)[]} */ ([]);
    const disposeAliasEffect = effect(function aliasObserve() {
        observedAliases.push(dynamicStore.alias);
    });

    await layerCommitWait();
    dynamicStore.alias = 'admin';
    await layerCommitWait();
    delete dynamicStore.alias;
    await layerCommitWait();
    assert.deepEqual(observedAliases, [
        undefined,
        'admin',
        undefined
    ]);

    disposeAliasEffect();
    disposeEffect();
});

test('mount updates one message attribute without replacing its list or parent', async function() {
    const {browserData, rootNode} = browserRootCreate();
    const renderScope = dialogScopeCreate();
    const diagnostics = layerRenderDiagnosticsCreate();
    const renderController = layerComponentMount(dialogComponent, rootNode, renderScope, {
        diagnostics
    });
    const dialogNode = rootNode.querySelector('.dialog');
    const initialMessageNodes = [...rootNode.querySelectorAll('li')];

    assert.equal(rootNode.querySelector('h1')?.textContent, 'General');
    assert.equal(initialMessageNodes.length, 2);
    diagnostics.reset();

    renderScope.messages.set([
        /** @type {{id: string, status: string, text: string}} */ (renderScope.messages.peek()[0]),
        {
            .../** @type {{id: string, status: string, text: string}} */ (renderScope.messages.peek()[1]),
            status: 'delivered'
        }
    ]);
    await layerCommitWait();

    const nextMessageNodes = [...rootNode.querySelectorAll('li')];
    const mutationData = diagnostics.snapshot();

    assert.equal(nextMessageNodes[1]?.getAttribute('data-status'), 'delivered');
    assert.equal(rootNode.querySelector('.dialog'), dialogNode);
    assert.equal(nextMessageNodes[0], initialMessageNodes[0]);
    assert.equal(nextMessageNodes[1], initialMessageNodes[1]);
    assert.equal(mutationData.attribute, 1);
    assert.equal(mutationData.create, 0);
    assert.equal(mutationData.remove, 0);
    assert.equal(mutationData.move, 0);

    const selectButton = rootNode.querySelector('button');
    selectButton?.dispatchEvent(new browserData.window.Event('click', {
        bubbles: true
    }));
    assert.deepEqual(renderScope.selectedEvents, ['click']);
    renderController.dispose();
});

test('keyed lists preserve nodes across moves, inserts, and removals', async function() {
    const {rootNode} = browserRootCreate();
    const renderScope = dialogScopeCreate();
    const diagnostics = layerRenderDiagnosticsCreate();
    const renderController = layerComponentMount(dialogComponent, rootNode, renderScope, {
        diagnostics
    });
    const firstNode = rootNode.querySelector('[data-layer-key="string:m1"]');
    const secondNode = rootNode.querySelector('[data-layer-key="string:m2"]');

    diagnostics.reset();
    renderScope.messages.set([
        /** @type {{id: string, status: string, text: string}} */ (renderScope.messages.peek()[1]),
        /** @type {{id: string, status: string, text: string}} */ (renderScope.messages.peek()[0]),
        {
            id: 'm3',
            status: 'queued',
            text: 'Third'
        }
    ]);
    await layerCommitWait();

    const movedNodes = [...rootNode.querySelectorAll('li')];

    assert.equal(movedNodes[0], secondNode);
    assert.equal(movedNodes[1], firstNode);
    assert.equal(movedNodes[2]?.textContent?.includes('Third'), true);
    assert.equal(diagnostics.snapshot().move > 0, true);
    assert.equal(diagnostics.snapshot().create > 0, true);

    diagnostics.reset();
    renderScope.messages.set([
        /** @type {{id: string, status: string, text: string}} */ (renderScope.messages.peek()[0]),
        /** @type {{id: string, status: string, text: string}} */ (renderScope.messages.peek()[2])
    ]);
    await layerCommitWait();
    assert.equal(rootNode.querySelector('[data-layer-key="string:m1"]'), null);
    assert.equal(rootNode.querySelector('[data-layer-key="string:m2"]'), secondNode);
    assert.equal(diagnostics.snapshot().remove, 1);
    renderController.dispose();
});

test('conditional bindings and URL policy mutate only declared targets', async function() {
    const {rootNode} = browserRootCreate();
    const renderScope = dialogScopeCreate();
    const diagnostics = layerRenderDiagnosticsCreate();
    const renderController = layerComponentMount(dialogComponent, rootNode, renderScope, {
        diagnostics
    });
    const dialogNode = rootNode.querySelector('.dialog');

    diagnostics.reset();
    renderScope.typingVisible.set(false);
    renderScope.profileUrl.set('javascript:alert(1)');
    await layerCommitWait();

    assert.equal(rootNode.querySelector('p'), null);
    assert.equal(rootNode.querySelector('a')?.hasAttribute('href'), false);
    assert.equal(rootNode.querySelector('.dialog'), dialogNode);
    assert.equal(diagnostics.snapshot().remove, 1);
    assert.equal(diagnostics.snapshot().attribute, 1);

    renderScope.typingVisible.set(true);
    await layerCommitWait();
    assert.equal(rootNode.querySelector('p')?.textContent, 'Typing…');
    renderController.dispose();
});

test('conditional chains, models, and refs preserve one DOM owner', async function() {
    const {browserData, rootNode} = browserRootCreate();
    const renderScope = formScopeCreate();
    const renderController = layerComponentMount(formComponent, rootNode, renderScope);
    const nameInput = /** @type {HTMLInputElement | null} */ (renderController.refs.get('nameInput'));
    const enabledInput = /** @type {HTMLInputElement | null} */ (renderController.refs.get('enabledInput'));
    const bioInput = /** @type {HTMLTextAreaElement | null} */ (renderController.refs.get('bioInput'));
    const roleInput = /** @type {HTMLSelectElement | null} */ (renderController.refs.get('roleInput'));

    assert.equal(rootNode.querySelector('[data-branch="second"]')?.textContent, 'Second');
    assert.equal(rootNode.querySelectorAll('[data-branch]').length, 1);
    assert.equal(nameInput?.value, 'Anna');
    assert.equal(enabledInput?.checked, true);
    assert.equal(bioInput?.value, 'Offline & safe');
    assert.equal(roleInput?.value, 'admin');
    assert.equal(renderController.refs.getAll('nameInput').length, 1);
    assert.deepEqual(renderController.refs.list(), [
        'bioInput',
        'enabledInput',
        'nameInput',
        'roleInput'
    ]);

    if (nameInput === null || enabledInput === null || bioInput === null || roleInput === null) {
        throw new Error('Form refs were not connected.');

    }

    nameInput.value = 'Maria';
    nameInput.dispatchEvent(new browserData.window.Event('input', {bubbles: true}));
    enabledInput.checked = false;
    enabledInput.dispatchEvent(new browserData.window.Event('change', {bubbles: true}));
    bioInput.value = 'Updated';
    bioInput.dispatchEvent(new browserData.window.Event('input', {bubbles: true}));
    roleInput.value = 'user';
    roleInput.dispatchEvent(new browserData.window.Event('change', {bubbles: true}));
    await layerCommitWait();

    assert.equal(renderScope.name.peek(), 'Maria');
    assert.equal(renderScope.enabled.peek(), false);
    assert.equal(renderScope.profile.bio, 'Updated');
    assert.equal(renderScope.role.peek(), 'user');

    renderScope.name.set('Server confirmed');
    renderScope.mode.set('other');
    await layerCommitWait();
    assert.equal(nameInput.value, 'Server confirmed');
    assert.equal(rootNode.querySelector('[data-branch="fallback"]')?.textContent, 'Fallback');
    assert.equal(rootNode.querySelectorAll('[data-branch]').length, 1);

    renderController.dispose();
    assert.equal(renderController.refs.has('nameInput'), false);
});

test('form models and refs render on the server and hydrate without recovery', function() {
    const renderScope = formScopeCreate();
    const ssrResult = layerComponentRenderToString(formComponent, renderScope);

    assert.match(ssrResult.html, /data-layer-ref="nameInput"/);
    assert.match(ssrResult.html, /value="Anna"/);
    assert.match(ssrResult.html, /checked=""/);
    assert.match(ssrResult.html, /Offline &amp; safe<\/textarea>/);

    const {rootNode} = browserRootCreate();
    rootNode.innerHTML = ssrResult.html;
    const nameInput = rootNode.querySelector('[data-layer-ref="nameInput"]');
    const hydrationController = layerComponentHydrate(formComponent, rootNode, renderScope);

    assert.equal(hydrationController.recovered, false);
    assert.equal(hydrationController.refs.get('nameInput'), nameInput);
    assert.equal(/** @type {HTMLSelectElement | null} */ (hydrationController.refs.get('roleInput'))?.value, 'admin');
    hydrationController.dispose();
});

test('component runtime enforces props, emits, context, slots, and lifecycle', async function() {
    const lifecycleEvents = /** @type {string[]} */ ([]);
    const emittedEvents = /** @type {unknown[]} */ ([]);
    const componentDefinition = layerComponentDefinitionCreate({
        component: shellComponent,
        props: {
            title: {
                required: true,
                validate: function titleValidate(/** @type {unknown} */ titleValue) {
                    //Accepting a bounded textual title for this component contract.
                    return typeof titleValue === 'string' && titleValue.length <= 80;

                }
            }
        },
        emits: ['save'],
        setup(/** @type {any} */ setupContext) {
            const themeName = setupContext.inject('application.theme', 'light');

            setupContext.provide('shell.theme', themeName);
            setupContext.onMounted(function shellMounted() {
                lifecycleEvents.push('mounted');
            });
            setupContext.onHydrated(function shellHydrated() {
                lifecycleEvents.push('hydrated');
            });
            setupContext.onUpdated(function shellUpdated() {
                lifecycleEvents.push('updated');
            });
            setupContext.onDisposed(function shellDisposed() {
                lifecycleEvents.push('disposed');
            });

            return {
                save() {
                    //Emitting only the event declared by the component definition.
                    setupContext.emit('save', {theme: themeName});

                }
            };
        }
    });
    const parentContext = layerComponentContextCreate({
        values: {
            'application.theme': 'dark'
        }
    });
    const slotText = signal('Provided body');
    const slots = {
        body: layerSlotContentCreate(shellBodyComponent, {text: slotText})
    };
    const {browserData, rootNode} = browserRootCreate();
    const componentController = layerComponentInstanceMount(componentDefinition, rootNode, {
        props: {title: 'Initial title'},
        slots,
        context: parentContext,
        onEmit(/** @type {string} */ eventName, /** @type {unknown} */ payloadData) {
            emittedEvents.push({eventName, payloadData});
        }
    });

    assert.equal(rootNode.querySelector('h1')?.textContent, 'Initial title');
    assert.equal(rootNode.querySelector('section')?.textContent, 'Provided body');
    assert.equal(componentController.refs.get('slotBody'), rootNode.querySelector('section'));
    assert.equal(componentController.context.get('shell.theme'), 'dark');
    assert.deepEqual(lifecycleEvents, ['mounted']);

    rootNode.querySelector('button')?.dispatchEvent(new browserData.window.Event('click', {bubbles: true}));
    assert.deepEqual(emittedEvents, [{
        eventName: 'save',
        payloadData: {theme: 'dark'}
    }]);

    await componentController.update({title: 'Updated title'});
    assert.equal(rootNode.querySelector('h1')?.textContent, 'Updated title');
    assert.deepEqual(lifecycleEvents, ['mounted', 'updated']);

    componentController.dispose();
    assert.deepEqual(lifecycleEvents, ['mounted', 'updated', 'disposed']);

    assert.throws(function missingRequiredPropMount() {
        layerComponentInstanceMount(componentDefinition, rootNode, {props: {}});
    }, /Required component prop/);
});

test('component SSR selects slots and hydration runs its own lifecycle', function() {
    const lifecycleEvents = /** @type {string[]} */ ([]);
    const componentDefinition = layerComponentDefinitionCreate({
        component: shellComponent,
        props: {
            title: {required: true}
        },
        setup(/** @type {any} */ setupContext) {
            setupContext.onHydrated(function componentHydrated() {
                lifecycleEvents.push('hydrated');
            });

            return {
                save() {
                    //Keeping the test event handler side-effect free.

                }
            };
        }
    });
    const slots = {
        body: layerSlotContentCreate(shellBodyComponent, {text: 'SSR body'})
    };
    const ssrResult = layerComponentInstanceRenderToString(componentDefinition, {
        props: {title: 'SSR title'},
        slots
    });

    assert.match(ssrResult.html, /SSR title/);
    assert.match(ssrResult.html, /SSR body/);
    assert.doesNotMatch(ssrResult.html, /data-fallback/);

    const fallbackResult = layerComponentInstanceRenderToString(componentDefinition, {
        props: {title: 'Fallback title'}
    });

    assert.match(fallbackResult.html, /data-fallback="true"/);

    const {rootNode} = browserRootCreate();
    rootNode.innerHTML = ssrResult.html;
    const slotNode = rootNode.querySelector('section');
    const hydrationController = layerComponentInstanceHydrate(componentDefinition, rootNode, {
        props: {title: 'SSR title'},
        slots
    });

    assert.equal(hydrationController.recovered, false);
    assert.equal(rootNode.querySelector('section'), slotNode);
    assert.deepEqual(lifecycleEvents, ['hydrated']);
    hydrationController.dispose();
});

test('SSR escapes user text and hydration reuses matching DOM', async function() {
    const serverScope = dialogScopeCreate();
    serverScope.title.set('<Unsafe & title>');
    const ssrResult = layerComponentRenderToString(dialogComponent, serverScope, {
        runtimeVersion: '0.1.0-test',
        protocolVersion: 1
    });

    assert.match(ssrResult.html, /&lt;Unsafe &amp; title&gt;/);
    assert.doesNotMatch(ssrResult.html, /javascript:/);
    assert.equal(ssrResult.metadata.compilerVersion, LAYER_COMPILER_VERSION);

    const {rootNode} = browserRootCreate();
    rootNode.innerHTML = ssrResult.html;
    const titleNode = rootNode.querySelector('h1');
    const messageNodes = [...rootNode.querySelectorAll('li')];
    const diagnostics = layerRenderDiagnosticsCreate();
    const hydrationController = layerComponentHydrate(dialogComponent, rootNode, serverScope, {
        diagnostics
    });

    assert.equal(hydrationController.recovered, false);
    assert.equal(rootNode.querySelector('h1'), titleNode);
    assert.equal(rootNode.querySelectorAll('li')[0], messageNodes[0]);
    assert.deepEqual(diagnostics.snapshot(), {
        attribute: 0,
        create: 0,
        move: 0,
        property: 0,
        remove: 0,
        text: 0
    });

    serverScope.title.set('Hydrated');
    await layerCommitWait();
    assert.equal(rootNode.querySelector('h1'), titleNode);
    assert.equal(titleNode?.textContent, 'Hydrated');
    assert.equal(diagnostics.snapshot().text, 1);
    hydrationController.dispose();
});

test('server-driven regions apply revisioned structured patches without raw HTML', function() {
    const ssrResult = layerComponentRenderToString(regionComponent, {});

    assert.match(ssrResult.html, /data-layer-region="feed"/);
    assert.match(ssrResult.html, /data-layer-region-revision="0"/);

    const {rootNode} = browserRootCreate();
    rootNode.innerHTML = ssrResult.html;
    const controller = layerComponentHydrate(regionComponent, rootNode, {});
    const regionNode = rootNode.querySelector('[data-layer-region="feed"]');

    assert.equal(controller.recovered, false);
    assert.deepEqual(controller.regions.list(), [{name: 'feed', revision: 0}]);

    controller.regions.apply({
        region: 'feed',
        baseRevision: 0,
        revision: 3,
        operations: [
            {
                type: 'attribute.set',
                path: [0],
                name: 'data-state',
                value: 'ready'
            },
            {
                type: 'text.set',
                path: [0, 0],
                value: 'First message'
            }
        ]
    });

    assert.equal(regionNode?.querySelector('article')?.getAttribute('data-state'), 'ready');
    assert.equal(regionNode?.querySelector('p')?.textContent, 'First message');
    assert.equal(controller.regions.revision('feed'), 3);

    controller.regions.apply({
        region: 'feed',
        baseRevision: 3,
        revision: 4,
        operations: [{
            type: 'children.replace',
            path: [],
            nodes: [{
                type: 'element',
                tag: 'a',
                attributes: {
                    href: 'javascript:alert(1)',
                    class: 'message'
                },
                children: [{type: 'text', value: 'Safe link'}]
            }]
        }]
    });

    assert.equal(regionNode?.querySelector('a')?.getAttribute('href'), null);
    assert.equal(regionNode?.textContent, 'Safe link');
    assert.equal(regionNode?.getAttribute('data-layer-region-revision'), '4');

    assert.throws(function stalePatchApply() {
        controller.regions.apply({
            region: 'feed',
            baseRevision: 3,
            revision: 5,
            operations: [{type: 'text.set', path: [], value: 'stale'}]
        });
    }, /conflicts/);
    assert.equal(regionNode?.textContent, 'Safe link');

    assert.throws(function unsafePatchApply() {
        controller.regions.apply({
            region: 'feed',
            baseRevision: 4,
            revision: 5,
            operations: [{
                type: 'children.replace',
                path: [],
                nodes: [{type: 'element', tag: 'script', children: []}]
            }]
        });
    }, /not allowed/);
    assert.equal(controller.regions.revision('feed'), 4);
    assert.equal(regionNode?.textContent, 'Safe link');

    controller.dispose();
    assert.equal(controller.regions.has('feed'), false);
});

test('server-driven regions reject malformed envelopes, paths, attributes, and nodes', function() {
    const {rootNode} = browserRootCreate();
    const controller = layerComponentMount(regionComponent, rootNode, {});
    const regionNode = rootNode.querySelector('[data-layer-region="feed"]');

    controller.regions.apply({
        region: 'feed',
        baseRevision: 0,
        revision: 1,
        operations: [{type: 'attribute.remove', path: [0], name: 'class'}]
    });
    controller.regions.apply({
        region: 'feed',
        baseRevision: 1,
        revision: 2,
        operations: [{type: 'attribute.set', path: [0], name: 'data-state', value: null}]
    });

    assert.equal(regionNode?.querySelector('article')?.hasAttribute('class'), false);
    assert.equal(regionNode?.querySelector('article')?.hasAttribute('data-state'), false);

    const invalidPatches = [
        null,
        {region: 'feed', baseRevision: 2, revision: 3, operations: [], extra: true},
        {region: 'invalid region', baseRevision: 2, revision: 3, operations: [{type: 'text.set', path: [], value: 'x'}]},
        {region: 'feed', baseRevision: -1, revision: 3, operations: [{type: 'text.set', path: [], value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 2, operations: [{type: 'text.set', path: [], value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: []},
        {region: 'missing', baseRevision: 0, revision: 1, operations: [{type: 'text.set', path: [], value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [null]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'unknown', path: []}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'text.set', path: 'root', value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'text.set', path: [99], value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'attribute.set', path: [], name: 'class', value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'attribute.set', path: [0], name: 'onclick', value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'attribute.set', path: [0], name: 'style', value: 'x'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'attribute.set', path: [0], name: 'data-value', value: {unsafe: true}}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: 'raw'}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: [null]}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: [{type: 'unknown'}]}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: [{type: 'text', value: 1}]}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: [{type: 'element', tag: 'IFRAME'}]}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: [{type: 'element', tag: 'div', attributes: {style: 'x'}}]}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: [{type: 'element', tag: 'div', attributes: {title: {unsafe: true}}}]}]},
        {region: 'feed', baseRevision: 2, revision: 3, operations: [{type: 'children.replace', path: [], nodes: [{type: 'element', tag: 'div', children: 'raw'}]}]}
    ];

    for (const patchData of invalidPatches) {
        assert.throws(function invalidRegionPatchApply() {
            controller.regions.apply(/** @type {any} */ (patchData));
        });

    }

    assert.equal(controller.regions.revision('feed'), 2);
    assert.throws(function unknownRegionRevisionRead() {
        controller.regions.revision('missing');
    }, /Unknown/);
    controller.dispose();
});

test('hydration mismatch recovers the component boundary only', function() {
    const renderScope = dialogScopeCreate();
    const ssrResult = layerComponentRenderToString(dialogComponent, renderScope);
    const {rootNode} = browserRootCreate();
    const diagnosticEvents = /** @type {string[]} */ ([]);
    const diagnostics = layerRenderDiagnosticsCreate({
        sink: function diagnosticCollect(eventData) {
            diagnosticEvents.push(eventData.type);
        }
    });

    rootNode.innerHTML = ssrResult.html.replace('<h1', '<h2').replace('</h1>', '</h2>');

    const hydrationController = layerComponentHydrate(dialogComponent, rootNode, renderScope, {
        diagnostics
    });

    assert.equal(hydrationController.recovered, true);
    assert.equal(rootNode.querySelector('h1')?.textContent, 'General');
    assert.equal(diagnosticEvents.includes('hydration-mismatch'), true);
    hydrationController.dispose();
});

test('mount rejects occupied roots and list contracts fail explicitly', function() {
    const {rootNode} = browserRootCreate();
    rootNode.textContent = 'occupied';

    assert.throws(function occupiedMount() {
        layerComponentMount(dialogComponent, rootNode, dialogScopeCreate());
    }, /must be empty/);

    rootNode.textContent = '';
    const invalidScope = dialogScopeCreate();
    invalidScope.messages.set(/** @type {never[]} */ ([
        {
            id: 'duplicate',
            status: 'sent',
            text: 'One'
        },
        {
            id: 'duplicate',
            status: 'sent',
            text: 'Two'
        }
    ]));

    assert.throws(function duplicateKeyMount() {
        layerComponentMount(dialogComponent, rootNode, invalidScope);
    }, /Duplicate l-key/);
});

test('component runtime rolls back owned DOM after a mounted hook failure', function(){
    const lifecycleEvents = /** @type {string[]} */ ([]);
    const mountErrorData = new Error( 'Mounted hook failed.' );
    const componentDefinition = layerComponentDefinitionCreate({
        component: shellComponent,
        props: {
            title: {required: true}
        },
        setup(/** @type {any} */ setupContext){
            setupContext.onMounted(function shellMountFail(){
                //Recording entry before failing the public mounted lifecycle.
                lifecycleEvents.push( 'mounted' );
                throw mountErrorData;

            });
            setupContext.onDisposed(function shellFailureDisposed(){
                //Recording cleanup invoked by the failed-mount rollback boundary.
                lifecycleEvents.push( 'disposed' );

            });

            return {
                save(){
                    //Keeping the template event contract complete for the failed mount fixture.
                    return undefined;

                }
            };

        }
    });
    const {rootNode} = browserRootCreate();

    assert.throws(function failedComponentMount(){
        //Mounting the component through the public instance runtime.
        layerComponentInstanceMount(componentDefinition, rootNode, {
            props: {title: 'Failure fixture'}
        });

    }, function mountFailureCheck( errorData ){
        //Accepting only the original lifecycle error preserved by rollback.
        return errorData === mountErrorData;

    });
    assert.equal( rootNode.childNodes.length, 0 );
    assert.deepEqual( lifecycleEvents, ['mounted', 'disposed'] );

});
