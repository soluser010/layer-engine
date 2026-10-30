const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDirectory = path.resolve(__dirname, '..');

test('Layer grammar embeds HTML, CSS, and JavaScript interpolation scopes', function(){
    const packageData = JSON.parse(readFileSync(path.join(extensionDirectory, 'package.json'), 'utf8'));
    const injectionGrammar = JSON.parse(readFileSync(
        path.join(extensionDirectory, 'syntaxes', 'layer-injection.tmLanguage.json'),
        'utf8'
    ));

    assert.equal(packageData.contributes.languages[0].id, 'javascript');
    assert.equal(packageData.contributes.languages[0].extensions.includes('.layer.js'), true);
    assert.equal(injectionGrammar.repository['html-template'].patterns.some(function htmlGrammarFind(patternData){
        return patternData.include === 'text.html.basic';

    }), true);
    assert.equal(injectionGrammar.repository['css-template'].patterns.some(function cssGrammarFind(patternData){
        return patternData.include === 'source.css';

    }), true);
    assert.equal(injectionGrammar.repository['javascript-interpolation'].patterns[0].include, 'source.js');
    assert.match(injectionGrammar.repository['html-template'].begin, /html/);
    assert.match(injectionGrammar.repository['css-template'].begin, /css/);
});
/* global __dirname */
