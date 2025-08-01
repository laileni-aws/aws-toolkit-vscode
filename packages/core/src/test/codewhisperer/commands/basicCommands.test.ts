/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import assert from 'assert'
import * as sinon from 'sinon'
import * as CodeWhispererConstants from '../../../codewhisperer/models/constants'
import { createCodeScanIssue, createMockDocument, resetCodeWhispererGlobalVariables } from '../testUtil'
import { assertTelemetry, assertTelemetryCurried, tryRegister } from '../../testUtil'
import {
    toggleCodeSuggestions,
    showSecurityScan,
    showFileScan,
    applySecurityFix,
    showReferenceLog,
    selectCustomizationPrompt,
    reconnect,
    signoutCodeWhisperer,
    toggleCodeScans,
    rejectFix,
    ignoreIssue,
    ignoreAllIssues,
} from '../../../codewhisperer/commands/basicCommands'
import { FakeExtensionContext } from '../../fakeExtensionContext'
import { testCommand } from '../../shared/vscode/testUtils'
import { Command, placeholder } from '../../../shared/vscode/commands2'
import { SecurityPanelViewProvider } from '../../../codewhisperer/views/securityPanelViewProvider'
import { DefaultCodeWhispererClient } from '../../../codewhisperer/client/codewhisperer'
import { stub } from '../../utilities/stubber'
import { AuthUtil } from '../../../codewhisperer/util/authUtil'
import { getTestWindow } from '../../shared/vscode/window'
import { ExtContext } from '../../../shared/extensions'
import {
    createAutoScans,
    createAutoSuggestions,
    createDocumentationNode,
    createFeedbackNode,
    createGettingStarted,
    createGitHubNode,
    createLearnMore,
    createManageSubscription,
    createOpenReferenceLog,
    createReconnect,
    createSecurityScan,
    createSelectCustomization,
    createSeparator,
    createSettingsNode,
    createSignIn,
    createSignout,
    switchToAmazonQNode,
} from '../../../codewhisperer/ui/codeWhispererNodes'
import { waitUntil } from '../../../shared/utilities/timeoutUtils'
import { listCodeWhispererCommands } from '../../../codewhisperer/ui/statusBarMenu'
import { CodeScanIssue, CodeScansState, CodeSuggestionsState, codeScanState } from '../../../codewhisperer/models/model'
import { cwQuickPickSource } from '../../../codewhisperer/commands/types'
import { refreshStatusBar } from '../../../codewhisperer/service/statusBar'
import { focusAmazonQPanel } from '../../../codewhispererChat/commands/registerCommands'
import * as diagnosticsProvider from '../../../codewhisperer/service/diagnosticsProvider'
import { randomUUID } from '../../../shared/crypto'
import { assertLogsContain } from '../../globalSetup.test'
import * as securityIssueWebview from '../../../codewhisperer/views/securityIssue/securityIssueWebview'
import { IssueItem, SecurityIssueTreeViewProvider } from '../../../codewhisperer/service/securityIssueTreeViewProvider'
import { SecurityIssueProvider } from '../../../codewhisperer/service/securityIssueProvider'
import { CodeWhispererSettings } from '../../../codewhisperer/util/codewhispererSettings'
import { confirm } from '../../../shared'
import * as commentUtils from '../../../shared/utilities/commentUtils'
import * as extUtils from '../../../shared/extensionUtilities'

