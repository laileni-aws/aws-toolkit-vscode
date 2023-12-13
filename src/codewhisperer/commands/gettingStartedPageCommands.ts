/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as vscode from 'vscode'
import { CommandDeclarations, Commands, VsCodeCommandArg } from '../../shared/vscode/commands2'
import { showCodeWhispererWebview } from '../vue/backend'
import { telemetry } from '../../shared/telemetry/telemetry'
import { PromptSettings } from '../../shared/settings'
import { CodeWhispererSource } from './types'
import { Disposable, DocumentSelector, TextDocument, Position, InlayHint, InlayHintsProvider } from 'vscode'
/**
 * The methods with backend logic for the Codewhisperer Getting Started Page commands.
 */
export class CodeWhispererCommandBackend {
    constructor(private readonly extContext: vscode.ExtensionContext) {}
    public async showGettingStartedPage(_: VsCodeCommandArg, source: CodeWhispererSource) {
        if (_ !== undefined) {
            source = 'vscodeComponent'
        }

        const prompts = PromptSettings.instance
        //To check the condition If the user has already seen the welcome message
        if (!(await prompts.isPromptEnabled('codeWhispererNewWelcomeMessage'))) {
            telemetry.ui_click.emit({ elementId: 'codewhisperer_Learn_ButtonClick', passive: true })
        }
        return showCodeWhispererWebview(this.extContext, source)
    }
}
/**
 * Declared commands related to CodeWhisperer in the toolkit.
 */
export class CodeWhispererCommandDeclarations implements CommandDeclarations<CodeWhispererCommandBackend> {
    static #instance: CodeWhispererCommandDeclarations

    static get instance(): CodeWhispererCommandDeclarations {
        return (this.#instance ??= new CodeWhispererCommandDeclarations())
    }
    public readonly declared = {
        showGettingStartedPage: Commands.from(CodeWhispererCommandBackend).declareShowGettingStartedPage(
            'aws.codeWhisperer.gettingStarted'
        ),
    } as const
}

let hintShown = false

const myInlayHintsProvider: InlayHintsProvider = {
    provideInlayHints(document: TextDocument): InlayHint[] {
        const hints: InlayHint[] = []
        const editor = vscode.window.activeTextEditor

        if (hintShown || editor === undefined) {
            return hints
        }

        const position = editor.selection.active
        const line = editor.document.lineAt(position.line)

        if (editor.document.getText().length === 0 || position.character === line.text.length) {
            // Display hint at the beginning of the file for empty files
            hints.push({
                label: 'CodeWhisperer suggests code as you type or enter a new line, press TAB to accept',
                position: new Position(0, 0),
            })
            hintShown = true
        }
        //    else {
        //        if(position.character === line.text.length) {
        //            // Cursor is at end of line
        //            //hints.push({ label: 'This file is empty', position: new Position(0, 0) });
        //            hints.push({ label: 'End of Line', position: editor.selection.active });
        //            hintShown = true;
        //        }
        //    }

        return hints
    },
}

const documentSelector: DocumentSelector = ['*']

const disposables: Disposable = vscode.languages.registerInlayHintsProvider(documentSelector, myInlayHintsProvider)

let activeEditor = vscode.window.activeTextEditor

vscode.window.onDidChangeActiveTextEditor(editor => {
    activeEditor = editor
})

vscode.workspace.onDidChangeTextDocument(event => {
    if (activeEditor && event.document === activeEditor.document) {
        // Clear hints when text changes
        disposables.dispose()
        hintShown = false
    }
})

vscode.extensions.onDidChange(() => {
    disposables.dispose()
})

/**                    WORKING
 * This Hover shows the suggestion for user to write down the comment
 */

export class EndOfLineHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.Hover {
        const line = document.lineAt(position.line)
        if (position.character === line.text.length || document.getText().length === 0) {
            // Cursor at end of line
            return new vscode.Hover('CodeWhisperer suggests code as you type or enter a new line, press TAB to accept')
        }
        return new vscode.Hover('')
    }
}

//Register this in extension

const provider = new EndOfLineHoverProvider()

const disposable: Disposable = vscode.languages.registerHoverProvider({ language: '*' }, provider)

vscode.extensions.onDidChange(() => {
    disposable.dispose()
})
