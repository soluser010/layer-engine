import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LAYER_COMPILER_VERSION,
    LayerCompilerError,
    layerComponentCompile,
    layerComponentRouteExtract,
    layerComponentScriptValidate,
    layerExpressionAssign,
    layerExpressionCompile,
    layerExpressionEvaluate,
    layerScopedCssCompile,
    layerStylesheetCompile
} from '../src/index.js';

const componentSource = `
<template>
    <article class="message" :data-status="message.status">
        <strong>{{ message.author }}</strong>
        <p>{{ message.text }}</p>
        <button l-if="canDelete" @click="messageDelete">Delete</button>
    </article>
</template>
<script>
export const setup = function setup() {
    return {};
};
</script>
<style scoped>
.message, .message:hover {
    display: grid;
}

:global(body) {
    margin: 0;
}
</style>
`;

test('compiles deterministic .layer SFC render plans and scoped CSS', function() {
    const firstResult = layerComponentCompile(componentSource, {
        componentId: 'chat/message-card',
        file: 'message-card.layer'
    });
    const secondResult = layerComponentCompile(componentSource, {
        componentId: 'chat/message-card',
        file: 'message-card.layer'
    });

    assert.equal(firstResult.compilerVersion, LAYER_COMPILER_VERSION);
    assert.deepEqual(firstResult, secondResult);
    assert.ok(Object.isFrozen(firstResult));
    assert.ok(Object.isFrozen(firstResult.template));
    assert.match(firstResult.style.css, /data-layer-scope/);
    assert.match(firstResult.style.css, /body/);
    assert.equal(firstResult.sourceMap.bindings.length, 5);
    assert.equal(firstResult.sourceMap.file, 'message-card.layer');
});

test('compiles expressions without eval and evaluates local data only', function() {
    const expressionData = layerExpressionCompile(
        'enabled && (message.count + 1 >= 3 ? formatter(message.text) : "wait")'
    );
    const resultData = layerExpressionEvaluate(expressionData, {
        enabled: true,
        message: {
            count: 2,
            text: 'hello'
        },
        formatter: function formatter(/** @type {unknown} */ textValue) {
            return String(textValue).toUpperCase();
        }
    });

    assert.equal(resultData, 'HELLO');
    assert.equal(layerExpressionEvaluate(layerExpressionCompile('missing?.value ?? "fallback"'), {}), 'fallback');
    const collectionResult = /** @type {unknown[]} */ (layerExpressionEvaluate(
        layerExpressionCompile('[message.count, {ready: enabled}]'),
        {
            enabled: true,
            message: {
                count: 2
            }
        }
    ));

    assert.equal(collectionResult[0], 2);
    assert.equal(/** @type {Record<string, unknown>} */ (collectionResult[1]).ready, true);
    assert.equal(Object.getPrototypeOf(collectionResult[1]), null);
});

test('assigns model expressions only through signals or owned fields', function() {
    let signalValue = 'before';
    const modelSignal = {
        set(/** @type {unknown} */ nextValue) {
            //Capturing the value written through the public signal shape.
            signalValue = String(nextValue);

        }
    };
    const profileData = {
        name: 'Anna'
    };

    layerExpressionAssign(layerExpressionCompile('title'), {title: modelSignal}, 'after');
    layerExpressionAssign(layerExpressionCompile('profile.name'), {profile: profileData}, 'Maria');

    assert.equal(signalValue, 'after');
    assert.equal(profileData.name, 'Maria');
    assert.throws(function missingModelAssign() {
        layerExpressionAssign(layerExpressionCompile('missing'), {}, 'blocked');
    }, /writable signal/);
});

test('compiles exclusive conditional chains, models, and template refs', function() {
    const componentData = layerComponentCompile(`
        <template>
            <p l-if="mode === 'first'">First</p>
            <p l-else-if="mode === 'second'">Second</p>
            <p l-else>Fallback</p>
            <input l-model="title" l-ref="titleInput">
            <textarea l-model="profile.bio"></textarea>
        </template>
    `, {
        componentId: 'forms/editor'
    });
    const conditionalPlans = componentData.template.filter(function conditionalPlanFind(planData) {
        //Selecting compiler-owned boundaries while ignoring formatting text nodes.
        return planData.kind === 'if';

    });
    const elementPlans = componentData.template.filter(function elementPlanFind(planData) {
        //Selecting the direct form-control plans for model inspection.
        return planData.kind === 'element';

    });

    assert.equal(conditionalPlans.length, 3);
    assert.deepEqual(conditionalPlans.map(function conditionalEvaluate(planData) {
        //Evaluating every exclusive branch for the same render scope.
        return layerExpressionEvaluate(planData.expression, {mode: 'second'});

    }), [false, true, false]);
    assert.equal(elementPlans[0]?.modelBindings[0]?.property, 'value');
    assert.equal(elementPlans[0]?.refName, 'titleInput');
    assert.equal(elementPlans[1]?.modelBindings[0]?.property, 'value');
    assert.equal(componentData.sourceMap.bindings.filter(function modelBindingFind(bindingData) {
        //Counting public source-map ownership for both form models.
        return bindingData.kind === 'model';

    }).length, 2);
});

