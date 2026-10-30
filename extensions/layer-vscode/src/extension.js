const childProcess = require('node:child_process');
const path = require('node:path');
const vscode = require('vscode');
const {
    embeddedCompletionProvide,
    embeddedDiagnosticsProvide,
    embeddedHoverProvide,
    embeddedLanguageCacheClear
} = require('./embedded-language-service.js');
const {layerFileDecorationDataCreate} = require('./file-decoration.js');

const outputByteLimit = 5 * 1024 * 1024;

/**
 * @param {vscode.TextDocument} documentData
 */
function layerDocumentCheck(documentData) {
    //Keeping the native JavaScript language service for canonical component files.
    return (documentData.languageId === 'javascript' && documentData.fileName.endsWith('.layer.js')) ||
        documentData.fileName.replaceAll('\\', '/').endsWith('/src/operations.js');

}

/**
 * @param {vscode.TextDocument} documentData
 */
function layerEmbeddedDocumentCheck(documentData) {
    //Keeping embedded assistance inside canonical Layer component files.
    return documentData.languageId === 'javascript' && documentData.fileName.endsWith('.layer.js');

}

/**
 * @param {{line: number, character: number}} positionData
 */
function vscodePositionCreate(positionData) {
    //Converting one LSP position into the public VS Code position contract.
    return new vscode.Position(Number(positionData.line), Number(positionData.character));

}

/**
 * @param {{start: {line: number, character: number}, end: {line: number, character: number}}} rangeData
 */
function vscodeRangeCreate(rangeData) {
    //Converting one LSP range without changing embedded source coordinates.
    return new vscode.Range(
        vscodePositionCreate(rangeData.start),
        vscodePositionCreate(rangeData.end)
    );

}

/**
 * @param {unknown} documentationData
 */
function vscodeDocumentationCreate(documentationData) {
    if (typeof documentationData === 'string') {
        return new vscode.MarkdownString(documentationData);

    }

    if (documentationData !== null && typeof documentationData === 'object' &&
        typeof /** @type {{value?: unknown}} */ (documentationData).value === 'string') {
        const markdownData = new vscode.MarkdownString(
            /** @type {{value: string}} */ (documentationData).value
        );
        markdownData.isTrusted = false;
        markdownData.supportHtml = false;

        return markdownData;

    }

    return undefined;

}

/**
 * @param {any} completionData
 */
function vscodeCompletionItemCreate(completionData) {
    const completionItem = new vscode.CompletionItem(
        completionData.label,
        completionData.kind
    );
    const insertionData = completionData.textEdit?.newText ?? completionData.insertText ?? completionData.label;

    //Preserving snippet tab stops while mapping standard language service edits.
    if (completionData.insertTextFormat === 2) {
        completionItem.insertText = new vscode.SnippetString(String(insertionData));

    } else {
        completionItem.insertText = String(insertionData);

    }

    if (completionData.textEdit?.range !== undefined) {
        completionItem.range = vscodeRangeCreate(completionData.textEdit.range);

    } else if (completionData.textEdit?.insert !== undefined && completionData.textEdit?.replace !== undefined) {
        completionItem.range = {
            inserting: vscodeRangeCreate(completionData.textEdit.insert),
            replacing: vscodeRangeCreate(completionData.textEdit.replace)
        };

    }

    completionItem.detail = completionData.detail;
    completionItem.documentation = vscodeDocumentationCreate(completionData.documentation);
    completionItem.filterText = completionData.filterText;
    completionItem.sortText = completionData.sortText;
    completionItem.preselect = completionData.preselect;

    return completionItem;

}

/**
 * @param {unknown} contentsData
 */
function vscodeHoverContentsCreate(contentsData) {
    let contentRecords = [contentsData];

    if (Array.isArray(contentsData)) {
        //Using the complete ordered hover record collection from the language service.
        contentRecords = contentsData;

    }

    const markdownRecords = [];

    for (const contentData of contentRecords) {
        if (typeof contentData === 'string') {
            markdownRecords.push(new vscode.MarkdownString(contentData));
            continue;

        }

        if (contentData !== null && typeof contentData === 'object' &&
            typeof /** @type {{value?: unknown}} */ (contentData).value === 'string') {
            const markdownData = new vscode.MarkdownString();
            const contentObjectData = /** @type {{value: string, language?: string, kind?: string}} */ (contentData);

            //Keeping code examples as code while treating documentation as untrusted Markdown.
            if (typeof contentObjectData.language === 'string') {
                markdownData.appendCodeblock(contentObjectData.value, contentObjectData.language);

            } else {
                markdownData.appendMarkdown(contentObjectData.value);

            }

            markdownData.isTrusted = false;
            markdownData.supportHtml = false;
            markdownRecords.push(markdownData);

        }

    }

    return markdownRecords;

}