describe('CodeWhisperer-basicCommands', function () {
    let targetCommand: Command<any> & vscode.Disposable

    before(async function () {
        tryRegister(refreshStatusBar)
    })

    beforeEach(async function () {
        await resetCodeWhispererGlobalVariables()
    })

    afterEach(function () {
        targetCommand?.dispose()
        sinon.restore()
    })

    after(async function () {
        // disable auto scan after testrun
        await CodeScansState.instance.setScansEnabled(false)
        assert.strictEqual(CodeScansState.instance.isScansEnabled(), false)
    })

    describe('toggleCodeSuggestion', function () {
        class TestCodeSuggestionsState extends CodeSuggestionsState {
            public constructor(initialState?: boolean) {
                super(initialState)
            }
        }

        let codeSuggestionsState: CodeSuggestionsState

        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
            codeSuggestionsState = new TestCodeSuggestionsState()
        })

        it('has suggestions enabled by default', async function () {
            targetCommand = testCommand(toggleCodeSuggestions, codeSuggestionsState)
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), true)
        })

        it('toggles states as expected', async function () {
            targetCommand = testCommand(toggleCodeSuggestions, codeSuggestionsState)
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), true)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), false)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), true)
        })

        it('setSuggestionsEnabled() works as expected', async function () {
            // initially true
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), true)

            // set new state to current state
            await codeSuggestionsState.setSuggestionsEnabled(true)
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), true)

            // set to opposite state
            await codeSuggestionsState.setSuggestionsEnabled(false)
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), false)
        })

        it('triggers event listener when toggled', async function () {
            const eventListener = sinon.stub()
            codeSuggestionsState.onDidChangeState(() => {
                eventListener()
            })
            assert.strictEqual(eventListener.callCount, 0)

            targetCommand = testCommand(toggleCodeSuggestions, codeSuggestionsState)
            await targetCommand.execute(placeholder, cwQuickPickSource)

            await waitUntil(async () => eventListener.callCount === 1, { timeout: 1000, interval: 1 })
            assert.strictEqual(eventListener.callCount, 1)
        })

        it('emits aws_modifySetting event on user toggling autoSuggestion - activate', async function () {
            codeSuggestionsState = new TestCodeSuggestionsState(false)
            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), false)

            targetCommand = testCommand(toggleCodeSuggestions, codeSuggestionsState)
            await targetCommand.execute(placeholder, cwQuickPickSource)

            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), true)
            assertTelemetryCurried('aws_modifySetting')({
                settingId: CodeWhispererConstants.autoSuggestionConfig.settingId,
                settingState: CodeWhispererConstants.autoSuggestionConfig.activated,
            })
        })

        it('emits aws_modifySetting event on user toggling autoSuggestion -- deactivate', async function () {
            targetCommand = testCommand(toggleCodeSuggestions, codeSuggestionsState)
            await targetCommand.execute(placeholder, cwQuickPickSource)

            assert.strictEqual(codeSuggestionsState.isSuggestionsEnabled(), false)
            assertTelemetryCurried('aws_modifySetting')({
                settingId: CodeWhispererConstants.autoSuggestionConfig.settingId,
                settingState: CodeWhispererConstants.autoSuggestionConfig.deactivated,
            })
        })

        it('includes the "source" in the command execution metric', async function () {
            targetCommand = testCommand(toggleCodeSuggestions, codeSuggestionsState)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', { source: cwQuickPickSource, command: targetCommand.id })
        })
    })

    describe('toggleCodeScans', function () {
        class TestCodeScansState extends CodeScansState {
            public constructor(initialState?: boolean) {
                super(initialState)
            }
        }

        let codeScansState: CodeScansState

        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
            codeScansState = new TestCodeScansState()
        })

        it('has auto scans disabled by default', async function () {
            targetCommand = testCommand(toggleCodeScans, codeScansState)
            assert.strictEqual(codeScansState.isScansEnabled(), false)
        })

        it('toggles states as expected', async function () {
            targetCommand = testCommand(toggleCodeScans, codeScansState)
            assert.strictEqual(codeScansState.isScansEnabled(), false)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assert.strictEqual(codeScansState.isScansEnabled(), true)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assert.strictEqual(codeScansState.isScansEnabled(), false)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assert.strictEqual(codeScansState.isScansEnabled(), true)
        })

        it('setScansEnabled() works as expected', async function () {
            // initially false
            assert.strictEqual(codeScansState.isScansEnabled(), false)

            await codeScansState.setScansEnabled(true)
            assert.strictEqual(codeScansState.isScansEnabled(), true)

            // set new state to current state
            await codeScansState.setScansEnabled(true)
            assert.strictEqual(codeScansState.isScansEnabled(), true)

            // set to opposite state
            await codeScansState.setScansEnabled(false)
            assert.strictEqual(codeScansState.isScansEnabled(), false)
        })

        it('triggers event listener when toggled', async function () {
            const eventListener = sinon.stub()
            codeScansState.onDidChangeState(() => {
                eventListener()
            })
            assert.strictEqual(eventListener.callCount, 0)

            targetCommand = testCommand(toggleCodeScans, codeScansState)
            await targetCommand.execute(placeholder, cwQuickPickSource)

            await waitUntil(async () => eventListener.callCount === 1, { timeout: 1000, interval: 1 })
            assert.strictEqual(eventListener.callCount, 1)
        })

        it('emits aws_modifySetting event on user toggling autoScans - activate', async function () {
            targetCommand = testCommand(toggleCodeScans, codeScansState)
            await targetCommand.execute(placeholder, cwQuickPickSource)

            assert.strictEqual(codeScansState.isScansEnabled(), true)
            assertTelemetryCurried('aws_modifySetting')({
                settingId: CodeWhispererConstants.autoScansConfig.settingId,
                settingState: CodeWhispererConstants.autoScansConfig.activated,
            })
        })

        it('emits aws_modifySetting event on user toggling autoScans -- deactivate', async function () {
            codeScansState = new TestCodeScansState(true)
            assert.strictEqual(codeScansState.isScansEnabled(), true)

            targetCommand = testCommand(toggleCodeScans, codeScansState)
            await targetCommand.execute(placeholder, cwQuickPickSource)

            assert.strictEqual(codeScansState.isScansEnabled(), false)
            assertTelemetryCurried('aws_modifySetting')({
                settingId: CodeWhispererConstants.autoScansConfig.settingId,
                settingState: CodeWhispererConstants.autoScansConfig.deactivated,
            })
        })

        it('includes the "source" in the command execution metric', async function () {
            targetCommand = testCommand(toggleCodeScans, codeScansState)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', { source: cwQuickPickSource, command: targetCommand.id })
        })
    })

    describe('showSecurityScan', function () {
        let mockExtensionContext: vscode.ExtensionContext
        let mockSecurityPanelViewProvider: SecurityPanelViewProvider
        let mockClient: DefaultCodeWhispererClient
        let mockExtContext: ExtContext

        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
            mockExtensionContext = await FakeExtensionContext.create()
            mockSecurityPanelViewProvider = new SecurityPanelViewProvider(mockExtensionContext)
            mockClient = stub(DefaultCodeWhispererClient)
            mockExtContext = await FakeExtensionContext.getFakeExtContext()
        })

        afterEach(function () {
            targetCommand?.dispose()
            sinon.restore()
            codeScanState.setToNotStarted()
        })

        it('prompts user to reauthenticate if connection is expired', async function () {
            targetCommand = testCommand(showSecurityScan, mockExtContext, mockSecurityPanelViewProvider, mockClient)

            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(true)
            const spy = sinon.stub(AuthUtil.instance, 'showReauthenticatePrompt')

            await targetCommand.execute(placeholder, cwQuickPickSource)
            assert.ok(spy.called)
        })

        it('includes the "source" in the command execution metric', async function () {
            targetCommand = testCommand(showSecurityScan, mockExtContext, mockSecurityPanelViewProvider, mockClient)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', { source: cwQuickPickSource, command: targetCommand.id })
        })
    })

    describe('showFileScan', function () {
        let mockExtensionContext: vscode.ExtensionContext
        let mockSecurityPanelViewProvider: SecurityPanelViewProvider
        let mockClient: DefaultCodeWhispererClient
        let mockExtContext: ExtContext

        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
            mockExtensionContext = await FakeExtensionContext.create()
            mockSecurityPanelViewProvider = new SecurityPanelViewProvider(mockExtensionContext)
            mockClient = stub(DefaultCodeWhispererClient)
            mockExtContext = await FakeExtensionContext.getFakeExtContext()
        })

        afterEach(function () {
            targetCommand?.dispose()
            sinon.restore()
            codeScanState.setToNotStarted()
        })

        it('prompts user to reauthenticate if connection is expired', async function () {
            targetCommand = testCommand(showFileScan, mockExtContext, mockSecurityPanelViewProvider, mockClient)

            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(true)
            const spy = sinon.stub(AuthUtil.instance, 'showReauthenticatePrompt')

            await targetCommand.execute(placeholder, cwQuickPickSource)
            assert.ok(spy.called)
        })

        it('includes the "source" in the command execution metric', async function () {
            targetCommand = testCommand(showFileScan, mockExtContext, mockSecurityPanelViewProvider, mockClient)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', { source: cwQuickPickSource, command: targetCommand.id })
        })
    })

    describe('showReferenceLog', function () {
        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
        })

        afterEach(function () {
            targetCommand?.dispose()
            sinon.restore()
        })

        it('includes the "source" in the command execution metric', async function () {
            targetCommand = testCommand(showReferenceLog)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', { source: cwQuickPickSource, command: targetCommand.id })
        })
    })

    describe('selectCustomizationPrompt', function () {
        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
        })

        afterEach(function () {
            targetCommand?.dispose()
            sinon.restore()
        })

        it('includes the "source" in the command execution metric', async function () {
            targetCommand = testCommand(selectCustomizationPrompt)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', { source: cwQuickPickSource, command: targetCommand.id })
        })
    })

    describe('reconnect', function () {
        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
        })

        afterEach(function () {
            targetCommand?.dispose()
            sinon.restore()
        })

        it('includes the "source" in the command execution metric', async function () {
            sinon.stub(AuthUtil.instance, 'reauthenticate')
            targetCommand = testCommand(reconnect)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', { source: cwQuickPickSource, command: targetCommand.id })
        })
    })

    describe('signoutCodeWhisperer', function () {
        beforeEach(async function () {
            await resetCodeWhispererGlobalVariables()
        })

        afterEach(function () {
            targetCommand?.dispose()
            sinon.restore()
        })

        it('includes the "source" in the command execution metric', async function () {
            tryRegister(focusAmazonQPanel)
            sinon.stub(AuthUtil.instance.secondaryAuth, 'deleteConnection')
            targetCommand = testCommand(signoutCodeWhisperer, AuthUtil.instance)
            await targetCommand.execute(placeholder, cwQuickPickSource)
            assertTelemetry('vscode_executeCommand', [
                { source: cwQuickPickSource, command: focusAmazonQPanel.id },
                { source: cwQuickPickSource, command: targetCommand.id },
            ])
        })
    })

    describe('listCodeWhispererCommands()', function () {
        function genericItems() {
            return [createFeedbackNode(), createGitHubNode(), createDocumentationNode()]
        }

        before(async function () {
            tryRegister(listCodeWhispererCommands)
        })

        it('shows expected items when not connected', async function () {
            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(false)
            sinon.stub(AuthUtil.instance, 'isConnected').returns(false)

            getTestWindow().onDidShowQuickPick((e) => {
                e.assertContainsItems(createSignIn(), createLearnMore(), ...genericItems())
                e.dispose() // skip needing to select an item to continue
            })

            await listCodeWhispererCommands.execute()
        })

        it('shows expected items when connection is expired', async function () {
            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(true)
            sinon.stub(AuthUtil.instance, 'isConnected').returns(true)

            getTestWindow().onDidShowQuickPick((e) => {
                e.assertContainsItems(createReconnect(), createLearnMore(), ...genericItems(), createSignout())
                e.dispose() // skip needing to select an item to continue
            })

            await listCodeWhispererCommands.execute()
        })

        it('shows expected quick pick items when connected', async function () {
            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(false)
            sinon.stub(AuthUtil.instance, 'isConnected').returns(true)
            await CodeScansState.instance.setScansEnabled(false)
            getTestWindow().onDidShowQuickPick((e) => {
                e.assertContainsItems(
                    createAutoSuggestions(true),
                    createOpenReferenceLog(),
                    createGettingStarted(),
                    createAutoScans(false),
                    switchToAmazonQNode(),
                    ...genericItems(),
                    createSettingsNode(),
                    createSignout()
                )
                e.dispose() // skip needing to select an item to continue
            })
            await listCodeWhispererCommands.execute()
        })

        it('also shows customizations when connected to valid sso', async function () {
            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(false)
            sinon.stub(AuthUtil.instance, 'isConnected').returns(true)
            sinon.stub(AuthUtil.instance, 'isValidEnterpriseSsoInUse').returns(true)
            sinon.stub(AuthUtil.instance, 'isCustomizationFeatureEnabled').value(true)
            await CodeScansState.instance.setScansEnabled(false)

            getTestWindow().onDidShowQuickPick(async (e) => {
                e.assertContainsItems(
                    createAutoSuggestions(true),
                    createOpenReferenceLog(),
                    createGettingStarted(),
                    createAutoScans(false),
                    createSelectCustomization(),
                    switchToAmazonQNode(),
                    ...genericItems(),
                    createSettingsNode(),
                    createSignout()
                )
                e.dispose() // skip needing to select an item to continue
            })

            await listCodeWhispererCommands.execute()
        })

        it('should not show auto-scans if using builder id', async function () {
            sinon.stub(AuthUtil.instance, 'isConnected').returns(true)
            sinon.stub(AuthUtil.instance, 'isBuilderIdInUse').returns(true)

            getTestWindow().onDidShowQuickPick(async (e) => {
                e.assertItems([
                    createSeparator('Inline Suggestions'),
                    createAutoSuggestions(true),
                    createOpenReferenceLog(),
                    createGettingStarted(),
                    createSeparator('Code Reviews'),
                    createSecurityScan(),
                    createSeparator('Other Features'),
                    switchToAmazonQNode(),
                    createSeparator('Connect / Help'),
                    ...genericItems(),
                    createSeparator(),
                    createSettingsNode(),
                    createManageSubscription(),
                    createSignout(),
                ])
                e.dispose() // skip needing to select an item to continue
            })
            await listCodeWhispererCommands.execute()
        })

        it('includes sign out when connected and not in SageMaker', async function () {
            sinon.stub(AuthUtil.instance, 'isConnected').returns(true)
            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(false)
            sinon.stub(extUtils, 'isSageMaker').value(false)
            await CodeScansState.instance.setScansEnabled(false)

            getTestWindow().onDidShowQuickPick((e) => {
                e.assertContainsItems(
                    createAutoSuggestions(true),
                    createOpenReferenceLog(),
                    createGettingStarted(),
                    createAutoScans(false),
                    switchToAmazonQNode(),
                    ...genericItems(),
                    createSettingsNode(),
                    createManageSubscription(),
                    createSignout()
                )
                e.dispose()
            })

            await listCodeWhispererCommands.execute()
        })

        it('shows expected items when connection is expired and in SageMaker', async function () {
            sinon.stub(AuthUtil.instance, 'isConnected').returns(true)
            sinon.stub(AuthUtil.instance, 'isConnectionExpired').returns(true)
            sinon.stub(extUtils, 'isSageMaker').value(true)

            getTestWindow().onDidShowQuickPick((e) => {
                e.assertContainsItems(createReconnect(), createLearnMore(), ...genericItems())
                e.dispose()
            })

            await listCodeWhispererCommands.execute()
        })
    })

    describe('applySecurityFix', function () {
        let sandbox: sinon.SinonSandbox
        let openTextDocumentMock: sinon.SinonStub
        let replaceMock: sinon.SinonStub
        let applyEditMock: sinon.SinonStub
        let removeDiagnosticMock: sinon.SinonStub
        let removeIssueMock: sinon.SinonStub
        let codeScanIssue: CodeScanIssue
        let showTextDocumentMock: sinon.SinonStub

        beforeEach(function () {
            sandbox = sinon.createSandbox()
            openTextDocumentMock = sinon.stub()
            replaceMock = sinon.stub()
            applyEditMock = sinon.stub()
            removeDiagnosticMock = sinon.stub()
            removeIssueMock = sinon.stub()
            codeScanIssue = createCodeScanIssue({
                findingId: randomUUID(),
            })
            showTextDocumentMock = sinon.stub()
        })

        afterEach(function () {
            sandbox.restore()
        })

        it('should call applySecurityFix command successfully', async function () {
            const fileName = 'sample.py'
            const textDocumentMock = createMockDocument('first line\n second line\n fourth line', fileName)

            openTextDocumentMock.resolves(textDocumentMock)
            sandbox.stub(vscode.workspace, 'openTextDocument').value(openTextDocumentMock)

            sandbox.stub(vscode.WorkspaceEdit.prototype, 'replace').value(replaceMock)
            applyEditMock.resolves(true)
            sandbox.stub(vscode.workspace, 'applyEdit').value(applyEditMock)
            sandbox.stub(diagnosticsProvider, 'removeDiagnostic').value(removeDiagnosticMock)
            sandbox.stub(SecurityIssueProvider.instance, 'removeIssue').value(removeIssueMock)
            sandbox.stub(vscode.window, 'showTextDocument').value(showTextDocumentMock)

            targetCommand = testCommand(applySecurityFix)
            codeScanIssue.suggestedFixes = [
                {
                    description: 'fix',
                    code: '@@ -1,3 +1,3 @@\n first line\n- second line\n+ third line\n  fourth line',
                },
            ]
            await targetCommand.execute(codeScanIssue, fileName, 'hover')
            assert.ok(
                replaceMock.calledOnceWith(
                    textDocumentMock.uri,
                    new vscode.Range(0, 0, 2, 12),
                    'first line\n third line\n fourth line'
                )
            )
            assert.ok(applyEditMock.calledOnce)
            assert.ok(removeDiagnosticMock.calledOnceWith(textDocumentMock.uri, codeScanIssue))
            assert.ok(removeIssueMock.calledOnce)

            assertTelemetry('codewhisperer_codeScanIssueApplyFix', {
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                component: 'hover',
                result: 'Succeeded',
            })
        })

        it('handles patch failure', async function () {
            const textDocumentMock = createMockDocument('first line\nsecond line\nthird line\nfourth line\nfifth line')

            openTextDocumentMock.resolves(textDocumentMock)

            sandbox.stub(vscode.workspace, 'openTextDocument').value(openTextDocumentMock)

            targetCommand = testCommand(applySecurityFix)
            codeScanIssue.suggestedFixes = [
                {
                    code: "@@ -3,1 +3,1 @@\n fix\n that\n-doesn't\n+match\n the\n document",
                    description: 'dummy',
                },
            ]
            await targetCommand.execute(codeScanIssue, 'test.py', 'webview')

            assert.strictEqual(getTestWindow().shownMessages[0].message, 'Failed to apply suggested code fix.')
            assertTelemetry('codewhisperer_codeScanIssueApplyFix', {
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                component: 'webview',
                result: 'Failed',
                reason: 'Error',
                reasonDesc: 'Failed to get updated content from applying diff patch',
            })
        })

        it('should allow up to 4 differing lines', async function () {
            const textDocumentMock = createMockDocument('first line\nsecond line\nthird line\nfourth line\nfifth line')
            openTextDocumentMock.resolves(textDocumentMock)
            sandbox.stub(vscode.workspace, 'openTextDocument').value(openTextDocumentMock)
            sandbox.stub(vscode.WorkspaceEdit.prototype, 'replace').value(replaceMock)
            applyEditMock.resolves(true)
            sandbox.stub(vscode.workspace, 'applyEdit').value(applyEditMock)
            sandbox.stub(diagnosticsProvider, 'removeDiagnostic').value(removeDiagnosticMock)
            sandbox.stub(SecurityIssueProvider.instance, 'removeIssue').value(removeIssueMock)
            sandbox.stub(vscode.window, 'showTextDocument').value(showTextDocumentMock)

            targetCommand = testCommand(applySecurityFix)
            codeScanIssue.suggestedFixes = [
                {
                    code: '@@ -1,1 +1,1 @@\n first line\n changed\n-third line\n+changed\n foobar\n fifth line',
                    description: 'dummy',
                },
            ]
            await targetCommand.execute(codeScanIssue, 'test.py', 'webview')
            assertTelemetry('codewhisperer_codeScanIssueApplyFix', {
                result: 'Succeeded',
            })
        })

        it('handles apply edit failure', async function () {
            const fileName = 'sample.py'
            const textDocumentMock = createMockDocument('first line\n second line\n fourth line', fileName)

            openTextDocumentMock.resolves(textDocumentMock)

            sandbox.stub(vscode.workspace, 'openTextDocument').value(openTextDocumentMock)

            sinon.stub(vscode.WorkspaceEdit.prototype, 'replace').value(replaceMock)
            applyEditMock.resolves(false)
            sinon.stub(vscode.workspace, 'applyEdit').value(applyEditMock)

            targetCommand = testCommand(applySecurityFix)
            codeScanIssue.suggestedFixes = [
                {
                    description: 'fix',
                    code: '@@ -1,3 +1,3 @@\n first line\n- second line\n+ third line\n  fourth line',
                },
            ]
            await targetCommand.execute(codeScanIssue, fileName, 'quickfix')

            assert.ok(replaceMock.calledOnce)
            assertLogsContain('Apply fix command failed. Error: Failed to apply edit to the workspace.', true, 'error')
            assertTelemetry('codewhisperer_codeScanIssueApplyFix', {
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                component: 'quickfix',
                result: 'Failed',
                reason: 'Error',
                reasonDesc: 'Failed to apply edit to the workspace.',
            })
        })

        it('should apply the edit at the correct range', async function () {
            const fileName = 'sample.py'
            const textDocumentMock = createMockDocument(
                `from flask import app


@app.route('/')
def execute_input_noncompliant():
    from flask import request
    module_version = request.args.get("module_version")
    # Noncompliant: executes unsanitized inputs.
    exec("import urllib%s as urllib" % module_version)
# {/fact}


# {fact rule=code-injection@v1.0 defects=0}
from flask import app


@app.route('/')
def execute_input_compliant():
    from flask import request
    module_version = request.args.get("module_version")
    # Compliant: executes sanitized inputs.
    exec("import urllib%d as urllib" % int(module_version))
# {/fact}`,
                fileName
            )
            openTextDocumentMock.resolves(textDocumentMock)
            sandbox.stub(vscode.workspace, 'openTextDocument').value(openTextDocumentMock)

            sandbox.stub(vscode.WorkspaceEdit.prototype, 'replace').value(replaceMock)
            applyEditMock.resolves(true)
            sandbox.stub(vscode.workspace, 'applyEdit').value(applyEditMock)
            sandbox.stub(diagnosticsProvider, 'removeDiagnostic').value(removeDiagnosticMock)
            sandbox.stub(SecurityIssueProvider.instance, 'removeIssue').value(removeIssueMock)
            sandbox.stub(vscode.window, 'showTextDocument').value(showTextDocumentMock)

            targetCommand = testCommand(applySecurityFix)
            codeScanIssue.suggestedFixes = [
                {
                    code: `@@ -6,4 +6,5 @@
     from flask import request
     module_version = request.args.get("module_version")
     # Noncompliant: executes unsanitized inputs.
-    exec("import urllib%d as urllib" % int(module_version))
+    __import__("urllib" + module_version)
+#import importlib`,
                    description: 'dummy',
                },
            ]
            await targetCommand.execute(codeScanIssue, fileName, 'webview')
            assert.ok(
                replaceMock.calledOnceWith(
                    textDocumentMock.uri,
                    new vscode.Range(5, 0, 8, 54),
                    `    from flask import request
    module_version = request.args.get("module_version")
    # Noncompliant: executes unsanitized inputs.
    __import__("urllib" + module_version)
#import importlib`
                )
            )
            assert.ok(applyEditMock.calledOnce)
            assert.ok(removeDiagnosticMock.calledOnceWith(textDocumentMock.uri, codeScanIssue))
            assert.ok(removeIssueMock.calledOnce)

            assertTelemetry('codewhisperer_codeScanIssueApplyFix', {
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                component: 'webview',
                result: 'Succeeded',
            })
        })
    })

    // TODO: Add integ test for generateTest

    describe('rejectFix', function () {
        let mockExtensionContext: vscode.ExtensionContext
        let sandbox: sinon.SinonSandbox
        let filePath: string
        let codeScanIssue: CodeScanIssue
        let issueItem: IssueItem
        let updateSecurityIssueWebviewMock: sinon.SinonStub
        let updateIssueMock: sinon.SinonStub
        let refreshTreeViewMock: sinon.SinonStub

        beforeEach(async function () {
            sandbox = sinon.createSandbox()
            filePath = 'dummy/file.py'
            codeScanIssue = createCodeScanIssue({
                findingId: randomUUID(),
                suggestedFixes: [{ code: 'diff', description: 'description' }],
            })
            issueItem = new IssueItem(filePath, codeScanIssue)
            updateSecurityIssueWebviewMock = sinon.stub()
            updateIssueMock = sinon.stub()
            refreshTreeViewMock = sinon.stub()
            mockExtensionContext = await FakeExtensionContext.create()
        })

        afterEach(function () {
            sandbox.restore()
        })

        it('should call rejectFix command successfully', async function () {
            sinon.stub(securityIssueWebview, 'updateSecurityIssueWebview').value(updateSecurityIssueWebviewMock)
            sinon.stub(SecurityIssueProvider.instance, 'updateIssue').value(updateIssueMock)
            sinon.stub(SecurityIssueTreeViewProvider.instance, 'refresh').value(refreshTreeViewMock)
            targetCommand = testCommand(rejectFix, mockExtensionContext)
            await targetCommand.execute(codeScanIssue, filePath)

            const expectedUpdatedIssue = { ...codeScanIssue, suggestedFixes: [] }
            assert.ok(updateIssueMock.calledWith(expectedUpdatedIssue, filePath))
            assert.ok(refreshTreeViewMock.calledOnce)
        })

        it('should call rejectFix from tree view item', async function () {
            sinon.stub(securityIssueWebview, 'updateSecurityIssueWebview').value(updateSecurityIssueWebviewMock)
            sinon.stub(SecurityIssueProvider.instance, 'updateIssue').value(updateIssueMock)
            sinon.stub(SecurityIssueTreeViewProvider.instance, 'refresh').value(refreshTreeViewMock)
            targetCommand = testCommand(rejectFix, mockExtensionContext)
            await targetCommand.execute(issueItem, filePath)

            const expectedUpdatedIssue = { ...codeScanIssue, suggestedFixes: [] }
            assert.ok(updateIssueMock.calledWith(expectedUpdatedIssue, filePath))
            assert.ok(refreshTreeViewMock.calledOnce)
        })
    })

    describe('ignoreAllIssues', function () {
        let sandbox: sinon.SinonSandbox
        let codeScanIssue: CodeScanIssue
        let issueItem: IssueItem
        let addToIgnoredSecurityIssuesListMock: sinon.SinonStub
        let closeSecurityIssueWebviewMock: sinon.SinonStub

        beforeEach(function () {
            sandbox = sinon.createSandbox()
            codeScanIssue = createCodeScanIssue()
            issueItem = new IssueItem('dummy/file.py', codeScanIssue)
            addToIgnoredSecurityIssuesListMock = sinon.stub()
            closeSecurityIssueWebviewMock = sinon.stub()
        })

        afterEach(function () {
            sandbox.restore()
        })

        it('should call ignoreAllIssues command successfully', async function () {
            sinon
                .stub(CodeWhispererSettings.instance, 'addToIgnoredSecurityIssuesList')
                .value(addToIgnoredSecurityIssuesListMock)
            sinon.stub(securityIssueWebview, 'closeSecurityIssueWebview').value(closeSecurityIssueWebviewMock)
            targetCommand = testCommand(ignoreAllIssues)
            getTestWindow().onDidShowMessage((m) => {
                if (m.message === CodeWhispererConstants.ignoreAllIssuesMessage(codeScanIssue.title)) {
                    m.selectItem(confirm)
                }
            })
            await targetCommand.execute(codeScanIssue, 'webview')

            assert.ok(addToIgnoredSecurityIssuesListMock.calledWith(codeScanIssue.title))
            assert.ok(closeSecurityIssueWebviewMock.calledOnce)

            assertTelemetry('codewhisperer_codeScanIssueIgnore', {
                component: 'webview',
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                ruleId: codeScanIssue.ruleId,
                variant: 'all',
                result: 'Succeeded',
            })
        })

        it('should call ignoreAllIssues from tree view item', async function () {
            sinon
                .stub(CodeWhispererSettings.instance, 'addToIgnoredSecurityIssuesList')
                .value(addToIgnoredSecurityIssuesListMock)
            targetCommand = testCommand(ignoreAllIssues)
            getTestWindow().onDidShowMessage((m) => {
                if (m.message === CodeWhispererConstants.ignoreAllIssuesMessage(codeScanIssue.title)) {
                    m.selectItem(confirm)
                }
            })
            await targetCommand.execute(issueItem)

            assert.ok(addToIgnoredSecurityIssuesListMock.calledWith(codeScanIssue.title))

            assertTelemetry('codewhisperer_codeScanIssueIgnore', {
                component: 'tree',
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                ruleId: codeScanIssue.ruleId,
                variant: 'all',
                result: 'Succeeded',
            })
        })
    })

    describe('ignoreIssue', function () {
        let sandbox: sinon.SinonSandbox
        let codeScanIssue: CodeScanIssue
        let issueItem: IssueItem
        let mockDocument: vscode.TextDocument
        let insertCommentMock: sinon.SinonStub
        let showTextDocumentMock: sinon.SinonStub

        beforeEach(function () {
            sandbox = sinon.createSandbox()
            codeScanIssue = createCodeScanIssue()
            issueItem = new IssueItem('dummy/file.py', codeScanIssue)
            mockDocument = createMockDocument()
            insertCommentMock = sinon.stub()
            showTextDocumentMock = sinon.stub()
        })

        afterEach(function () {
            sandbox.restore()
        })

        it('should call ignoreIssue command successfully', async function () {
            sinon.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument)
            sinon.stub(commentUtils, 'insertCommentAboveLine').value(insertCommentMock)
            sinon.stub(vscode.window, 'showTextDocument').value(showTextDocumentMock)
            targetCommand = testCommand(ignoreIssue)
            await targetCommand.execute(codeScanIssue, 'filepath', 'webview')

            assert.ok(
                insertCommentMock.calledOnceWith(
                    mockDocument,
                    codeScanIssue.startLine,
                    CodeWhispererConstants.amazonqIgnoreNextLine
                )
            )

            assertTelemetry('codewhisperer_codeScanIssueIgnore', {
                component: 'webview',
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                ruleId: codeScanIssue.ruleId,
                result: 'Succeeded',
            })
        })

        it('should call ignoreIssue from tree view item', async function () {
            sinon.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument)
            sinon.stub(commentUtils, 'insertCommentAboveLine').value(insertCommentMock)
            sinon.stub(vscode.window, 'showTextDocument').value(showTextDocumentMock)
            targetCommand = testCommand(ignoreIssue)
            await targetCommand.execute(issueItem)

            assert.ok(
                insertCommentMock.calledOnceWith(
                    mockDocument,
                    codeScanIssue.startLine,
                    CodeWhispererConstants.amazonqIgnoreNextLine
                )
            )

            assertTelemetry('codewhisperer_codeScanIssueIgnore', {
                component: 'tree',
                detectorId: codeScanIssue.detectorId,
                findingId: codeScanIssue.findingId,
                ruleId: codeScanIssue.ruleId,
                result: 'Succeeded',
            })
        })
    })
})
