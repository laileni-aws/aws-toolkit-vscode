/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * This class is responsible for responding to UI events by calling
 * the Scan extension.
 */
import * as vscode from 'vscode'
import { Messenger } from './messenger/messenger'
import { AuthController } from '../../../amazonq/auth/controller'
import { ChatSessionManager } from '../storages/chatSession'
import { ConversationState, Session } from '../session/session'
import { getLogger } from '../../../shared/logger'
import { featureName } from '../../models/constants'
import { AuthUtil } from '../../../codewhisperer/util/authUtil'
import { AggregatedCodeScanIssue } from '../../../codewhisperer/models/model'
import MessengerUtils, { ButtonActions, ScanCommands } from './messenger/messengerUtils'
import { openUrl } from '../../../shared/utilities/vsCodeUtils'
import { telemetry } from '../../../shared/telemetry/telemetry'
import { MetadataResult } from '../../../shared/telemetry/telemetryClient'
import { showFileScan, showSecurityScan } from '../../../codewhisperer/commands/basicCommands'
import { placeholder } from '../../../shared/vscode/commands2'
import { cwQuickPickSource } from '../../../codewhisperer/commands/types'
import { i18n } from '../../../shared/i18n-helper'

// These events can be interactions within the chat,
// or elsewhere in the IDE
export interface ScanChatControllerEventEmitters {
    readonly runScan: vscode.EventEmitter<any>
    readonly tabOpened: vscode.EventEmitter<any>
    readonly tabClosed: vscode.EventEmitter<any>
    readonly authClicked: vscode.EventEmitter<any>
    readonly formActionClicked: vscode.EventEmitter<any>
    readonly commandSentFromIDE: vscode.EventEmitter<any>
    readonly transformationFinished: vscode.EventEmitter<any>
    readonly processHumanChatMessage: vscode.EventEmitter<any>
    readonly linkClicked: vscode.EventEmitter<any>
    readonly errorThrown: vscode.EventEmitter<any>
    readonly showSecurityScan: vscode.EventEmitter<any>
}

export class ScanController {
    private readonly messenger: Messenger
    private readonly sessionStorage: ChatSessionManager
    private authController: AuthController

    public constructor(
        private readonly chatControllerMessageListeners: ScanChatControllerEventEmitters,
        messenger: Messenger,
        onDidChangeAmazonQVisibility: vscode.Event<boolean>
    ) {
        this.messenger = messenger
        this.sessionStorage = ChatSessionManager.Instance
        this.authController = new AuthController()
        this.chatControllerMessageListeners.runScan.event((data) => {
            return this.scanInitiated(data)
        })

        this.chatControllerMessageListeners.tabOpened.event((data) => {
            return this.tabOpened(data)
        })

        this.chatControllerMessageListeners.tabClosed.event((data) => {
            return this.tabClosed(data)
        })

        this.chatControllerMessageListeners.authClicked.event((data) => {
            this.authClicked(data)
        })

        this.chatControllerMessageListeners.commandSentFromIDE.event((data) => {
            return this.commandSentFromIDE(data)
        })

        this.chatControllerMessageListeners.formActionClicked.event((data) => {
            return this.formActionClicked(data)
        })

        this.chatControllerMessageListeners.transformationFinished.event((data) => {
            return this.transformationFinished(data)
        })

        this.chatControllerMessageListeners.processHumanChatMessage.event((data) => {
            return this.processHumanChatMessage(data)
        })

        this.chatControllerMessageListeners.linkClicked.event((data) => {
            this.openLink(data)
        })

        this.chatControllerMessageListeners.errorThrown.event((data) => {
            return this.handleError(data)
        })

        this.chatControllerMessageListeners.showSecurityScan.event((data) => {
            return this.handleScanResults(data)
        })
    }

    private async tabOpened(message: any) {
        const session: Session = this.sessionStorage.getSession()
        const tabID = this.sessionStorage.setActiveTab(message.tabID)

        // check if authentication has expired
        try {
            getLogger().debug(`${featureName}: Session created with id: ${session.tabID}`)

            const authState = await AuthUtil.instance.getChatAuthState()
            if (authState.amazonQ !== 'connected') {
                void this.messenger.sendAuthNeededExceptionMessage(authState, tabID)
                session.isAuthenticating = true
                return
            }
        } catch (err: any) {
            this.messenger.sendErrorMessage(err.message, message.tabID)
        }
    }

    private async tabClosed(data: any) {
        this.sessionStorage.removeActiveTab()
    }

