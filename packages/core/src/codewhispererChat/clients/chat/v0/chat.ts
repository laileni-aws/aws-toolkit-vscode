/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { SendMessageCommandOutput, SendMessageRequest } from '@amzn/amazon-q-developer-streaming-client'
import {
    ChatMessage,
    GenerateAssistantResponseCommandOutput,
    GenerateAssistantResponseRequest,
    ToolUse,
    UserInputMessage,
} from '@amzn/codewhisperer-streaming'
import * as vscode from 'vscode'
import { ToolkitError } from '../../../../shared/errors'
import { createCodeWhispererChatStreamingClient } from '../../../../shared/clients/codewhispererChatClient'
import { createQDeveloperStreamingClient } from '../../../../shared/clients/qDeveloperChatClient'
import { UserWrittenCodeTracker } from '../../../../codewhisperer/tracker/userWrittenCodeTracker'
import { getLogger } from '../../../../shared/logger/logger'

export class ChatSession {
    private sessionId?: string
    private _toolUse: ToolUse | undefined
    private _chatHistory: ChatMessage[] = []

    contexts: Map<string, { first: number; second: number }[]> = new Map()
    // TODO: doesn't handle the edge case when two files share the same relativePath string but from different root
    // e.g. root_a/file1 vs root_b/file1
    relativePathToWorkspaceRoot: Map<string, string> = new Map()
    public get sessionIdentifier(): string | undefined {
        return this.sessionId
    }
    public get toolUse(): ToolUse | undefined {
        return this._toolUse
    }
    public get chatHistory(): ChatMessage[] {
        return this._chatHistory
    }
    private set chatHistory(chatHistory: ChatMessage[]) {
        this.chatHistory = chatHistory
    }

    public tokenSource!: vscode.CancellationTokenSource

    constructor() {
        this.createNewTokenSource()
    }

    createNewTokenSource() {
        this.tokenSource = new vscode.CancellationTokenSource()
    }

    public setSessionID(id?: string) {
        this.sessionId = id
    }
    public setToolUse(toolUse: ToolUse | undefined) {
        this._toolUse = toolUse
    }
    public pushToChatHistory(message: ChatMessage | undefined) {
        if (message === undefined) {
            return
        }
        getLogger().debug('Pushing to chat history: %O', message)
        this._chatHistory.push(this.formatChatHistoryMessage(message))
    }

    private formatChatHistoryMessage(message: ChatMessage): ChatMessage {
        if (message.userInputMessage !== undefined) {
            return {
                userInputMessage: {
                    ...message.userInputMessage,
                    userInputMessageContext: {
                        ...message.userInputMessage.userInputMessageContext,
                        tools: undefined,
                    },
                },
            }
        }
        return message
    }

