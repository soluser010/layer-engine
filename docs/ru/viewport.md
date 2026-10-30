---
title: Viewport, клавиатура и оболочка приложения
description: Нативно-подобное PWA поведение, поиск, composer, scroll anchors и context.viewport.
audience: all
order: 105
status: release-candidate
updated: 2026-10-27
---

# Viewport, клавиатура и оболочка приложения

## Цель

Разрабатывать PWA как приложение: стабильная оболочка, внутренние scroll-регионы, видимые поля ввода и сохранение положения при появлении клавиатуры. Переключателя document/app/overlay нет. Внешний вид и расположение панелей принадлежат приложению.

## Базовое поведение

`layer build` добавляет внешний `/_layer/viewport.css`, включает его в integrity/precache и нормализует viewport meta: `width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-visual`. Оболочка по умолчанию запрашивает фиксированный масштаб 1×; CSS загружается до route styles, inline stylesheet не нужен.

`html/body` не являются основным scroller. `[data-layer-root]` занимает доступную область, учитывает safe-area и сам прокручивается, если приложение не объявило внутренний scroller. Для шапки/содержимого/composer используйте grid или flex с `min-height: 0` на рабочей области. Layer не создаёт визуальные панели самостоятельно.

При клавиатуре рабочая область по умолчанию уменьшается. Browser runtime создаёт один `layerViewportCreate` на документ; компоненты получают отдельные lifecycle owners. `resize`, `scroll` VisualViewport и focus notifications объединяются через requestAnimationFrame, без polling и полной перерисовки документа.

## Поиск: сохранить размер и прокрутку

```html
<input
    type="search"
    aria-label="Поиск"
    data-layer-keyboard="preserve"
    data-layer-scroll="preserve"
>
```

Ожидаемый результат: оболочка сохраняет высоту до открытия клавиатуры; Layer не прокручивает поле дополнительно. Нижние элементы могут быть перекрыты клавиатурой — это намеренное поведение. Пользователь всё ещё может прокручивать содержимое. Safari может самостоятельно сдвинуть видимую область: preserve не запрещает системное поведение браузера.

## Чат: уменьшить область и сохранить composer

Пример страницы `src/pages/chat.layer.js`:

```js
import {css, html, layerComponentCreate, layerSignalCreate} from '@solcorp/layer';

export const styles = css`
    .chat {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        height: 100%;
    }
`;

export default layerComponentCreate(function Chat(){
    //Creating a draft without replacing the active textarea during updates
    const draftSignal = layerSignalCreate( '' );

    //Rendering independently scrollable messages and an ordinary HTML composer
    return html`
        <section class="chat">
            <header>Сообщения</header>
            <div data-layer-scroll-region="messages">
                <p data-layer-scroll-key="message-1">Первое сообщение</p>
            </div>
            <footer>
                <textarea aria-label="Сообщение" l-model=${draftSignal}
                    data-layer-keyboard="resize" data-layer-focus="retain"></textarea>
                <button type="button" data-layer-focus-retain>Вложение</button>
            </footer>
        </section>
    `;

});
```

Ожидаемый результат: keyboard resize уменьшает список, а composer остаётся видимым. `resize` можно не указывать: это default. Кнопка в примере только демонстрирует сохранение фокуса; приложение добавляет свой `@click` handler.

`data-layer-focus="retain"` не создаёт focus trap. Стабильный DOM сохраняет selection; pointerdown на явно помеченной `data-layer-focus-retain` кнопке не переводит фокус. Другие поля, Tab, пользовательский blur и переходы продолжают работать. Клавиатура не открывается повторно принудительно. Замена textarea через when/repeat с другим key не сохраняет её identity.

## Уменьшить только один регион

```html
<section data-layer-viewport="chat">
    <textarea
        aria-label="Сообщение"
        data-layer-keyboard="resize"
        data-layer-viewport-target="chat"
    ></textarea>
</section>
```

Корневая оболочка сохраняет размер; выбранный регион получает `--layer-region-height`. CSS приложения определяет, как его дети делят пространство. Имя должно указывать ровно на один регион внутри app root. Отсутствующий/неоднозначный declarative target безопасно возвращает обработку к корневой оболочке; imperative lookup возвращает TypeError. Не используйте это как способ скрыть ошибку именования.

## Context API

В обычном generated browser host доступен `context.viewport`; в SSR или manual host без `layer.viewport` он равен `null`. DOM API вызывайте в `context.onMount`/`onHydrate` или browser event handlers, не в server setup.

