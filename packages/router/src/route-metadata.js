const metadataEntryDescriptors = Object.freeze([
    Object.freeze({key: 'description', element: 'meta', identity: 'name', identityValue: 'description', value: 'content'}),
    Object.freeze({key: 'robots', element: 'meta', identity: 'name', identityValue: 'robots', value: 'content'}),
    Object.freeze({key: 'author', element: 'meta', identity: 'name', identityValue: 'author', value: 'content'}),
    Object.freeze({key: 'keywords', element: 'meta', identity: 'name', identityValue: 'keywords', value: 'content'}),
    Object.freeze({key: 'themeColor', element: 'meta', identity: 'name', identityValue: 'theme-color', value: 'content'}),
    Object.freeze({key: 'colorScheme', element: 'meta', identity: 'name', identityValue: 'color-scheme', value: 'content'}),
    Object.freeze({key: 'applicationName', element: 'meta', identity: 'name', identityValue: 'application-name', value: 'content'}),
    Object.freeze({key: 'canonical', element: 'link', identity: 'rel', identityValue: 'canonical', value: 'href'}),
    Object.freeze({key: 'openGraphTitle', element: 'meta', identity: 'property', identityValue: 'og:title', value: 'content'}),
    Object.freeze({key: 'openGraphDescription', element: 'meta', identity: 'property', identityValue: 'og:description', value: 'content'}),
    Object.freeze({key: 'openGraphType', element: 'meta', identity: 'property', identityValue: 'og:type', value: 'content'}),
    Object.freeze({key: 'openGraphUrl', element: 'meta', identity: 'property', identityValue: 'og:url', value: 'content'}),
    Object.freeze({key: 'openGraphImage', element: 'meta', identity: 'property', identityValue: 'og:image', value: 'content'}),
    Object.freeze({key: 'openGraphImageAlt', element: 'meta', identity: 'property', identityValue: 'og:image:alt', value: 'content'}),
    Object.freeze({key: 'openGraphSiteName', element: 'meta', identity: 'property', identityValue: 'og:site_name', value: 'content'}),
    Object.freeze({key: 'openGraphLocale', element: 'meta', identity: 'property', identityValue: 'og:locale', value: 'content'}),
    Object.freeze({key: 'twitterCard', element: 'meta', identity: 'name', identityValue: 'twitter:card', value: 'content'}),
    Object.freeze({key: 'twitterTitle', element: 'meta', identity: 'name', identityValue: 'twitter:title', value: 'content'}),
    Object.freeze({key: 'twitterDescription', element: 'meta', identity: 'name', identityValue: 'twitter:description', value: 'content'}),
    Object.freeze({key: 'twitterImage', element: 'meta', identity: 'name', identityValue: 'twitter:image', value: 'content'}),
    Object.freeze({key: 'twitterImageAlt', element: 'meta', identity: 'name', identityValue: 'twitter:image:alt', value: 'content'})
]);

/**
 * Creates a DOM-independent representation used by browser navigation and production SSR.
 *
 * @param {Readonly<Record<string, string>>} metadataData
 */
export function layerRouteMetadataDocumentCreate(metadataData) {
    const resolvedMetadata = {
        ...metadataData
    };
    const openGraphDeclared = Object.keys(metadataData).some(function openGraphFieldFind(fieldName) {
        //Recognizing an explicit Open Graph group before applying shared SEO fallbacks.
        return fieldName.startsWith('openGraph');

    });
    const twitterDeclared = Object.keys(metadataData).some(function twitterFieldFind(fieldName) {
        //Recognizing an explicit Twitter card group before applying shared SEO fallbacks.
        return fieldName.startsWith('twitter');

    });

    if (openGraphDeclared) {
        if (resolvedMetadata.openGraphTitle === undefined && metadataData.title !== undefined) {
            resolvedMetadata.openGraphTitle = metadataData.title;

        }

        if (resolvedMetadata.openGraphDescription === undefined && metadataData.description !== undefined) {
            resolvedMetadata.openGraphDescription = metadataData.description;

        }

        if (resolvedMetadata.openGraphUrl === undefined && metadataData.canonical !== undefined) {
            resolvedMetadata.openGraphUrl = metadataData.canonical;

        }

    }

    if (twitterDeclared) {
        if (resolvedMetadata.twitterTitle === undefined && metadataData.title !== undefined) {
            resolvedMetadata.twitterTitle = metadataData.title;

        }

        if (resolvedMetadata.twitterDescription === undefined && metadataData.description !== undefined) {
            resolvedMetadata.twitterDescription = metadataData.description;

        }

        if (resolvedMetadata.twitterImage === undefined && metadataData.openGraphImage !== undefined) {
            resolvedMetadata.twitterImage = metadataData.openGraphImage;

        }

        if (resolvedMetadata.twitterImageAlt === undefined && metadataData.openGraphImageAlt !== undefined) {
            resolvedMetadata.twitterImageAlt = metadataData.openGraphImageAlt;

        }

    }

    const entryData = [];

    for (const descriptorData of metadataEntryDescriptors) {
        const metadataValue = resolvedMetadata[descriptorData.key];

        if (typeof metadataValue !== 'string') {
            continue;

        }

        entryData.push(Object.freeze({
            ...descriptorData,
            valueData: metadataValue
        }));

    }

    return Object.freeze({
        title: metadataData.title ?? null,
        language: metadataData.language ?? null,
        direction: metadataData.direction ?? null,
        entries: Object.freeze(entryData)
    });

}
