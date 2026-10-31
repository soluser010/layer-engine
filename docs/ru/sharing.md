---
title: Поделиться — отправка и приём данных
description: Web Share, Share Target, текст, ссылки и файлы в Layer PWA.
audience: beginner
order: 183
status: documented
updated: 2026-10-26
---

# Поделиться — отправка и приём данных

## Цель

Отправить текст, ссылку или фотографию из приложения через системное меню и принять данные из другого приложения. Layer предоставляет API и временное хранилище; предпросмотр, выбор получателя, черновик и загрузку на сервер реализует приложение.

## Оглавление

- [Отправка наружу](#отправка-наружу)
- [Настройка приёма](#настройка-приёма)
- [Чтение текста и файлов](#чтение-текста-и-файлов)
- [Срок хранения и ограничения](#срок-хранения-и-ограничения)
- [Ошибки и проверка](#ошибки-и-проверка)

## Отправка наружу

Используйте `window.layer.pwa.share`. Это browser API: не вызывайте его при SSR. `send()` открывает системное меню, а получателя выбирает пользователь. Вызывайте его непосредственно из обработчика нажатия, без предварительного сетевого запроса: браузеру требуется пользовательская активация. Файл подготовьте до нажатия. [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API).

Например, создайте `src/lib/share.js`. Это вспомогательная функция приложения, а не дополнительный метод Layer:

```js
export async function shareSend( shareData ){
    //Checking browser support for the exact payload before opening native UI.
    const shareApiData = window.layer.pwa.share;

    if ( shareApiData.getCapability().supported === false || shareApiData.canSend( shareData ) === false ){
        return {status: 'unavailable'};

    }

    try {
        //Opening the platform picker within the original user action.
        await shareApiData.send( shareData );
        return {status: 'completed'};

    } catch( shareError ){
        //Treating user cancellation separately from a failed browser request.
        if ( shareError?.name === 'AbortError' ){
            return {status: 'cancelled'};

        }

        return {status: 'error'};

    }

}
```

В обработчике кнопки для текста и ссылки:

```js
const resultData = await shareSend({
    title: 'Моя публикация',
    text: 'Посмотрите эту публикацию',
    url: 'https://example.com/posts/123'
});
```

Для фотографии `photoFileData` должен быть заранее полученным объектом `File`, например из `input.files[0]`:

```js
const resultData = await shareSend({
    title: 'Фотография',
    files: [photoFileData]
});
```

Эти фрагменты выполняются внутри browser event handler; функцию импортируют из `src/lib/share.js`. В `.layer.js` подключите обработчик через `@click=${handler}`. По `resultData.status` обновите интерфейс. При `unavailable` предложите копирование ссылки или скачивание файла. `completed` означает завершение вызова браузера, а не подтверждение доставки адресату. Layer не выбирает сторонний мессенджер и не обходит отмену пользователя.

## Настройка приёма

Добавьте `share_target` в существующий `public/manifest.webmanifest`, сохранив остальные поля manifest:

```json
{
    "share_target": {
        "action": "/share/",
        "method": "POST",
        "enctype": "multipart/form-data",
        "params": {
            "title": "title",
            "text": "text",
            "url": "url",
            "files": [
                {
                    "name": "photos",
                    "accept": ["image/jpeg", "image/png", "image/webp"]
                }
            ]
        }
    }
}
```

Это фрагмент для объединения с manifest, не его полная замена. Создайте страницу `src/pages/share/index.layer.js`, соответствующую `/share/`; action должен находиться в scope приложения. Для приёма только текста удалите `params.files`; POST может использовать `application/x-www-form-urlencoded`. Приведённый multipart-вариант принимает и текст без файлов.

После сборки Layer подключает обработчик **точного POST action** в своём Service Worker. Он проверяет поля и лимиты, сохраняет данные в IndexedDB и отвечает перенаправлением 303 на `/share/?layerShareId=...`. Runtime связывает этот идентификатор с `window.layer.pwa.shareTarget`. Тело POST не отправляется автоматически в прикладной `POST /api`. Описанный inbox API подключается для POST, не для GET Share Target.

Для системного приёма нужна установленная PWA в поддерживающей платформе, HTTPS и действующий Service Worker. После изменения manifest пересоберите приложение и проверьте обновление регистрации на устройстве; для теста может понадобиться переустановка. Поддержка исходящего Share не гарантирует поддержку входящего Share Target. [Share Target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target).

## Чтение текста и файлов

На странице приёма, после готовности browser runtime, вызовите helper один раз. Не запускайте его в SSR или из повторного render/effect:

```js
async function incomingShareRead(){
    //Checking generated POST inbox support before consuming the pending share.
    const inboxApiData = window.layer.pwa.shareTarget;

    if ( inboxApiData.getCapability().supported === false ){
        return null;

    }

    //Consuming the current layerShareId once; absent or expired records return null.
    const sharedData = await inboxApiData.consume();

    if ( sharedData === null ){
        return null;

    }

    //Converting received Blob records into File objects for application workflows.
    const filesData = sharedData.files.map(function sharedFileCreate( fileData ){
        //Preserving file metadata without treating the filename as a storage path.
        return new File([fileData.blob], fileData.name, {
            type: fileData.type,
            lastModified: fileData.lastModified
        });

    });

    return {
        title: sharedData.title,
        text: sharedData.text,
        url: sharedData.url,
        files: filesData
    };

}
```

Ожидаемый результат — данные для экрана предпросмотра. `title`, `text`, `url` могут быть `null`, а `files` — пустым. Исходный результат `consume()` также содержит `shareId`, `createdAt`, `expiresAt`; каждый файловый объект содержит `field`, `name`, `type`, `size`, `lastModified`, `blob`.

`consume()` атомарно читает и удаляет запись, затем runtime убирает `layerShareId` из текущего URL. Повторный вызов не возвращает тот же файл. Сохраните полученные данные в собственный IndexedDB-черновик до перехода на другой экран; между consume и сохранением нет общей транзакции. Не считайте inbox надёжным долгосрочным черновиком.

Доступны также `pendingIdGet()` и `discard(id?)`; `consume(id?)` принимает явный идентификатор. `discard()` удаляет текущую запись без чтения и возвращает `boolean`. `getCapability()` подтверждает подключение generated inbox, а не регистрацию приложения в системном меню ОС.

Для фото создайте `URL.createObjectURL(file)` и освободите URL через `URL.revokeObjectURL(url)` при удалении предпросмотра/unmount. Выводите текст через экранированные интерполяции, не `innerHTML`. URL, имя и MIME остаются недоверенными данными; `accept` не проверяет содержимое файла антивирусом.

Если нужен вход, предусмотрите публичный экран приёма с сохранением черновика до авторизации: редирект guard может потерять `layerShareId`. Сам inbox не требует сессии и не даёт прав на загрузку. После выбора получателя и подтверждения выполняйте свою авторизованную загрузку; на сервере повторно проверяйте права, размер и тип. Logout очищает временный inbox. Не привязывайте входящие файлы к аккаунту автоматически.

## Срок хранения и ограничения

| Ограничение generated inbox | Значение по умолчанию |
|---|---|
| Весь запрос, включая multipart overhead | 16 МиБ |
| Один файл | 8 МиБ |
| Число файлов | 8 |
| Каждое текстовое поле | 64 КиБ UTF-8 |
| Ожидающие записи | 64 |
| Срок доступности записи | 10 минут |

Это defaults низкоуровневого `layerWorkerShareTargetCaptureCreate`; штатный config приложения не предоставляет отдельного блока для их изменения. Истёкшая запись не выдаётся; физическая очистка выполняется при работе inbox, а не гарантированным фоновым таймером.

Отдельный `window.layer.pwa.files.setConsumer(handler)` обслуживает File Handling/«Открыть с помощью» и передаёт `FileSystemHandle[]`. Это другой сценарий: Share Target возвращает Blob-записи через `consume()`. Готовых визуальных компонентов выбора чата и прикрепления Layer не добавляет.

## Ошибки и проверка

- Исходящий `send()` без поддержки отклоняется с `PWA_CAPABILITY_UNAVAILABLE`; неверные данные — `TypeError`. Ошибки браузера, включая `AbortError`, передаются вызывающему коду.
- Входящий `consume()` возвращает `null`, если записи нет, она истекла или уже получена. Неправильный ID даёт `TypeError`; сбои IndexedDB могут отклонить Promise — обработайте их на странице.
- Ошибка при захвате POST может возникнуть до открытия страницы: worker возвращает безопасный HTTP-ответ. Среди кодов capture: `SHARE_TARGET_SIZE_EXCEEDED`, `SHARE_TARGET_FILE_INVALID`, `SHARE_TARGET_FIELD_INVALID`, `SHARE_TARGET_INBOX_FULL`, `SHARE_TARGET_STORAGE_FAILED`. Страница не получает автоматически объект этой ошибки через `consume()`.
- Не храните входящий payload в query string и не публикуйте фото автоматически. Для неподдерживаемой платформы оставьте обычные ввод текста и выбор файлов.

Проверьте на реальном устройстве: отправку ссылки, отправку фото, отмену меню, приём одного/нескольких файлов, приём только текста, повторный consume, истечение срока, отсутствие сети и сценарий авторизации. Браузерные тесты inbox не доказывают регистрацию в меню ОС. При повторном входящем запуске обработайте новый `layerShareId`, даже если страница уже открыта; не полагайтесь только на первый mount.

Далее: [PWA и Service Worker](pwa-service-worker.md), [хранение и offline](offline-realtime.md), [входящие ссылки](links-navigation.md), [Layer Auth](layer-auth.md).
