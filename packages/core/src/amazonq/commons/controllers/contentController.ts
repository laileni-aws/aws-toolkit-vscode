/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import path from 'path'
import * as os from 'os'
import { Position, TextEditor, window } from 'vscode'
import { getLogger } from '../../../shared/logger/logger'
import { amazonQDiffScheme, amazonQTabSuffix } from '../../../shared/constants'
import { disposeOnEditorClose } from '../../../shared/utilities/editorUtilities'
import {
    applyChanges,
    createTempUrisForDiff,
    getIndentedCode,
    getSelectionFromRange,
} from '../../../shared/utilities/textDocumentUtilities'
import { ToolkitError, getErrorMsg } from '../../../shared/errors'
import fs from '../../../shared/fs/fs'
import { extractFileAndCodeSelectionFromMessage } from '../../../shared/utilities/textUtilities'
import { UserWrittenCodeTracker } from '../../../codewhisperer/tracker/userWrittenCodeTracker'
import { CWCTelemetryHelper } from '../../../codewhispererChat/controllers/chat/telemetryHelper'
import type { ViewDiff } from '../../../codewhispererChat/controllers/chat/model'
import type { TriggerEvent } from '../../../codewhispererChat/storages/triggerEvents'
import { DiffContentProvider } from './diffContentProvider'

export type ViewDiffMessage = Pick<ViewDiff, 'code'> & Partial<Pick<TriggerEvent, 'context'>>

export class ContentProvider implements vscode.TextDocumentContentProvider {
    constructor(private uri: vscode.Uri) {}

    provideTextDocumentContent(_uri: vscode.Uri) {
        return fs.readFileText(this.uri.fsPath)
    }
}

const chatDiffCode = 'ChatDiff'
const ChatDiffError = ToolkitError.named(chatDiffCode)

export class EditorContentController {
    /* *
     *  Insert the Amazon Q chat written code to the cursor position
     *  Add current intentation to the next few lines of the recommendation
     * @param text the raw text from Amazon Q chat
     * @param trackCodeEdit callback to track user edits
     */
    public insertTextAtCursorPosition(
        text: string,
        trackCodeEdit: (editor: TextEditor, cursorStart: Position) => void
    ) {
        const editor = window.activeTextEditor
        if (editor) {
            CWCTelemetryHelper.instance.setDocumentDiagnostics()
            UserWrittenCodeTracker.instance.onQStartsMakingEdits()
            const cursorStart = editor.selection.active
            const indentRange = new vscode.Range(new vscode.Position(cursorStart.line, 0), cursorStart)
            // use the user editor intent if the position to the left of cursor is just space or tab
            // otherwise indent with empty space equal to the intent at this position
            let indent = editor.document.getText(indentRange)
            if (indent.trim().length !== 0) {
                indent = ' '.repeat(indent.length - indent.trimStart().length)
            }
            let textWithIndent = ''
            for (const [index, line] of text.split('\n').entries()) {
                if (index === 0) {
                    textWithIndent += line
                } else {
                    textWithIndent += '\n' + indent + line
                }
            }
            editor
                .edit((editBuilder) => {
                    editBuilder.insert(cursorStart, textWithIndent)
                })
                .then(
                    (appliedEdits) => {
                        if (appliedEdits) {
                            trackCodeEdit(editor, cursorStart)
                        }
                        UserWrittenCodeTracker.instance.onQFinishesEdits()
                    },
                    (e) => {
                        getLogger().error('TextEditor.edit failed: %s', (e as Error).message)
                        UserWrittenCodeTracker.instance.onQFinishesEdits()
                    }
                )
        }
    }