/**
 * @param {number | undefined} severityData
 */
function vscodeDiagnosticSeverityGet(severityData) {
    //Mapping the LSP severity values into the VS Code public enumeration.
    if (severityData === 1) {
        return vscode.DiagnosticSeverity.Error;

    }

    if (severityData === 2) {
        return vscode.DiagnosticSeverity.Warning;

    }

    if (severityData === 3) {
        return vscode.DiagnosticSeverity.Information;

    }

    return vscode.DiagnosticSeverity.Hint;

}

/**
 * @param {vscode.TextDocument} documentData
 */
function workspaceDirectoryGet(documentData) {
    //Resolving the nearest opened workspace without guessing from the file path.
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentData.uri);

    if (workspaceFolder === undefined) {
        return null;

    }

    return workspaceFolder.uri.fsPath;

}

/**
 * @param {vscode.ExtensionContext} extensionContext
 * @param {vscode.TextDocument} documentData
 * @param {boolean} previewStatus
 */
function compilerRun(extensionContext, documentData, previewStatus) {
    const workspaceDirectory = workspaceDirectoryGet(documentData);

    if (workspaceDirectory === null) {
        return Promise.resolve({
            ok: false,
            code: 'LAYER_IDE_WORKSPACE_REQUIRED',
            message: 'Open the Layer application as a VS Code workspace.',
            line: 1,
            column: 1
        });

    }

    return new Promise(function compilerProcessCreate(resolve) {
        const runnerFile = extensionContext.asAbsolutePath(path.join('src', 'diagnostic-runner.mjs'));
        const runnerArguments = [
            runnerFile,
            workspaceDirectory,
            documentData.fileName
        ];

        if (previewStatus) {
            runnerArguments.push('--preview');

        }

        const runnerProcess = childProcess.spawn('node', runnerArguments, {
            cwd: workspaceDirectory,
            shell: false,
            windowsHide: true
        });
        let outputData = '';
        let errorData = '';
        let settledStatus = false;

        //Finishing once so timeout, process errors, and close cannot race diagnostics.
        const compilerProcessFinish = function(
            /** @type {{ok: boolean, code?: string, message?: string, line?: number, column?: number, preview?: unknown}} */ resultData
        ) {
            //Ignoring every late process signal after the first terminal result.
            if (settledStatus) {
                return;

            }

            settledStatus = true;
            clearTimeout(timeoutHandle);
            resolve(resultData);

        };

        runnerProcess.stdout.on('data', function compilerOutputRead(chunkData) {
            //Collecting bounded structured output from the isolated compiler process.
            outputData += String(chunkData);

            if (Buffer.byteLength(outputData, 'utf8') > outputByteLimit) {
                runnerProcess.kill();
                compilerProcessFinish({
                    ok: false,
                    code: 'LAYER_IDE_OUTPUT_LIMIT',
                    message: 'Layer compiler output exceeded the IDE safety limit.',
                    line: 1,
                    column: 1
                });

            }

        });
        runnerProcess.stderr.on('data', function compilerErrorRead(chunkData) {
            //Keeping a small diagnostic tail for malformed runner responses.
            if (Buffer.byteLength(errorData, 'utf8') < 64 * 1024) {
                errorData += String(chunkData);

            }

        });
        runnerProcess.once('error', function compilerProcessError() {
            //Converting process startup failures into a stable IDE diagnostic.
            compilerProcessFinish({
                ok: false,
                code: 'LAYER_IDE_NODE_REQUIRED',
                message: 'Node.js 24 and the local @solcorp/layer-compiler package are required.',
                line: 1,
                column: 1
            });

        });
        runnerProcess.once('close', function compilerProcessClose(exitCode) {
            //Accepting only the runner's bounded JSON response.
            try {
                const resultData = JSON.parse(outputData.trim());

                compilerProcessFinish(resultData);

            } catch {
                compilerProcessFinish({
                    ok: false,
                    code: 'LAYER_IDE_RUNNER_FAILED',
                    message: errorData.trim() || `Layer compiler process exited with code ${exitCode}.`,
                    line: 1,
                    column: 1
                });

            }

        });
        const timeoutHandle = setTimeout(function compilerProcessTimeout() {
            //Stopping compiler work that exceeds the editor latency budget.
            runnerProcess.kill();
            compilerProcessFinish({
                ok: false,
                code: 'LAYER_IDE_TIMEOUT',
                message: 'Layer compiler diagnostics exceeded 10 seconds.',
                line: 1,
                column: 1
            });

        }, 10000);

    });

}

/**
 * @param {vscode.ExtensionContext} extensionContext
 */