test('compiles stable server-driven regions with explicit ownership', function() {
    const componentData = layerComponentCompile(`
        <template>
            <section l-region="feed">
                <article class="empty">No messages</article>
            </section>
        </template>
    `, {
        componentId: 'chat/feed-region'
    });
    const regionPlan = /** @type {any} */ (componentData.template.find(function regionPlanFind(planData) {
        //Selecting the declared region element while ignoring formatting text.
        return planData.kind === 'element' && planData.regionName === 'feed';

    }));

    assert.equal(regionPlan?.regionName, 'feed');
    assert.deepEqual(componentData.sourceMap.regions, [{name: 'feed', nodeId: regionPlan?.nodeId}]);
});

test('rejects unsafe or statement-shaped template expressions', function() {
    const invalidExpressions = [
        'globalThis.secret',
        'message.constructor',
        'value = 1',
        'new Date()',
        '/unsafe/u',
        ''
    ];

    for (const expressionSource of invalidExpressions) {
        assert.throws(
            function unsafeExpressionCompile() {
                layerExpressionCompile(expressionSource);
            },
            function compilerErrorCheck(errorData) {
                return errorData instanceof LayerCompilerError && errorData.code === 'LAYER_EXPRESSION_INVALID';
            }
        );
    }

    assert.equal(
        layerExpressionEvaluate(layerExpressionCompile('message[dynamicKey]'), {
            message: {
                safe: 'value'
            },
            dynamicKey: '__proto__'
        }),
        undefined
    );
});

test('validates ESM scripts and blocks dynamic execution', function() {
    assert.doesNotThrow(function validScriptCheck() {
        layerComponentScriptValidate('export const setup = function setup() { return {}; };');
    });

    for (const scriptSource of [
        'export const value = eval("1");',
        'export const value = Function("return 1");',
        'export const value = new Function("return 1");',
        'export const value = import("./dynamic.js");'
    ]) {
        assert.throws(function unsafeScriptCheck() {
            layerComponentScriptValidate(scriptSource);
        }, /not allowed|Dynamic/);
    }

    assert.throws(function invalidScriptCheck() {
        layerComponentScriptValidate('export const = ;');
    }, /valid ESM/);
});

test('rejects malformed and unsafe component structures', function() {
    const invalidComponents = [
        '<script>export const value = 1;</script>',
        '<template><script>alert(1)</script></template>',
        '<template><button onclick="alert(1)">x</button></template>',
        '<template><div :innerHTML="content"></div></template>',
        '<template><p l-for="item in items">{{ item }}</p></template>',
        '<template><p l-key="item.id">x</p></template>',
        '<template><p l-if="visible" l-for="item in items" l-key="item.id">x</p></template>',
        '<template><p l-else>x</p></template>',
        '<template><div l-model="value"></div></template>',
        '<template><input l-model="value + 1"></template>',
        '<template><input value="fixed" l-model="value"></template>',
        '<template><textarea l-model="value">fixed</textarea></template>',
        '<template><input l-ref="invalid ref"></template>',
        '<template><section l-region="feed">{{ dynamic }}</section></template>',
        '<template><section l-region="feed"><button @click="run">Run</button></section></template>',
        '<template><section l-region="feed"></section><aside l-region="feed"></aside></template>',
        '<template><section l-if="visible"><div l-region="feed"></div></section></template>',
        '<template><div l-for="item in items" l-key="item.id"><section l-region="feed"></section></div></template>',
        '<template></template><template></template>',
        '<template><div></div></template><style>.x { color: red; }</style>'
    ];

    for (const invalidSource of invalidComponents) {
        assert.throws(function invalidComponentCompile() {
            layerComponentCompile(invalidSource, {
                componentId: 'invalid/component'
            });
        }, LayerCompilerError);
    }

    assert.throws(function invalidIdentityCompile() {
        layerComponentCompile('<template></template>', {
            componentId: '../unsafe component'
        });
    }, /componentId/);
});

test('scopes pseudo selectors, global selectors, and rejects invalid CSS', function() {
    const scopedCss = layerScopedCssCompile(
        '.button:hover::before, .icon { color: red; } :global(html) { color: black; }',
        'scope123'
    );

    assert.match(scopedCss, /\.button\[data-layer-scope="scope123"\]:hover::before/);
    assert.match(scopedCss, /\.icon\[data-layer-scope="scope123"\]/);
    assert.match(scopedCss, /html/);

    assert.throws(function invalidCssCompile() {
        layerScopedCssCompile('.button {', 'scope123');
    }, LayerCompilerError);
});