    /**
     * Updates the history so that, when non-empty, the following invariants are in place:
     * 1. The history length is <= MAX_CONVERSATION_STATE_HISTORY_LEN. Oldest messages are dropped.
     * 2. The first message is from the user, and does not contain tool results. Oldest messages are dropped.
     * 3. The last message is from the assistant. The last message is dropped if it is from the user.
     * 4. If the last message is from the assistant and it contains tool uses, and a next user
     *    message is set without tool results, then the user message will have cancelled tool results.
     */
    private fixHistory(nextMessage: UserInputMessage | undefined): void {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const MAX_CONVERSATION_STATE_HISTORY_LEN = 100

        // Trim the conversation history by finding the second oldest message from the user without
        // tool results - this will be the new oldest message in the history.
        if (this.chatHistory.length > MAX_CONVERSATION_STATE_HISTORY_LEN) {
            // Skip the first message which should be from the user
            const indexToKeep = this.chatHistory.slice(1).findIndex((message, index) => {
                return (
                    message.userInputMessage &&
                    (!message.userInputMessage.userInputMessageContext?.toolResults ||
                        message.userInputMessage.userInputMessageContext.toolResults.length === 0) &&
                    message.userInputMessage.content !== ''
                )
            })

            if (indexToKeep !== -1) {
                // Add 1 because we skipped the first element in the slice
                const actualIndex = indexToKeep + 1
                getLogger().debug(`removing the first ${actualIndex} elements in the history`)
                this.chatHistory = this.chatHistory.slice(actualIndex)
            } else {
                getLogger().debug('no valid starting user message found in the history, clearing')
                this.chatHistory = []

                // Edge case: if the next message contains tool results, then we have to just abandon them
                if (
                    nextMessage &&
                    nextMessage.userInputMessageContext &&
                    nextMessage.userInputMessageContext.toolResults &&
                    nextMessage.userInputMessageContext.toolResults.length > 0
                ) {
                    nextMessage.content = 'The conversation history has overflowed, clearing state'
                    nextMessage.userInputMessageContext.toolResults = undefined
                }
            }
        }

        // If the last message is from the user, drop it
        const lastMessage = this.chatHistory[this.chatHistory.length - 1]
        if (lastMessage && lastMessage.userInputMessage) {
            getLogger().debug('last message in history is from the user, dropping %O', lastMessage)
            this.chatHistory.pop()
        }

        // If the last message from the assistant contains tool uses, we need to ensure that the
        // next user message contains tool results.
        const lastAssistantMessage = this.chatHistory[this.chatHistory.length - 1]
        if (
            lastAssistantMessage &&
            lastAssistantMessage.assistantResponseMessage &&
            lastAssistantMessage.assistantResponseMessage.toolUses &&
            lastAssistantMessage.assistantResponseMessage.toolUses.length > 0 &&
            nextMessage
        ) {
            if (
                nextMessage.userInputMessageContext &&
                (!nextMessage.userInputMessageContext.toolResults ||
                    nextMessage.userInputMessageContext.toolResults.length === 0)
            ) {
                // Add tool results if they don't exist
                nextMessage.userInputMessageContext.toolResults =
                    lastAssistantMessage.assistantResponseMessage.toolUses?.map((toolUse) => ({
                        toolUseId: toolUse.toolUseId,
                        content: [{ type: 'text', text: 'Tool use was cancelled by the user' }],
                        status: 'error',
                    }))
            }
        }
    }

    async chatIam(chatRequest: SendMessageRequest): Promise<SendMessageCommandOutput> {
        const client = await createQDeveloperStreamingClient()

        const response = await client.sendMessage(chatRequest)
        if (!response.sendMessageResponse) {
            throw new ToolkitError(
                `Empty chat response. Session id: ${this.sessionId} Request ID: ${response.$metadata.requestId}`
            )
        }

        const responseStream = response.sendMessageResponse
        for await (const event of responseStream) {
            if ('messageMetadataEvent' in event) {
                this.sessionId = event.messageMetadataEvent?.conversationId
                break
            }
        }

        UserWrittenCodeTracker.instance.onQFeatureInvoked()
        return response
    }

    async chatSso(chatRequest: GenerateAssistantResponseRequest): Promise<GenerateAssistantResponseCommandOutput> {
        const client = await createCodeWhispererChatStreamingClient()

        if (this.sessionId !== '' && this.sessionId !== undefined && chatRequest.conversationState !== undefined) {
            chatRequest.conversationState.conversationId = this.sessionId
        }

        this.fixHistory(chatRequest.conversationState?.currentMessage?.userInputMessage)
        getLogger().debug('Chat history: %O', this.chatHistory)
        const response = await client.generateAssistantResponse(chatRequest)
        getLogger().debug('GenerateAssistantResponse RequestID: %s', response.$metadata.requestId)
        if (!response.generateAssistantResponseResponse) {
            throw new ToolkitError(
                `Empty chat response. Session id: ${this.sessionId} Request ID: ${response.$metadata.requestId}`
            )
        }

        this.sessionId = response.conversationId

        UserWrittenCodeTracker.instance.onQFeatureInvoked()

        return response
    }
}
