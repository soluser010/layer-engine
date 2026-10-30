import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import highlight from 'highlight.js';

const rootDirectoryData = path.resolve( import.meta.dirname, '..' );
const packageDirectoryData = path.join( rootDirectoryData, 'packages/docs' );
const manifestData = JSON.parse( await readFile( path.join( packageDirectoryData, 'package.json' ), 'utf8' ) );
const markdownData = new MarkdownIt({html: false, linkify: false, highlight: function( sourceData, languageData ){
    //Highlighting recognized code only, leaving escaping of unknown languages to the renderer
    if ( languageData && highlight.getLanguage( languageData ) ){
        return highlight.highlight( sourceData, {language: languageData, ignoreIllegals: true} ).value;

    }
    return '';

}});
const headingsData = new Map();
markdownData.renderer.rules.heading_open = function( tokensData, indexData, optionsData, environmentData, rendererData ){
    //Providing stable anchors compatible with links between application articles
    const titleData = tokensData[indexData + 1]?.content ?? '';
    const baseData = titleData.toLowerCase().replace( /[^\p{L}\p{N}_ -]/gu, '' ).replaceAll( ' ', '-' );
    const countData = headingsData.get( baseData ) ?? 0;
    headingsData.set( baseData, countData + 1 );
    let anchorData = baseData;
    if ( countData > 0 ){
        anchorData += '-' + countData;

    }
    tokensData[indexData]?.attrSet( 'id', anchorData );
    return rendererData.renderToken( tokensData, indexData, optionsData );

};

//Removing only owned generated outputs so deleted articles cannot remain in a published package
for ( const nameData of ['site', 'content'] ){
    const outputData = path.resolve( packageDirectoryData, nameData );
    if ( path.dirname( outputData ) !== packageDirectoryData ){
        throw new Error( 'Documentation output escapes its package.' );

    }
    await rm( outputData, {recursive: true, force: true} );

}

//Building Markdown and HTML from a single reviewed source without fetching remote resources
for ( const languageData of ['ru', 'en'] ){
    const sourceDirectoryData = path.join( rootDirectoryData, 'docs', languageData );
    const outputDirectoryData = path.join( packageDirectoryData, 'site', languageData );
    await mkdir( outputDirectoryData, {recursive: true} );
    const contentDirectoryData = path.join( packageDirectoryData, 'content', languageData );
    await mkdir( contentDirectoryData, {recursive: true} );
    const filesData = (await readdir( sourceDirectoryData )).filter( function( nameData ){
        //Selecting application documentation rather than private operational reports
        return nameData.endsWith( '.md' );

    }).sort();
    const articlesData = [];
    for ( const nameData of filesData ){
        const sourceData = await readFile( path.join( sourceDirectoryData, nameData ), 'utf8' );
        let contentData = sourceData;
        const titleData = /^title: (.+)$/mu.exec( sourceData )?.[1] ?? nameData;
        const bodyData = sourceData.replace( /^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '' );
        const tokensData = markdownData.parse( bodyData, {} );
        for ( const tokenData of tokensData.flatMap( function( tokenData ){
            //Inspecting inline links before rendering any HTML
            return tokenData.children ?? [];

        }) ){
            const hrefData = String( tokenData.attrGet( 'href' ) ?? '' );
            if ( hrefData && !/^(?:[a-z]+:|#|\/)/iu.test( hrefData ) ){
                const destinationData = path.posix.normalize( languageData + '/' + hrefData );
                if ( /^(ru|en)\/[^/]+\.md(?:#.*)?$/u.test( destinationData ) ){
                    tokenData.attrSet( 'href', '/' + destinationData.replace( '.md', '.html' ) );

                } else {
                    const repositoryUrlData = new URL( destinationData, 'https://github.com/soluser010/layer-engine/blob/main/docs/' ).href;
                    tokenData.attrSet( 'href', repositoryUrlData );
                    contentData = contentData.replaceAll( '](' + hrefData + ')', '](' + repositoryUrlData + ')' );

                }

            }

        }
        await writeFile( path.join( contentDirectoryData, nameData ), contentData, 'utf8' );
        headingsData.clear();
        const htmlData = markdownData.renderer.render( tokensData, markdownData.options, {} );
        articlesData.push({title: titleData, url: '/' + languageData + '/' + nameData.replace( '.md', '.html' ), text: bodyData});
        const escapedTitleData = markdownData.utils.escapeHtml( titleData );
        let searchLabelData = 'Search handbook';
        if ( languageData === 'ru' ){
            searchLabelData = 'Поиск по руководству';

        }
        const documentData = `<!doctype html>
<html lang="${languageData}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitleData} — Layer-Engine ${manifestData.version}</title><link rel="stylesheet" href="/assets/guide.css"><script type="module" src="/assets/guide.js"></script></head>
<body><header><a href="/${languageData}/README.html">Layer-Engine ${manifestData.version}</a> · <a href="/ru/README.html">Русский</a> · <a href="/en/README.html">English</a></header>
<div class="Layout"><nav aria-label="Documentation"><label for="search">${searchLabelData}</label><input id="search" type="search"><ul id="articles"></ul></nav><main>${htmlData}</main></div></body></html>`;
        await writeFile( path.join( outputDirectoryData, nameData.replace( '.md', '.html' ) ), documentData, 'utf8' );

    }
    await writeFile( path.join( outputDirectoryData, 'search.json' ), JSON.stringify( articlesData ), 'utf8' );

}

//Shipping only local assets and version metadata alongside the readable source articles
await cp( path.join( packageDirectoryData, 'assets' ), path.join( packageDirectoryData, 'site/assets' ), {recursive: true} );
await writeFile( path.join( packageDirectoryData, 'site/index.html' ), '<!doctype html><html lang="en"><title>Layer-Engine guide</title><a href="/ru/README.html">Русский</a> <a href="/en/README.html">English</a></html>', 'utf8' );
await writeFile( path.join( packageDirectoryData, 'manifest.json' ), JSON.stringify({version: manifestData.version, frameworkVersion: manifestData.version, languages: ['ru', 'en']}, null, 4) + '\n', 'utf8' );