function activate(extensionContext) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('layer');
    const embeddedDiagnosticCollection = vscode.languages.createDiagnosticCollection('layer-embedded');
    const validationRevision = new Map();
    const embeddedValidationTimers = new Map();

    extensionContext.subscriptions.push(
        diagnosticCollection,
        embeddedDiagnosticCollection,
        vscode.window.registerFileDecorationProvider({
            provideFileDecoration(resourceUri, cancellationToken) {
                if (cancellationToken.isCancellationRequested) {
                    return undefined;

                }

                const decorationData = layerFileDecorationDataCreate(resourceUri.fsPath);

                if (decorationData === null) {
                    return undefined;

                }

                //Adding a theme-independent Layer badge while retaining native JavaScript mode.
                return new vscode.FileDecoration(
                    decorationData.badge,
                    decorationData.tooltip,
                    new vscode.ThemeColor('charts.yellow')
                );

            }
        })
    );

    /**
     * @param {vscode.TextDocument} documentData
     */
    function embeddedDocumentValidate(documentData) {
        //Ignoring ordinary JavaScript and returning an empty embedded diagnostic set.
        if (!layerEmbeddedDocumentCheck(documentData)) {
            return;

        }

        const diagnosticRecords = embeddedDiagnosticsProvide({
            source: documentData.getText(),
            uri: documentData.uri.toString(),
            version: documentData.version
        }).map(function embeddedDiagnosticCreate(diagnosticData) {
            //Mapping one source-compatible LSP diagnostic into the VS Code API.
            const diagnosticRecord = new vscode.Diagnostic(
                vscodeRangeCreate(diagnosticData.range),
                String(diagnosticData.message),
                vscodeDiagnosticSeverityGet(diagnosticData.severity)
            );
            diagnosticRecord.code = diagnosticData.code;
            diagnosticRecord.source = String(diagnosticData.source ?? 'Layer embedded language');

            return diagnosticRecord;

        });

        embeddedDiagnosticCollection.set(documentData.uri, diagnosticRecords);

    }

    /**
     * @param {vscode.TextDocument} documentData
     * @param {number} [delayMs]
     */
    function embeddedDocumentValidationSchedule(documentData, delayMs = 180) {
        if (!layerEmbeddedDocumentCheck(documentData)) {
            return;

        }

        const documentKey = documentData.uri.toString();
        const activeTimer = embeddedValidationTimers.get(documentKey);

        if (activeTimer !== undefined) {
            clearTimeout(activeTimer);

        }

        //Validating after the current editor change burst settles.
        const validationTimer = setTimeout(function embeddedValidationDelayComplete() {
            //Replacing the pending timer with the latest document validation.
            embeddedValidationTimers.delete(documentKey);
            embeddedDocumentValidate(documentData);

        }, delayMs);
        embeddedValidationTimers.set(documentKey, validationTimer);

    }

    /**
     * @param {vscode.TextDocument} documentData
     * @param {boolean} [notificationStatus]
     */
    async function documentValidate(documentData, notificationStatus = false) {
        //Ignoring ordinary JavaScript files outside the Layer authoring boundary.
        if (!layerDocumentCheck(documentData)) {
            return;

        }

        const documentKey = documentData.uri.toString();
        const currentRevision = (validationRevision.get(documentKey) ?? 0) + 1;

        validationRevision.set(documentKey, currentRevision);
        const resultData = await compilerRun(extensionContext, documentData, false);

        if (validationRevision.get(documentKey) !== currentRevision) {
            return;

        }

        if (resultData.ok === true) {
            diagnosticCollection.delete(documentData.uri);

            if (notificationStatus) {
                void vscode.window.showInformationMessage('Layer component is valid.');

            }

            return;

        }

        const lineIndex = Math.max(0, Number(resultData.line ?? 1) - 1);
        const columnIndex = Math.max(0, Number(resultData.column ?? 1) - 1);
        const diagnosticRange = new vscode.Range(
            lineIndex,
            columnIndex,
            lineIndex,
            columnIndex + 1
        );
        const diagnosticData = new vscode.Diagnostic(
            diagnosticRange,
            String(resultData.message ?? 'Layer compiler rejected this file.'),
            vscode.DiagnosticSeverity.Error
        );

        diagnosticData.code = String(resultData.code ?? 'LAYER_IDE_DIAGNOSTIC_FAILED');
        diagnosticData.source = 'Layer-Engine';
        diagnosticCollection.set(documentData.uri, [diagnosticData]);

        if (notificationStatus) {
            void vscode.window.showErrorMessage(`${diagnosticData.code}: ${diagnosticData.message}`);

        }

    }

    extensionContext.subscriptions.push(vscode.workspace.onDidSaveTextDocument(function documentSaveHandle(documentData) {
        //Respecting the workspace-level opt-out before starting a compiler process.
        const diagnosticConfiguration = vscode.workspace.getConfiguration('layer', documentData.uri);

        if (diagnosticConfiguration.get('diagnostics.onSave', true)) {
            void documentValidate(documentData);

        }

        embeddedDocumentValidationSchedule(documentData, 0);

    }));
    extensionContext.subscriptions.push(vscode.workspace.onDidChangeTextDocument(function documentChangeHandle(changeEvent) {
        //Scheduling HTML and CSS validation without running the full compiler on every keystroke.
        embeddedDocumentValidationSchedule(changeEvent.document);

    }));
    extensionContext.subscriptions.push(vscode.workspace.onDidCloseTextDocument(function documentCloseHandle(documentData) {
        //Releasing diagnostics and revision state with the closed editor.
        diagnosticCollection.delete(documentData.uri);
        embeddedDiagnosticCollection.delete(documentData.uri);
        validationRevision.delete(documentData.uri.toString());
        const documentKey = documentData.uri.toString();
        embeddedLanguageCacheClear(documentKey);
        const activeTimer = embeddedValidationTimers.get(documentKey);

        if (activeTimer !== undefined) {
            clearTimeout(activeTimer);
            embeddedValidationTimers.delete(documentKey);

        }

    }));
    extensionContext.subscriptions.push(vscode.languages.registerCompletionItemProvider({
        language: 'javascript',
        pattern: '**/*.layer.js'
    }, {
        provideCompletionItems(documentData, positionData, cancellationToken) {
            //Returning control to native JavaScript while outside embedded content.
            if (cancellationToken.isCancellationRequested || !layerEmbeddedDocumentCheck(documentData)) {
                return undefined;

            }

            const completionResult = embeddedCompletionProvide({
                source: documentData.getText(),
                offset: documentData.offsetAt(positionData),
                uri: documentData.uri.toString(),
                version: documentData.version
            });

            if (completionResult === null || cancellationToken.isCancellationRequested) {
                return undefined;

            }

            return new vscode.CompletionList(
                completionResult.items.map(vscodeCompletionItemCreate),
                completionResult.isIncomplete
            );

        }
    },
    '<', ' ', '@', '.', '?', ':', '=', '"', "'", '-',
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    ));
    extensionContext.subscriptions.push(vscode.languages.registerHoverProvider({
        language: 'javascript',
        pattern: '**/*.layer.js'
    }, {
        provideHover(documentData, positionData, cancellationToken) {
            //Returning control to native JavaScript while outside embedded content.
            if (cancellationToken.isCancellationRequested || !layerEmbeddedDocumentCheck(documentData)) {
                return undefined;

            }

            const hoverResult = embeddedHoverProvide({
                source: documentData.getText(),
                offset: documentData.offsetAt(positionData),
                uri: documentData.uri.toString(),
                version: documentData.version
            });

            if (hoverResult === null || cancellationToken.isCancellationRequested) {
                return undefined;

            }

            const hoverContents = vscodeHoverContentsCreate(hoverResult.contents);
            let hoverRange;

            if (hoverResult.range !== undefined) {
                //Mapping the source-compatible LSP range into the VS Code API.
                hoverRange = vscodeRangeCreate(hoverResult.range);

            }

            return new vscode.Hover(hoverContents, hoverRange);

        }
    }));
    extensionContext.subscriptions.push(vscode.commands.registerCommand('layer.validateFile', async function validateCommandRun() {
        //Validating only the active canonical Layer authoring file.
        const activeDocument = vscode.window.activeTextEditor?.document;

        if (activeDocument === undefined || !layerDocumentCheck(activeDocument)) {
            void vscode.window.showWarningMessage('Open a *.layer.js component or src/operations.js first.');

            return;

        }

        await documentValidate(activeDocument, true);

    }));
    extensionContext.subscriptions.push(vscode.commands.registerCommand('layer.showCompiledOutput', async function previewCommandRun() {
        //Opening the compiler plan beside the current component for inspection.
        const activeDocument = vscode.window.activeTextEditor?.document;

        if (activeDocument === undefined || !layerDocumentCheck(activeDocument)) {
            void vscode.window.showWarningMessage('Open a *.layer.js component or src/operations.js first.');

            return;

        }

        const resultData = await compilerRun(extensionContext, activeDocument, true);

        if (resultData.ok !== true) {
            await documentValidate(activeDocument, true);

            return;

        }

        const previewDocument = await vscode.workspace.openTextDocument({
            content: `${JSON.stringify(resultData.preview, null, 4)}\n`,
            language: 'json'
        });

        await vscode.window.showTextDocument(previewDocument, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        });

    }));

    for (const documentData of vscode.workspace.textDocuments) {
        void documentValidate(documentData);
        embeddedDocumentValidationSchedule(documentData, 0);

    }

}

function deactivate() {
    //VS Code disposes every registered resource through the extension context.

}

module.exports = {
    activate,
    deactivate
};
