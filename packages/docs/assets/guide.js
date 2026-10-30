//Loading the local search index without sending queries outside this machine
const languageData = globalThis.document.documentElement.lang;
const responseData = await fetch( '/' + languageData + '/search.json' );
if ( !responseData.ok ){
    throw new Error( 'The local handbook index is unavailable.' );

}
const articlesData = await responseData.json();
const listData = globalThis.document.querySelector( '#articles' );
const searchData = globalThis.document.querySelector( '#search' );

//Rendering links through DOM APIs so search text never becomes executable markup
const resultsRender = function(){
    //Filtering the installed articles and replacing only the navigation list
    const queryData = searchData.value.trim().toLocaleLowerCase();
    listData.replaceChildren();
    for ( const articleData of articlesData ){
        if ( !articleData.text.toLocaleLowerCase().includes( queryData ) && !articleData.title.toLocaleLowerCase().includes( queryData ) ){
            continue;

        }
        const itemData = globalThis.document.createElement( 'li' );
        const linkData = globalThis.document.createElement( 'a' );
        linkData.href = articleData.url;
        linkData.textContent = articleData.title;
        itemData.append( linkData );
        listData.append( itemData );

    }

};
searchData.addEventListener( 'input', resultsRender );
resultsRender();