    private authClicked(message: any) {
        this.authController.handleAuth(message.authType)

        this.messenger.sendAnswer({
            type: 'answer',
            tabID: message.tabID,
            message: 'Follow instructions to re-authenticate ...',
        })

        // Explicitly ensure the user goes through the re-authenticate flow
        this.messenger.sendChatInputEnabled(message.tabID, false)
    }

    private commandSentFromIDE(data: any): any {
        this.messenger.sendCommandMessage(data)
    }

    private async scanInitiated(message: any) {
        const session: Session = this.sessionStorage.getSession()

        try {
            await telemetry.codeTransform_initiateTransform.run(async () => {
                // check that a project is open
                const workspaceFolders = vscode.workspace.workspaceFolders
                if (workspaceFolders === undefined || workspaceFolders.length === 0) {
                    this.messenger.sendUnrecoverableErrorResponse('no-project-found', message.tabID)
                    telemetry.record({ result: MetadataResult.Fail, reason: 'no-project-found' })
                    return
                }

                // check that the session is authenticated
                const authState = await AuthUtil.instance.getChatAuthState()
                if (authState.amazonQ !== 'connected') {
                    void this.messenger.sendAuthNeededExceptionMessage(authState, message.tabID)
                    session.isAuthenticating = true
                    telemetry.record({ result: MetadataResult.Fail, reason: 'auth-failed' })
                    return
                }
                this.messenger.sendScans(message.tabID, 'Choose the type of Scan')
            })
        } catch (e: any) {
            // if there was an issue getting the list of valid projects, the error message will be shown here
            this.messenger.sendErrorMessage(e.message, message.tabID)
        }
    }

    private async formActionClicked(message: any) {
        const typedAction = MessengerUtils.stringToEnumValue(ButtonActions, message.action as any)
        switch (typedAction) {
            case ButtonActions.RUN_PROJECT_SCAN:
                await showSecurityScan.execute(placeholder, cwQuickPickSource)
                this.messenger.sendAnswer({
                    type: 'answer-stream',
                    tabID: message.tabID,
                    message: i18n('AWS.amazonq.scans.runProjectScans'),
                })
                this.messenger.sendUpdatePlaceholder(message.tabID, 'Running a Security scan ...') // AWS.amazonq.featureDev.answer.approachCreation
                // await this.transformInitiated(message)
                break
            case ButtonActions.RUN_FILE_SCAN:
                this.messenger.sendAnswer({
                    type: 'answer-stream',
                    tabID: message.tabID,
                    message: i18n('AWS.amazonq.scans.runProjectScans'),
                })
                this.messenger.sendUpdatePlaceholder(
                    message.tabID,
                    'Running a Security scan on current active file ...'
                )
                await showFileScan.execute(placeholder, cwQuickPickSource)
                // toggleCodeScans.execute(placeholder, cwQuickPickSource)
                // await this.transformInitiated(message)
                // this.resetTransformationChatFlow()
                // this.messenger.sendCommandMessage({ ...message, command: GumbyCommands.CLEAR_CHAT })
                // await this.transformInitiated(message)
                break
        }
    }

    private transformationFinished(data: { message: string | undefined; tabID: string }) {
        this.resetTransformationChatFlow()
        // at this point job is either completed, partially_completed, cancelled, or failed
        if (data.message) {
            this.messenger.sendJobFinishedMessage(data.tabID, data.message)
        }
    }

    private resetTransformationChatFlow() {
        this.sessionStorage.getSession().conversationState = ConversationState.IDLE
    }

    private async processHumanChatMessage(data: { message: string; tabID: string }) {
        this.messenger.sendUserPrompt(data.message, data.tabID)
        this.messenger.sendChatInputEnabled(data.tabID, false)
        this.messenger.sendUpdatePlaceholder(data.tabID, 'Open a new tab to chat with Q')
    }

    private openLink(message: { link: string }) {
        void openUrl(vscode.Uri.parse(message.link))
    }

    private async handleError(message: { error: Error; tabID: string }) {}

    private async handleScanResults(message: {
        error: Error
        totalIssues: number
        tabID: string
        securityRecommendationCollection: AggregatedCodeScanIssue[]
    }) {
        void vscode.window.setStatusBarMessage('Came back to Q chat')
        // this.resetTransformationChatFlow()
        this.messenger.sendCommandMessage({ ...message, command: ScanCommands.CLEAR_CHAT })
        this.messenger.sendScanResults(message.tabID, message.totalIssues, message.securityRecommendationCollection) // Todo add issue addon args
        this.messenger.sendScans(message.tabID, 'Choose the type of Scan')
        this.messenger.sendUpdatePlaceholder(message.tabID, `Choose the type of Scan...`)
    }
}
