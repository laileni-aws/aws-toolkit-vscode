/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import * as sinon from 'sinon'
import assert from 'assert'
import { EditorContentController, ViewDiffMessage } from '../../../../amazonq/commons/controllers/contentController'
import { amazonQTabSuffix } from '../../../../shared/constants'
import fs from '../../../../shared/fs/fs'
import * as os from 'os'
import * as path from 'path'

describe('EditorContentController', () => {
    let sandbox: sinon.SinonSandbox
    let controller: EditorContentController
    let executeCommandStub: sinon.SinonStub
    let fsMkdirStub: sinon.SinonStub
    let fsWriteFileStub: sinon.SinonStub
    let fsReadFileTextStub: sinon.SinonStub
    let tabGroupsOnDidChangeTabsStub: sinon.SinonStub

    beforeEach(() => {
        sandbox = sinon.createSandbox()
        controller = new EditorContentController()

        // Stub VS Code API calls
        executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves()

        // Stub file system operations
        fsMkdirStub = sandbox.stub(fs, 'mkdir').resolves()
        fsWriteFileStub = sandbox.stub(fs, 'writeFile').resolves()
        fsReadFileTextStub = sandbox.stub(fs, 'readFileText').resolves('original file content')

        // Stub OS operations
        sandbox.stub(os, 'tmpdir').returns('/tmp')

        // Stub tab groups and workspace events
        tabGroupsOnDidChangeTabsStub = sandbox
            .stub(vscode.window.tabGroups, 'onDidChangeTabs')
            .returns({ dispose: () => {} })
        sandbox.stub(vscode.workspace, 'onDidSaveTextDocument').returns({ dispose: () => {} })
    })

    afterEach(() => {
        sandbox.restore()
    })

    describe('viewDiff', () => {
        const testFilePath = '/path/to/testFile.js'
        const testOriginalContent = 'original file content'
        const testModifiedContent = 'modified file content'
        const testMessage: ViewDiffMessage = {
            code: testModifiedContent,
            context: {
                activeFileContext: {
                    filePath: testFilePath,
                    fileText: testOriginalContent,
                    fileLanguage: 'javascript',
                    matchPolicy: undefined,
                },
                focusAreaContext: {
                    selectionInsideExtendedCodeBlock: new vscode.Selection(0, 0, 0, 0),
                    codeBlock: '',
                    extendedCodeBlock: '',
                    names: undefined,
                },
            },
        }

        beforeEach(() => {
            // Reset stubs for each test
            fsMkdirStub.resetHistory()
            fsWriteFileStub.resetHistory()
            fsReadFileTextStub.resetHistory()
            executeCommandStub.resetHistory()
            tabGroupsOnDidChangeTabsStub.resetHistory()

            // Set up default return value for reading the current file content
            fsReadFileTextStub.returns(Promise.resolve(testModifiedContent))
        })

        it('should show editable diff view with original and current file content', async () => {
            await controller.viewDiff(testMessage)

            // Verify current file content was read
            assert.strictEqual(fsReadFileTextStub.calledOnce, true)
            assert.strictEqual(fsReadFileTextStub.firstCall.args[0], testFilePath)

            // Verify temp directory was created
            assert.strictEqual(fsMkdirStub.calledOnce, true)
            assert.strictEqual(fsMkdirStub.firstCall.args[0], path.join('/tmp', 'amazonq-diff'))

            // Verify both temp files were written (original and current file content)
            assert.strictEqual(fsWriteFileStub.calledTwice, true)

            // First call should write original content
            const originalTempPath = fsWriteFileStub.firstCall.args[0]
            const originalContent = fsWriteFileStub.firstCall.args[1]
            assert(originalTempPath.includes('testFile_original_'))
            assert(originalTempPath.endsWith('.js'))
            assert.strictEqual(originalContent, testOriginalContent)

            // Second call should write current file content (read from file)
            const modifiedTempPath = fsWriteFileStub.secondCall.args[0]
            const modifiedContent = fsWriteFileStub.secondCall.args[1]
            assert(modifiedTempPath.includes('testFile_modified_'))
            assert(modifiedTempPath.endsWith('.js'))
            assert.strictEqual(modifiedContent, testModifiedContent)

            // Verify vscode.diff command was executed with temp file URIs
            assert.strictEqual(executeCommandStub.calledOnce, true)
            assert.strictEqual(executeCommandStub.firstCall.args[0], 'vscode.diff')
            assert(executeCommandStub.firstCall.args[1].fsPath.includes('testFile_original_')) // Original temp file URI
            assert(executeCommandStub.firstCall.args[2].fsPath.includes('testFile_modified_')) // Modified temp file URI
            assert.strictEqual(executeCommandStub.firstCall.args[3], `testFile.js ${amazonQTabSuffix}`)

            // Verify tab change listener was set up for cleanup
            assert.strictEqual(tabGroupsOnDidChangeTabsStub.calledOnce, true)
        })

        it('should ignore custom scheme parameter (editable diff uses file URIs)', async () => {
            const customScheme = 'custom-scheme'
            await controller.viewDiff(testMessage, customScheme)

            // Verify it still creates editable diff with temp file URIs regardless of scheme parameter
            assert.strictEqual(executeCommandStub.calledOnce, true)
            assert(executeCommandStub.firstCall.args[1].fsPath.includes('testFile_original_')) // Original temp file URI
            assert(executeCommandStub.firstCall.args[2].fsPath.includes('testFile_modified_')) // Modified temp file URI

            // Verify file operations were called (not content provider operations)
            assert.strictEqual(fsMkdirStub.calledOnce, true)
            assert.strictEqual(fsWriteFileStub.calledTwice, true)
        })

        it('should read current file content and use original content from message context', async () => {
            await controller.viewDiff(testMessage)

            // Verify fs.readFileText was called to get current file content
            assert.strictEqual(fsReadFileTextStub.calledOnce, true)
            assert.strictEqual(fsReadFileTextStub.firstCall.args[0], testFilePath)

            // Verify both temp files were written with correct content
            assert.strictEqual(fsWriteFileStub.calledTwice, true)
            assert.strictEqual(fsWriteFileStub.firstCall.args[1], testOriginalContent)
            assert.strictEqual(fsWriteFileStub.secondCall.args[1], testModifiedContent)
        })

        it('should not attempt to show diff when filePath is missing', async () => {
            const messageWithoutFilePath: ViewDiffMessage = {
                code: testModifiedContent,
                context: {
                    activeFileContext: {
                        filePath: undefined as any,
                        fileText: testOriginalContent,
                        fileLanguage: 'javascript',
                        matchPolicy: undefined,
                    },
                    focusAreaContext: {
                        selectionInsideExtendedCodeBlock: new vscode.Selection(0, 0, 0, 0),
                        codeBlock: '',
                        extendedCodeBlock: '',
                        names: undefined,
                    },
                },
            }

            await controller.viewDiff(messageWithoutFilePath)

            assert.strictEqual(fsMkdirStub.called, false)
            assert.strictEqual(fsWriteFileStub.called, false)
            assert.strictEqual(executeCommandStub.called, false)
        })

        it('should not attempt to show diff when context is missing', async () => {
            await controller.viewDiff({ code: 'some code' })

            assert.strictEqual(fsMkdirStub.called, false)
            assert.strictEqual(fsWriteFileStub.called, false)
            assert.strictEqual(executeCommandStub.called, false)
        })

        it('should not attempt to show diff when original content is missing', async () => {
            const messageWithoutOriginalContent: ViewDiffMessage = {
                code: testModifiedContent,
                context: {
                    activeFileContext: {
                        filePath: testFilePath,
                        fileText: undefined as any,
                        fileLanguage: 'javascript',
                        matchPolicy: undefined,
                    },
                    focusAreaContext: {
                        selectionInsideExtendedCodeBlock: new vscode.Selection(0, 0, 0, 0),
                        codeBlock: '',
                        extendedCodeBlock: '',
                        names: undefined,
                    },
                },
            }

            await controller.viewDiff(messageWithoutOriginalContent)

            assert.strictEqual(fsMkdirStub.called, false)
            assert.strictEqual(fsWriteFileStub.called, false)
            assert.strictEqual(executeCommandStub.called, false)
        })
    })
})