| Метод / поле | Назначение и контракт |
| --- | --- |
| `state.get()`, `state.peek()` | Read-only локальный signal. `get` отслеживает зависимость; `peek` читает без неё. |
| `getState()` | Последний immutable snapshot без нового layout read. |
| `subscribe(listener)` | Callback только при изменении snapshot; возвращает unsubscribe. Начального callback нет: прочитайте getState. |
| `registerRegion(name, element, kind)` | `kind`: `viewport` по умолчанию или `scroll`. Возвращает idempotent unregister; owner автоматически очищает регистрацию. |
| `ensureVisible(element)` | Минимально прокручивает ближайший scroll region; возвращает boolean изменения позиции. При scroll=preserve или zoom не прокручивает. |
| `focus(element)` | `focus({preventScroll:true})`; возвращает, получил ли элемент фокус. Не гарантирует открытие экранной клавиатуры. |
| `captureAnchor(name, element?)` | Сохраняет Element identity и смещение; без element выбирает первый видимый data-layer-scroll-key. |
| `restoreAnchor(anchor)` | Восстанавливает относительное положение; при удалённом item использует прежние координаты. |
| `dispose()` | Ранняя очистка owner; повторный вызов возвращает false. Компонент вызывает её автоматически при unmount. |

Имена регионов: ASCII letter, затем letters/digits/underscore/hyphen, максимум 64 символа. Элементы должны быть подключены и принадлежать текущему app root. Регистрация не меняет размеры посторонних документов.

Для инфраструктуры `window.layer.viewport` предоставляет shared controller. Не вызывайте его `dispose` из компонента: это прекращает работу всего viewport. При manual mount предоставьте `'layer.viewport': controller` через context; компонент создаст свой owner самостоятельно.

### Пример scroll anchor

```js
const messageAnchor = context.viewport.captureAnchor( 'messages' );

//Adding older messages through the application's own state and waiting for its renderer commit
await olderMessagesLoadAndRender();

//Restoring the same visible item after its vertical position changes
context.viewport.restoreAnchor( messageAnchor );
```

`olderMessagesLoadAndRender` — функция приложения, не API Layer. Автоматическое сохранение при изменении viewport не заставляет чат переходить вниз при новых сообщениях. Follow-bottom policy остаётся логикой приложения. Не храните anchor после unmount: он содержит DOM references.

## Keyboard API

`context.keyboard` — lifecycle-owned API компонента. В SSR и manual host без viewport provider он равен `null`. Для инфраструктуры доступен `window.layer.keyboard`. Оба используют существующий viewport; `resize`, `preserve` и scroll policies продолжают действовать.

| Метод | Контракт |
| --- | --- |
| `show(field)` | Синхронно запрашивает фокус/клавиатуру для DOM input, textarea или contenteditable. Передавайте `reference.current`, не сам ref, ID или selector. |
| `hide()` | Запрашивает скрытие для активного поля приложения и снимает фокус. Чужие поля не затрагиваются; автоматического refocus нет. |
| `getState()` | Immutable snapshot: `source`, `visible`, `height`, `rect`, как в `viewport.getState().keyboard`. |
| `subscribe(listener)` | Немедленный snapshot, затем изменения клавиатуры. Возвращает unsubscribe; unmount освобождает подписку. Ошибка listener принадлежит приложению. |
| `getCapability()` | `strategy: native/focus`, `nativeControl`, `requiresUserInteraction: true`, `visibilitySource`. Возможность не гарантирует открытие. |

`show()` и `hide()` возвращают `{status: 'requested' | 'blocked', focused: boolean, reason: string | null}`. `focused` относится к целевому полю, не к клавиатуре. `requested` не означает, что клавиатура появилась; `visible: null` означает неизвестное состояние. Snapshot обновляется при измерении viewport, не синхронно вслед за запросом.

### Открыть и закрыть клавиатуру кнопками

```js
import {html, layerComponentCreate, layerReferenceCreate} from '@solcorp/layer';

export default layerComponentCreate(function Composer( _properties, context ){
    //Holding the actual input node without querying the whole document
    const messageReference = layerReferenceCreate();
    const messageFocus = function(){
        //Keeping the focus request inside the user action, before any await or timer
        if ( context.keyboard !== null && messageReference.current !== null ){
            context.keyboard.show( messageReference.current );

        }

    };
    const keyboardDismiss = function(){
        //Requesting dismissal while the retain button leaves the field focused until click
        context.keyboard?.hide();

    };

    //Rendering ordinary fields; no hidden input is created by Layer
    return html`
        <textarea ref=${messageReference} aria-label="Сообщение"
            data-layer-keyboard="resize" data-layer-focus="retain"></textarea>
        <button type="button" @click=${messageFocus}>Написать</button>
        <button type="button" data-layer-focus-retain @click=${keyboardDismiss}>Скрыть клавиатуру</button>
    `;

});
```

`data-layer-focus-retain` у кнопки закрытия сохраняет фокус поля до click: иначе обычное нажатие кнопки может снять его раньше вызова `hide()`. Не вызывайте `show()` автоматически при mount: Safari может принять фокус, но не открыть клавиатуру. Поле должно уже находиться в DOM во время действия пользователя.