    /**
     * Accepts and applies a diff to a file, then closes the associated diff view tab.
     *
     * @param {any} message - The message containing diff information.
     * @returns {Promise<void>} A promise that resolves when the diff is applied and the tab is closed.
     *
     * @description
     * This method performs the following steps:
     * 1. Extracts file path and selection from the message.
     * 2. If valid file path, non-empty code, and selection are present:
     *    a. Opens the document.
     *    b. Gets the indented code to update.
     *    c. Applies the changes to the document.
     *    d. Attempts to close the diff view tab for the file.
     *
     * @throws {Error} If there's an issue opening the document or applying changes.
     */
    public async acceptDiff(message: any) {
        const errorNotification = 'Unable to Apply code changes.'
        const { filePath, selection } = extractFileAndCodeSelectionFromMessage(message)

        if (filePath && message?.code?.trim().length > 0 && selection) {
            try {
                UserWrittenCodeTracker.instance.onQStartsMakingEdits()
                const doc = await vscode.workspace.openTextDocument(filePath)

                const code = getIndentedCode(message, doc, selection)
                const range = getSelectionFromRange(doc, selection)
                await applyChanges(doc, range, code)

                // Sets the editor selection from the start of the given range, extending it by the number of lines in the code till the end of the last line
                const editor = await vscode.window.showTextDocument(doc)
                editor.selection = new vscode.Selection(
                    range.start,
                    new Position(range.start.line + code.split('\n').length, Number.MAX_SAFE_INTEGER)
                )

                // If vscode.diff is open for the filePath then close it.
                vscode.window.tabGroups.all.flatMap(({ tabs }) =>
                    tabs.map((tab) => {
                        if (tab.label === `${path.basename(filePath)} ${amazonQTabSuffix}`) {
                            const tabClosed = vscode.window.tabGroups.close(tab)
                            if (!tabClosed) {
                                getLogger().error(
                                    '%s: Unable to close the diff view tab for %s',
                                    chatDiffCode,
                                    tab.label
                                )
                            }
                        }
                    })
                )
            } catch (error) {
                void vscode.window.showInformationMessage(errorNotification)
                const wrappedError = ChatDiffError.chain(error, `Failed to Accept Diff`, { code: chatDiffCode })
                getLogger().error('%s: Failed to open diff view %s', chatDiffCode, getErrorMsg(wrappedError, true))
                throw wrappedError
            } finally {
                UserWrittenCodeTracker.instance.onQFinishesEdits()
            }
        }
    }

    /**
     * Displays an editable diff view comparing original and current file content.
     *
     * Left side: message.context.activeFileContext.fileText (original file content)
     * Right side: Current content read from message.context.activeFileContext.filePath
     *
     * The diff view is editable - user can make changes and save to the original file.
     *
     * @param message the message from Amazon Q chat containing original content and file path
     * @param scheme the URI scheme to use for the diff view (ignored for editable diff)
     */
    public async viewDiff(message: ViewDiffMessage, _scheme: string = amazonQDiffScheme) {
        const errorNotification = 'Unable to Open Diff.'

        try {
            const originalFilePath = message.context?.activeFileContext?.filePath
            const originalContent = message.context?.activeFileContext?.fileText

            if (originalFilePath && originalContent !== undefined) {
                // Read the current content from the file
                const modifiedContent = await fs.readFileText(originalFilePath)
                await this.createEditableDiffFromContent(originalFilePath, originalContent, modifiedContent)
            }
        } catch (error) {
            void vscode.window.showInformationMessage(errorNotification)
            const wrappedError = ChatDiffError.chain(error, `Failed to Open Diff View`, { code: chatDiffCode })
            getLogger().error('%s: Failed to open diff view %s', chatDiffCode, getErrorMsg(wrappedError, true))
            throw wrappedError
        }
    }

    /**
     * Creates an editable diff view from original and modified content.
     * Left side: original content (from temp file)
     * Right side: modified content (from temp file) - this is editable and saves to original file
     */
    private async createEditableDiffFromContent(
        originalFilePath: string,
        originalContent: string,
        modifiedContent: string
    ) {
        const originalFile = path.parse(originalFilePath)
        const tempDir = path.join(os.tmpdir(), 'amazonq-diff')

        // Ensure temp directory exists
        await fs.mkdir(tempDir)

        // Create temporary files for both original and modified content
        const timestamp = Date.now()
        const originalTempFileName = `${originalFile.name}_original_${timestamp}${originalFile.ext}`
        const modifiedTempFileName = `${originalFile.name}_modified_${timestamp}${originalFile.ext}`

        const originalTempFilePath = path.join(tempDir, originalTempFileName)
        const modifiedTempFilePath = path.join(tempDir, modifiedTempFileName)

        // Write both contents to temporary files
        await fs.writeFile(originalTempFilePath, originalContent)
        await fs.writeFile(modifiedTempFilePath, modifiedContent)

        // Create URIs for both temp files
        const originalTempUri = vscode.Uri.file(originalTempFilePath)
        const modifiedTempUri = vscode.Uri.file(modifiedTempFilePath)

        // Open the editable diff view
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalTempUri,
            modifiedTempUri,
            `${path.basename(originalFilePath)} ${amazonQTabSuffix}`
        )