test('compiles scoped, global, module, asset, and source-range CSS contracts', function(){
    const moduleResult = layerStylesheetCompile(`
.card, :global(.theme) .title {
    background-image: url('./card.svg');
    color: red;
}
`, {
        scopeIdentifier: 'layer-card-scope',
        modules: true,
        assetUrlMap: {
            './card.svg': '/_layer/assets/card.svg'
        },
        file: 'src/components/Card.layer.module.css'
    });
    const globalResult = layerStylesheetCompile('.shell { display: grid; }', {
        scopeIdentifier: 'layer-global-scope',
        scoped: false,
        file: 'src/styles/application.global.layer.css'
    });
    const moduleClassData = /** @type {Record<string, string>} */ (moduleResult.classes);

    assert.equal(typeof moduleClassData.card, 'string');
    assert.equal(typeof moduleClassData.title, 'string');
    assert.match(String(moduleClassData.card), /^card__/);
    assert.match(String(moduleClassData.title), /^title__/);
    assert.match(moduleResult.css, /data-layer-scope="layer-card-scope"/);
    assert.match(moduleResult.css, /\/_layer\/assets\/card\.svg/);
    assert.deepEqual(moduleResult.assets, ['./card.svg']);
    assert.equal(moduleResult.sourceMap.length >= 3, true);
    assert.equal(Object.hasOwn(moduleResult.classes, 'theme'), false);
    assert.doesNotMatch(globalResult.css, /data-layer-scope/);
    assert.throws(function externalCssUrlReject(){
        layerStylesheetCompile('.card { background: url("javascript:alert(1)"); }', {
            scopeIdentifier: 'layer-card-scope'
        });

    }, function cssUrlErrorCheck(errorData){
        return errorData instanceof LayerCompilerError && errorData.code === 'LAYER_STYLE_URL_INVALID';

    });
    assert.throws(function dataCssUrlReject(){
        layerStylesheetCompile('.card { background: url(data:image/svg+xml,test); }', {
            scopeIdentifier: 'layer-card-scope'
        });

    }, /CSS asset URL/);
    assert.throws(function emptyCssUrlReject(){
        layerStylesheetCompile('.card { background: url(""); }', {
            scopeIdentifier: 'layer-card-scope'
        });

    }, /empty or malformed/);
    assert.throws(function invalidScopeReject(){
        layerStylesheetCompile('.card { color: red; }', {
            scopeIdentifier: '../unsafe'
        });

    }, /stable scope/);
    const keyframeResult = layerStylesheetCompile(`
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.animated { animation: fade 1s; mask-image: url('/mask.svg'); }
`, {
        scopeIdentifier: 'layer-animation-scope',
        modules: true
    });

    assert.doesNotMatch(keyframeResult.css, /from\[data-layer-scope/);
    assert.match(keyframeResult.css, /url\("\/mask\.svg"\)/);

    const numericScopeResult = layerStylesheetCompile('.numeric { color: red; }', {
        scopeIdentifier: '7557ea5702ad'
    });

    assert.match(numericScopeResult.css, /data-layer-scope="7557ea5702ad"/);
});

test('requires stable keyed list syntax and compiles index locals', function() {
    const listComponent = layerComponentCompile(`
        <template>
            <ul>
                <li l-for="(item, index) in items" l-key="item.id">
                    {{ index }} — {{ item.label }}
                </li>
            </ul>
        </template>
    `, {
        componentId: 'list/example'
    });
    const rootPlan = listComponent.template.find(function elementFind(planData) {
        return planData.kind === 'element';
    });
    const listPlan = rootPlan?.children.find(function listFind(planData) {
        return planData.kind === 'for';
    });

    assert.equal(listPlan?.itemName, 'item');
    assert.equal(listPlan?.indexName, 'index');

    assert.throws(function malformedForCompile() {
        layerComponentCompile('<template><p l-for="item items" l-key="item.id"></p></template>', {
            componentId: 'list/invalid'
        });
    }, /l-for/);
});

test('extracts static page route configuration without executing component code', function() {
    const routeData = layerComponentRouteExtract(`
        export const route = {
            render: 'ssr',
            layout: 'application',
            auth: 'session',
            permissions: ['chat.read'],
            preload: ['chat.dialog.get'],
            offline: 'snapshot',
            cache: 'private',
            metadata: {
                title: 'Dialog'
            }
        };
        export const setup = function setup() {
            return {};
        };
    `);

    assert.deepEqual(routeData, {
        render: 'ssr',
        layout: 'application',
        auth: 'session',
        permissions: ['chat.read'],
        preload: ['chat.dialog.get'],
        offline: 'snapshot',
        cache: 'private',
        metadata: {
            title: 'Dialog'
        }
    });
    assert.equal(layerComponentRouteExtract('export const setup = () => ({});'), null);
});

test('route extraction rejects executable, spread, and mutable route exports', function() {
    assert.throws(() => layerComponentRouteExtract('export const route = createRoute();'), (errorData) => {
        return /** @type {any} */ (errorData).code === 'LAYER_ROUTE_EXPORT_INVALID';
    });
    assert.throws(() => layerComponentRouteExtract('export const route = {...baseRoute};'), LayerCompilerError);
    assert.throws(() => layerComponentRouteExtract('export let route = {};'), LayerCompilerError);
    assert.throws(() => layerComponentRouteExtract('export const route = {permissions: ["chat.read", ...more]};'), LayerCompilerError);
});