### Переключить ввод на поиск

Для поля поиска задайте `type="search"`, `enterkeyhint="search"`, `data-layer-keyboard="preserve"` и при необходимости `data-layer-scroll="preserve"`. В обработчике кнопки вызывайте:

```js
//searchReference is an application ref bound to the existing search input
const requestResult = context.keyboard.show( searchReference.current );
if ( requestResult.status === 'blocked' ){
    //Displaying application-owned feedback without retrying focus in a loop
    searchHint.set( requestResult.reason );

}
```

`searchReference` и `searchHint` — ref и signal приложения. Настройки раскладки задаются HTML-атрибутами `type`, `inputmode`, `enterkeyhint`, `autocomplete`, а не аргументами `show()`.

### Наблюдать за состоянием

```js
//keyboardStatus is an application signal; subscribing at mount keeps SSR side-effect free
context.onMount(function(){
    //The component owner releases this subscription on unmount
    context.keyboard.subscribe(function( state ){
        //Preserving unknown rather than presenting it as a closed keyboard
        keyboardStatus.set( state.visible );

    });

});
```

Этот пример предполагает штатный browser host и созданный приложением `keyboardStatus`. При manual host проверяйте `context.keyboard !== null`. Для ранней отписки сохраните возвращённую функцию. `height` — нижнее перекрытие области, не гарантированная физическая высота клавиатуры.

### Ограничения и ошибки

Скрытые/inert поля дают `field-unavailable`, readonly/disabled и неподдерживаемые типы — `field-not-editable`, `inputmode="none"` — `inputmode-none`, отказ фокуса — `focus-refused`. Для `hide()` без активного редактируемого поля возвращается `no-active-field`, при отказе blur — `blur-refused`. Все эти причины сопровождаются `status: 'blocked'`. Некорректный аргумент, detached/foreign element или вызов после disposal дают `TypeError`.

В Chromium при HTTPS, наличии методов и явном `virtualkeyboardpolicy="manual"` у поля Layer дополнительно использует native show/hide; без этого работает обычный focus/blur. Не устанавливайте manual policy без необходимости. Layer не меняет policy скрыто, а отказ native API не отменяет fallback. Safari использует фокус и доступную геометрию; неизвестная видимость не превращается в подтверждение. Аппаратная клавиатура может исключать появление экранной.

## Snapshot и CSS

Snapshot содержит `layout` и `visual` (`width`, `height`, `offsetTop`, `offsetLeft`, `scale`), `policy`, `availableHeight` и `keyboard` (`source`, `visible`, `height`, `rect`). `source` — native/estimated/unknown; unknown означает `visible: null`. `rect` содержит x/y/width/height только при native API, иначе null. `height` — перекрытие рабочей области снизу, а не гарантированная физическая высота любой клавиатуры. Floating keyboard может иметь visible=true и height=0.

CSS на root: `--layer-viewport-height`, `--layer-viewport-top`, `--layer-keyboard-height`, `--layer-safe-area-top/right/bottom/left`. Safe-area уже включена в root padding: не добавляйте её вторично во вложенных панелях. Route CSS может переопределить оформление оболочки. Не применяйте `touch-action: none` ко всему приложению: это отключит обычную touch-прокрутку. Используйте его только для собственных интерактивных областей, например photo viewer.

## Масштаб приложения и увеличение фото

На html/body, root и штатных scroll regions задан `touch-action: pan-x pan-y`: обычная прокрутка разрешена, browser pinch zoom не включён. `manipulation` здесь не подходит, потому что разрешает pinch zoom. Контроллер также отменяет cancelable multi-touch, WebKit gesturestart/gesturechange и Ctrl-wheel defaults внутри app root. Обычный wheel, один палец, clicks, text selection и pointer events не поглощаются; stopPropagation не вызывается. Эти listeners освобождаются вместе с viewport controller, не при unmount каждой страницы.

Увеличение фото — задача компонента, а не изменение масштаба документа. Заранее объявите локальную поверхность с собственными жестами:

```html
<section class="PhotoViewer" aria-label="Просмотр фото">
    <img class="PhotoViewer__Image" src="/assets/photo.webp" alt="Фото" draggable="false">
</section>
```

```css
/* Giving the photo component its own pointers without native document pan or zoom */
.PhotoViewer {
    width: 100%;
    height: 100%;
    overflow: hidden;
    touch-action: none;
}

/* Scaling only the image; the app shell keeps its original coordinate system */
.PhotoViewer__Image {
    max-width: 100%;
    max-height: 100%;
    transform: scale(var(--photo-scale, 1));
    transform-origin: center;
}
```