        // Set up save handler to sync changes back to original file
        this.setupSaveHandler(
            modifiedTempFilePath,
            originalFilePath,
            originalTempFilePath,
            path.basename(originalFilePath)
        )
    }

    /**
     * Displays a read-only diff view using custom content providers (legacy behavior).
     * This method is kept for backward compatibility if needed.
     */
    public async viewDiffReadOnly(message: ViewDiffMessage, scheme: string = amazonQDiffScheme) {
        const errorNotification = 'Unable to Open Diff.'
        const { filePath, fileText, selection } = extractFileAndCodeSelectionFromMessage(message)

        try {
            if (filePath && message?.code !== undefined && selection) {
                // Register content provider and show diff
                const contentProvider = new DiffContentProvider()
                const disposable = vscode.workspace.registerTextDocumentContentProvider(scheme, contentProvider)

                const [originalFileUri, modifiedFileUri] = await createTempUrisForDiff(
                    filePath,
                    fileText,
                    message,
                    selection,
                    scheme,
                    contentProvider
                )

                await vscode.commands.executeCommand(
                    'vscode.diff',
                    originalFileUri,
                    modifiedFileUri,
                    `${path.basename(filePath)} ${amazonQTabSuffix}`
                )

                disposeOnEditorClose(originalFileUri, disposable)
            }
        } catch (error) {
            void vscode.window.showInformationMessage(errorNotification)
            const wrappedError = ChatDiffError.chain(error, `Failed to Open Diff View`, { code: chatDiffCode })
            getLogger().error('%s: Failed to open diff view %s', chatDiffCode, getErrorMsg(wrappedError, true))
            throw wrappedError
        }
    }

    /**
     * Sets up save handler to sync changes from temp file back to original file
     */
    private setupSaveHandler(
        modifiedTempFilePath: string,
        originalFilePath: string,
        originalTempFilePath: string,
        fileName: string
    ) {
        // Listen for document saves
        const saveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.uri.fsPath === modifiedTempFilePath) {
                try {
                    // Copy the saved content from temp file to original file
                    const modifiedContent = await fs.readFileText(modifiedTempFilePath)
                    await fs.writeFile(originalFilePath, modifiedContent)

                    getLogger().info(`Saved changes from diff view to ${originalFilePath}`)

                    // Show success message
                    void vscode.window.showInformationMessage(`Changes saved to ${path.basename(originalFilePath)}`)
                } catch (error) {
                    getLogger().error(`Failed to save changes to ${originalFilePath}: ${error}`)
                    void vscode.window.showErrorMessage(`Failed to save changes to ${path.basename(originalFilePath)}`)
                }
            }
        })

        // Clean up when diff tab is closed
        const tabDisposable = vscode.window.tabGroups.onDidChangeTabs((event) => {
            const closedTabs = event.closed
            for (const tab of closedTabs) {
                if (tab.label === `${fileName} ${amazonQTabSuffix}`) {
                    // Clean up temporary files
                    Promise.all([
                        fs.delete(modifiedTempFilePath).catch((error) => {
                            getLogger().warn(`Failed to clean up temp file ${modifiedTempFilePath}: ${error}`)
                        }),
                        fs.delete(originalTempFilePath).catch((error) => {
                            getLogger().warn(`Failed to clean up temp file ${originalTempFilePath}: ${error}`)
                        }),
                    ])

                    // Dispose event listeners
                    saveDisposable.dispose()
                    tabDisposable.dispose()
                    break
                }
            }
        })
    }
}
