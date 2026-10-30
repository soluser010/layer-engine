/** @param {any} options */
//Function for rendering one non-modal app-branded update card through safe DOM operations
export const layerUpdateCardCreate = function( options ){
    //Keeping infrastructure nodes outside the route renderer's ownership
    const root = options.root;
    const document = root.ownerDocument;
    const browserWindow = document.defaultView;
    const manifest = options.manifest;
    const language = manifest.lang ?? document.documentElement.lang;
    const russian = /^ru(?:-|$)/iu.test(language);
    const copy = {
        loading: 'Loading and verifying update', ready: 'Update ready', applying: 'Applying update…',
        failed: 'The update could not be prepared.', busy: 'Another window has not confirmed saving. Unsaved changes may be lost.',
        update: 'Update', later: 'Later', retry: 'Retry', force: 'Update anyway', back: 'Back', files: 'files prepared'
    };
    if (russian) {
        Object.assign(copy, {loading: 'Загрузка и проверка обновления', ready: 'Обновление готово',
            applying: 'Применяем обновление…', failed: 'Не удалось подготовить обновление.',
            busy: 'Другое окно не подтвердило сохранение. Несохранённые изменения могут быть потеряны.',
            update: 'Обновить', later: 'Позже', retry: 'Повторить', force: 'Всё равно обновить',
            back: 'Назад', files: 'файлов подготовлено'});

    }
    const card = document.createElement('section');
    card.setAttribute('data-layer-update-card', '');
    card.setAttribute('aria-label', copy.ready);
    card.hidden = true;
    const content = document.createElement('div');
    content.setAttribute('data-layer-update-content', '');
    const iconBox = document.createElement('div');
    iconBox.setAttribute('data-layer-update-icon', '');
    const title = document.createElement('strong');
    title.textContent = manifest.name ?? manifest.short_name ?? 'Application';
    const initials = document.createElement('span');
    initials.textContent = String(manifest.short_name ?? title.textContent).trim().slice(0, 2).toUpperCase();
    iconBox.append(initials);
    const text = document.createElement('div');
    text.setAttribute('data-layer-update-text', '');
    const description = document.createElement('p');
    description.textContent = manifest.description ?? '';
    description.hidden = !description.textContent;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const progress = document.createElement('progress');
    progress.setAttribute('aria-label', copy.loading);
    const counter = document.createElement('span');
    counter.setAttribute('data-layer-update-counter', '');
    text.append(title, description, status, progress, counter);
    content.append(iconBox, text);
    const actions = document.createElement('div');
    actions.setAttribute('data-layer-update-actions', '');
    card.append(content, actions);
    //Keeping the card outside the route mount root so CSR/hydration and navigation never remove it
    document.body.append(card);
    let actionKey = '';
    let disposed = false;
    const presentationSync = function(){
        //Mirroring app-owned theme and viewport variables without wrapping or mutating route markup
        const computed = browserWindow.getComputedStyle(root);
        card.style.font = computed.font;
        for (const nameData of ['--layer-viewport-top', '--layer-viewport-height', '--layer-update-background',
            '--layer-update-accent', '--layer-update-text', '--layer-update-button-text', '--layer-update-radius', '--layer-update-shadow']) {
            const valueData = computed.getPropertyValue(nameData);
            if (valueData) {
                card.style.setProperty(nameData, valueData);

            } else {
                card.style.removeProperty(nameData);

            }

        }

    };
    presentationSync();
    const observer = new browserWindow.MutationObserver(presentationSync);
    observer.observe(root, {attributes: true, attributeFilter: ['style', 'class']});

    /** @param {unknown} valueData @param {string} fallbackData */
    const colorResolve = function( valueData, fallbackData ){
        //Letting the browser parse a color property; raw text never enters a stylesheet or HTML sink
        const probe = document.createElement('span');
        probe.style.color = fallbackData;
        if (typeof valueData === 'string' && valueData.length <= 64) {
            probe.style.color = valueData;

        }
        probe.hidden = true;
        card.append(probe);
        const result = browserWindow.getComputedStyle(probe).color;
        probe.remove();
        return result || fallbackData;

    };
    const contrastResolve = function(/** @type {string} */ colorData){
        //Choosing readable foreground from the browser-resolved color, including modern color spaces
        let channels = colorData.match(/[\d.]+/gu)?.map(Number) ?? [255, 255, 255];
        if (typeof browserWindow.CanvasRenderingContext2D === 'function') {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (context) {
                context.fillStyle = colorData;
                context.fillRect(0, 0, 1, 1);
                channels = Array.from(context.getImageData(0, 0, 1, 1).data);

            }

        }
        const luminance = channels.slice(0, 3).map(function(/** @type {number} */ channelData){
            //Converting sRGB into relative luminance for black/white contrast comparison
            const normalized = channelData / 255;
            if (normalized <= 0.04045) {
                return normalized / 12.92;

            }
            return Math.pow((normalized + 0.055) / 1.055, 2.4);

        });
        const value = Number(luminance[0]) * 0.2126 + Number(luminance[1]) * 0.7152 + Number(luminance[2]) * 0.0722;
        if (value > 0.179) {
            return 'rgb(0, 0, 0)';

        }
        return 'rgb(255, 255, 255)';

    };
    const background = colorResolve(manifest.background_color, 'rgb(255, 255, 255)');
    const accent = colorResolve(manifest.theme_color, 'rgb(0, 0, 0)');
    //Using internal defaults so app-defined public CSS variables retain precedence
    card.style.setProperty('--layer-update-default-background', background);
    card.style.setProperty('--layer-update-default-accent', accent);
    card.style.setProperty('--layer-update-default-text', contrastResolve(background));
    card.style.setProperty('--layer-update-default-button-text', contrastResolve(accent));

    const icons = [...(manifest.icons ?? [])];
    const requiredSize = 76 * (browserWindow.devicePixelRatio || 1);
    icons.sort(function(/** @type {any} */ first, /** @type {any} */ second){
        //Preferring a scalable icon, then the closest adequate raster without selecting monochrome badges
        const rank = function(/** @type {any} */ iconData){
            //Keeping SVG and ordinary application icons ahead of undersized or monochrome candidates
            if (iconData.type === 'image/svg+xml' || iconData.sizes === 'any') {
                return 0;

            }
            const size = Number(String(iconData.sizes).split('x')[0]);
            if (size >= requiredSize) {
                return size;

            }
            return 10000 - (size || 0);

        };
        return rank(first) - rank(second);

    });
    const icon = icons.find(function(/** @type {any} */ candidate){
        //Selecting only a same-origin manifest resource
        const url = new URL(candidate.src, browserWindow.location.href);
        return url.origin === browserWindow.location.origin && url.username === '' && url.password === '' &&
            candidate.purpose !== 'monochrome';

    });
    if (icon) {
        const image = document.createElement('img');
        image.width = image.height = 76;
        image.alt = '';
        image.src = icon.src;
        image.addEventListener('load', function(){
            //Keeping initials as a fallback until the application icon actually loads
            initials.hidden = true;

        });
        image.addEventListener('error', function(){
            //Returning to a local fallback without exposing a broken image
            image.remove();
            initials.hidden = false;

        });
        iconBox.append(image);

    }
    const execute = function(/** @type {() => unknown} */ action){
        //Letting the controller publish safe failures instead of creating an unhandled button rejection
        Promise.resolve().then(action).catch(function(actionError){
            //The shared state already contains the public category for expected update failures
            void actionError;

        });

    };
    const buttonAdd = function(/** @type {string} */ label, /** @type {() => unknown} */ action){
        //Creating native accessible controls without interpreting labels as markup
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', function(){
            //Keeping the actual action within the user's explicit button workflow
            execute(action);

        });
        actions.append(button);

    };
    const unsubscribe = options.controller.subscribe(function(/** @type {import('./application-updates.js').LayerApplicationUpdateState} */ state){
        //Changing text and counters without stealing focus or rebuilding the preserved application
        card.hidden = !state.visible;
        card.setAttribute('data-phase', state.phase);
        let message = copy.loading;
        if (state.phase === 'ready') {
            message = copy.ready;

        } else if (['preparing', 'activating'].includes(state.phase)) {
            message = copy.applying;

        } else if (state.phase === 'blocked') {
            message = copy.busy;

        } else if (state.phase === 'error') {
            message = copy.failed;

        }
        status.textContent = message;
        progress.hidden = !['downloading', 'verifying'].includes(state.phase);
        counter.hidden = progress.hidden || state.progress === null;
        if (state.progress && state.progress.totalFiles > 0) {
            progress.max = state.progress.totalFiles;
            progress.value = state.progress.completedFiles;
            counter.textContent = state.progress.completedFiles + ' / ' + state.progress.totalFiles + ' ' + copy.files;

        } else {
            progress.removeAttribute('value');

        }
        if (actionKey === state.phase) {
            return;

        }
        actionKey = state.phase;
        actions.replaceChildren();
        if (state.phase === 'ready') {
            buttonAdd(copy.update, function(){
                //Applying only after the user chose this ready release
                return options.controller.activate();

            });
            buttonAdd(copy.later, options.controller.dismiss);

        } else if (state.phase === 'error') {
            buttonAdd(copy.retry, options.controller.check);
            buttonAdd(copy.later, options.controller.dismiss);

        } else if (state.phase === 'blocked') {
            buttonAdd(copy.force, function(){
                //The warning and this separate action explicitly acknowledge possible data loss
                return options.controller.activate({force: true});

            });
            buttonAdd(copy.back, function(){
                //Returning to the non-forcing proposal without hiding it permanently
                return options.controller.check();

            });

        }

    });
    //CallBack THE OBJECT
    return Object.freeze({dispose: function(){
        //Removing only this infrastructure card and its subscription
        if (disposed) {
            return false;

        }
        disposed = true;
        observer.disconnect();
        unsubscribe();
        card.remove();
        return true;

    }});

};
