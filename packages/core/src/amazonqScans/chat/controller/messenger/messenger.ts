/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * This class controls the presentation of the various chat bubbles presented by the
 * Elastic Gumby Transform by Q Experience.
 *
 * As much as possible, all strings used in the experience should originate here.
 */

import { AuthFollowUpType, AuthMessageDataMap } from '../../../../amazonq/auth/model'
import { AggregatedCodeScanIssue } from '../../../../codewhisperer/models/model'
import { FeatureAuthState } from '../../../../codewhisperer/util/authUtil'
import * as CodeWhispererConstants from '../../../../codewhisperer/models/constants'
import {
    AppToWebViewMessageDispatcher,
    AsyncEventProgressMessage,
    AuthNeededException,
    AuthenticationUpdateMessage,
    ChatInputEnabledMessage,
    ChatMessage,
    ErrorMessage,
    SendCommandMessage,
    UpdatePlaceholderMessage,
} from '../../views/connector/connector'
import { ChatItemButton } from '@aws/mynah-ui/dist/static'
import { ButtonActions } from './messengerUtils'
import { ChatItemType } from '../../../../amazonq/commons/model'

export type UnrecoverableErrorType = 'no-project-found'

export class Messenger {
    public constructor(private readonly dispatcher: AppToWebViewMessageDispatcher) {}

    public sendAnswer(params: { message?: string; type: ChatItemType; tabID: string; messageID?: string }) {
        this.dispatcher.sendChatMessage(
            new ChatMessage(
                {
                    message: params.message,
                    messageType: params.type,
                    messageId: params.messageID,
                },
                params.tabID
            )
        )
    }

    public sendErrorMessage(errorMessage: string, tabID: string) {
        this.dispatcher.sendErrorMessage(
            new ErrorMessage(CodeWhispererConstants.genericErrorMessage, errorMessage, tabID)
        )
    }

    public sendChatInputEnabled(tabID: string, enabled: boolean) {
        this.dispatcher.sendChatInputEnabled(new ChatInputEnabledMessage(tabID, enabled))
    }

    public sendUpdatePlaceholder(tabID: string, newPlaceholder: string) {
        this.dispatcher.sendUpdatePlaceholder(new UpdatePlaceholderMessage(tabID, newPlaceholder))
    }

    public async sendAuthNeededExceptionMessage(credentialState: FeatureAuthState, tabID: string) {
        let authType: AuthFollowUpType = 'full-auth'
        let message = AuthMessageDataMap[authType].message

        switch (credentialState.amazonQ) {
            case 'disconnected':
                authType = 'full-auth'
                message = AuthMessageDataMap[authType].message
                break
            case 'unsupported':
                authType = 'use-supported-auth'
                message = AuthMessageDataMap[authType].message
                break
            case 'expired':
                authType = 're-auth'
                message = AuthMessageDataMap[authType].message
                break
        }

        this.dispatcher.sendAuthNeededExceptionMessage(new AuthNeededException(message, authType, tabID))
    }

    public sendAuthenticationUpdate(gumbyEnabled: boolean, authenticatingTabIDs: string[]) {
        this.dispatcher.sendAuthenticationUpdate(new AuthenticationUpdateMessage(gumbyEnabled, authenticatingTabIDs))
    }

    public sendAsyncEventProgress(
        tabID: string,
        inProgress: boolean,
        message: string | undefined = undefined,
        messageId: string | undefined = undefined
    ) {
        this.dispatcher.sendAsyncEventProgress(new AsyncEventProgressMessage(tabID, { inProgress, message, messageId }))
    }

    public sendUserPrompt(prompt: string, tabID: string) {
        this.dispatcher.sendChatMessage(
            new ChatMessage(
                {
                    message: prompt,
                    messageType: 'prompt',
                },
                tabID
            )
        )
    }

    public sendScanResults(
        tabID: string,
        totalIssues: number,
        securityRecommendationCollection: AggregatedCodeScanIssue[]
    ) {
        //TODO: Implement Findings View here after scan success.
        let message = ''
        const issueWord = totalIssues > 1 ? 'issues' : 'issue'

        message = `In this project, there ${totalIssues > 1 ? 'are' : 'is'} <b>${totalIssues}</b> ${issueWord}.<br><br>`

        if (securityRecommendationCollection.length > 0) {
            message += 'Issues by file:<br><ul>'

            securityRecommendationCollection.forEach((aggregatedIssue) => {
                message += `<li><b>${aggregatedIssue.filePath}</b><ul>`

                aggregatedIssue.issues.forEach((issue) => {
                    message += `<li>
                    <b>${issue.title}</b> (${issue.severity})<br>
                    Lines: ${issue.startLine}-${issue.endLine}<br>
                    ${issue.comment}<br>
                    Detector: ${issue.detectorName} (${issue.detectorId})<br>
                    ${issue.recommendation.text}
                </li>`
                })

                message += '</ul></li>'
            })

            message += '</ul>'
        } else {
            message += 'No specific issues found.'
        }

        this.dispatcher.sendChatMessage(
            new ChatMessage(
                {
                    message,
                    messageType: 'ai-prompt',
                },
                tabID
            )
        )
    }

    /**
     * This method renders an error message with a button at the end that will try the
     * transformation again from the beginning. This message is meant for errors that are
     * completely unrecoverable: the job cannot be completed in its current state,
     * and the flow must be tried again.
     */
    public sendUnrecoverableErrorResponse(type: UnrecoverableErrorType, tabID: string) {
        let message = '...'

        switch (type) {
            case 'no-project-found':
                message = CodeWhispererConstants.noOpenProjectsFoundChatMessage //TODO: Modify error message.
                break
        }
        const buttons: ChatItemButton[] = []
        this.dispatcher.sendChatMessage(
            new ChatMessage(
                {
                    message,
                    messageType: 'ai-prompt',
                    buttons,
                },
                tabID
            )
        )
    }

    public sendCommandMessage(message: any) {
        this.dispatcher.sendCommandMessage(new SendCommandMessage(message.command, message.tabID, message.eventId))
    }

    public sendJobFinishedMessage(tabID: string, message: string) {
        const buttons: ChatItemButton[] = []

        this.dispatcher.sendChatMessage(
            new ChatMessage(
                {
                    message,
                    messageType: 'ai-prompt',
                    buttons,
                },
                tabID
            )
        )
    }

    public sendScans(tabID: string, message: string) {
        const buttons: ChatItemButton[] = []
        buttons.push({
            keepCardAfterClick: true,
            text: CodeWhispererConstants.startProjectScan,
            id: ButtonActions.RUN_PROJECT_SCAN,
        })
        buttons.push({
            keepCardAfterClick: true,
            text: CodeWhispererConstants.startFileScan,
            id: ButtonActions.RUN_FILE_SCAN,
        })

        this.dispatcher.sendChatMessage(
            new ChatMessage(
                {
                    message,
                    messageType: 'ai-prompt',
                    buttons,
                },
                tabID
            )
        )
    }

    public sendInProgressMessage(tabID: string, message: string, messageName?: string) {
        this.dispatcher.sendAsyncEventProgress(
            new AsyncEventProgressMessage(tabID, { inProgress: true, message: undefined })
        )

        this.dispatcher.sendAsyncEventProgress(
            new AsyncEventProgressMessage(tabID, {
                inProgress: true,
                message,
            })
        )
    }
}