Компонент или его gesture library отслеживает Pointer Events, рассчитывает расстояние между двумя указателями и задаёт `--photo-scale` у картинки через `element.style.setProperty`. Диапазон, pan, reset и кнопки +/- определяет приложение. `touch-action` следует объявлять до начала жеста, а не менять в pointerdown. События доходят до обработчиков приложения даже когда Layer отменяет browser default; `defaultPrevented` не означает, что gesture должен быть отброшен компонентом.

Это ограничение browser gestures, не абсолютная блокировка всех видов увеличения. Safari может игнорировать viewport meta; браузерные accessibility overrides, меню/клавиатурный zoom и системная лупа не отключаются и не сбрасываются принудительно. Вложенные чужие iframe имеют собственные event boundaries. При принудительном изменении visual scale старый geometry fallback остаётся: увеличение не считается открытием клавиатуры. Ограничение page zoom ухудшает доступность: предусматривайте читаемый текст, адаптивную вёрстку и прикладное увеличение контента/размера текста. [Viewport ограничения](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport), [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).

## Browser support и ограничения

- Chromium: при доступном VirtualKeyboard API Layer приобретает overlaysContent и использует native boundingRect; при disposal восстанавливает прежнее значение. Не меняйте overlaysContent параллельно из приложения.
- Safari/WebKit: VisualViewport fallback учитывает высоту, смещение и scale. Разница высот при активном editable поле — оценка, не точный keyboard detector. WebKit gesture cancellation — best effort; принудительный browser zoom не уменьшает CSS-оболочку.
- Без VisualViewport/VirtualKeyboard: window resize fallback; неизвестная клавиатура обозначается явно.
- Поворот/изменение ширины обновляет baseline; скрытая/аппаратная клавиатура не требует искусственного inset.

Справочники: [VirtualKeyboard](https://developer.chrome.com/docs/web-platform/virtual-keyboard), [VisualViewport](https://www.w3.org/TR/cssom-view/#the-visualviewport-interface), [WebKit interactive-widget](https://bugs.webkit.org/show_bug.cgi?id=259770).

## Фокус, прокрутка и поведение на iOS

Layer реагирует на изменение размеров и фокуса, но не перетягивает поле обратно при изменении только `VisualViewport.offsetTop/offsetLeft`: такая смена координат может сопровождать ручную прокрутку. Новое editable-поле раскрывается при смене фокуса даже при неизменном snapshot. `data-layer-scroll="preserve"` отключает автоматическое раскрытие. Readonly textarea и disabled-поля не считаются editable; изменение этих атрибутов отслеживается без повторного focus.

При изменении размеров окна вложенный `data-layer-viewport` заново измеряется в оболочке без перекрытия клавиатурой. Поворот и возврат в portrait не должны оставлять старую высоту региона. `ensureVisible` прокручивает только app root или принадлежащий ему scroll region; внешний контейнер приложения не затрагивается. Поле, которое выше всей видимой области и уже её перекрывает, автоматически не двигается: точное положение caret внутри большого textarea остаётся задачей браузера.

`context.viewport.focus(element)` запрашивает фокус без дополнительной прокрутки и возвращает, получил ли его элемент. Возвращённое `true` не подтверждает открытие экранной клавиатуры. Вызывайте метод непосредственно из обработчика нажатия пользователя, пока поле уже присутствует в DOM; перенос вызова после сетевого запроса или таймера может лишить Safari возможности открыть клавиатуру.

Для поведения поля используйте стандартные `type`, `inputmode`, `enterkeyhint` и `autocomplete`. Они подсказывают браузеру раскладку и назначение ввода, но не дают приложению полного контроля над системной клавиатурой. Для единых запросов показа/скрытия используйте `context.keyboard`; окончательное поведение клавиатуры определяет браузер.

Проверяйте интерфейс своего приложения и во вкладке Safari, и после установки на домашний экран: доступная область и панели браузера отличаются. Для iPad с плавающей клавиатурой точная перекрытая область может быть неизвестна; не заменяйте `keyboard.visible === null` утверждением, что клавиатура закрыта.

## Типовые ошибки и failure contract

- `height: 100vh` во внутренней странице игнорирует bounded app root; используйте 100% и minmax(0, 1fr).
- Двойное вычитание keyboard height: controller уже рассчитывает доступную область.
- `focus=retain` без помеченной кнопки не означает запрет blur.
- Detached/foreign elements, неверные/дублированные imperative registrations, вызовы disposed owner дают TypeError до DOM изменения.
- Geometry listener не должен бросать исключения; error handling пользовательского callback принадлежит приложению.
- SSR не использует browser geometry; hydrate связывает существующий DOM, geometry меняет CSS и только зависимые signals.
- После обновления существующего приложения пересоберите dist: body/window scroll заменяется root/region scroll. Для программной прокрутки используйте собственный scroll ref или viewport anchor API.

Далее: [Context API](context-api.md), [routing/SSR](routing-ssr.md), [browser support](browser-support.md).
