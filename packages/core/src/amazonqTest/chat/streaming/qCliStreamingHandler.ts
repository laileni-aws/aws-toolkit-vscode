/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    CodeWhispererStreaming,
    GenerateAssistantResponseCommandInput,
    GenerateAssistantResponseCommandOutput,
    UserIntent,
} from '@amzn/codewhisperer-streaming'
import { createCodeWhispererChatStreamingClient } from '../../../shared/clients/codewhispererChatClient'
import { Messenger } from '../controller/messenger/messenger'
import { Session } from '../session/session'
import { getLogger } from '../../../shared/logger/logger'
import { randomUUID } from '../../../shared/crypto'

/**
 * This class handles streaming responses from Amazon Q Developer API similar to Q CLI
 */
export class QCliStreamingHandler {
    private streamingClient: CodeWhispererStreaming | undefined
    private conversationId: string = ''
    private messageId: string = ''
    private isStreaming: boolean = false
    private abortController: AbortController | undefined

    constructor(private readonly messenger: Messenger) {}

    /**
     * Initialize the streaming client
     */
    public async initialize(): Promise<void> {
        try {
            this.streamingClient = await createCodeWhispererChatStreamingClient()
            this.conversationId = randomUUID()
            getLogger().debug('QCliStreamingHandler initialized with conversationId: %s', this.conversationId)
        } catch (error) {
            getLogger().error('Failed to initialize QCliStreamingHandler: %O', error)
            throw error
        }
    }

    /**
     * Process user prompt and stream response back to the UI
     * @param userPrompt The user's prompt
     * @param tabId The tab ID to send responses to
     * @param session The current session
     */
    public async processUserPrompt(userPrompt: string, tabId: string, session: Session): Promise<void> {
        if (!this.streamingClient) {
            await this.initialize()
        }
        // TODO: For now assuming one user input at a time.
        // if (this.isStreaming) {
        //     getLogger().debug('Already streaming a response, ignoring new prompt')
        //     return
        // }

        try {
            this.isStreaming = true
            this.messageId = randomUUID()
            this.abortController = new AbortController()

            // Disable chat input while streaming
            this.messenger.sendChatInputEnabled(tabId, false)

            // Show user message
            this.messenger.sendMessage(userPrompt, tabId, 'prompt')

            // Start streaming indicator
            this.messenger.sendMessage('', tabId, 'answer-stream', this.messageId)

            // Set up the request
            const input: GenerateAssistantResponseCommandInput = {
                conversationState: {
                    conversationId: this.conversationId,
                    currentMessage: {
                        userInputMessage: {
                            content: userPrompt,
                            userIntent: UserIntent.CODE_GENERATION,
                        },
                    },
                    chatTriggerType: 'MANUAL',
                },
            }

            // Stream the response
            await this.streamResponse(input, tabId)

            // Re-enable chat input
            this.messenger.sendChatInputEnabled(tabId, true)

            getLogger().debug('Streaming completed for messageId: %s', this.messageId)
        } catch (error) {
            getLogger().error('Error in processUserPrompt: %O', error)
            this.messenger.sendErrorMessage('Failed to process your request. Please try again.', tabId)
            this.messenger.sendChatInputEnabled(tabId, true)
        } finally {
            this.isStreaming = false
            this.abortController = undefined
        }
    }

    /**
     * Stream the response from the API
     * @param input The request input
     * @param tabId The tab ID to send responses to
     */
    private async streamResponse(input: GenerateAssistantResponseCommandInput, tabId: string): Promise<void> {
        if (!this.streamingClient) {
            throw new Error('Streaming client not initialized')
        }

        let fullResponse = ''

        return new Promise<void>((resolve, reject) => {
            const callback = (err: any, data?: GenerateAssistantResponseCommandOutput) => {
                if (err) {
                    getLogger().error('Error in generateAssistantResponse callback: %O', err)
                    reject(err)
                    return
                }

                // We can log metadata if needed
                if (data?.$metadata) {
                    getLogger().debug('Response metadata received')
                }
            }

            // Set up streaming handlers
            const handleChunk = (chunk: any) => {
                try {
                    if (chunk.assistantResponseEvent?.content) {
                        const content = chunk.assistantResponseEvent.content
                        fullResponse += content

                        // Update the UI with the new content
                        this.messenger.sendShortSummary({
                            message: fullResponse,
                            type: 'answer-stream',
                            tabID: tabId,
                            messageID: this.messageId,
                        })
                    }
                } catch (error) {
                    getLogger().error('Error processing chunk: %O', error)
                }
            }

            const handleComplete = () => {
                // Send the final message
                this.messenger.sendShortSummary({
                    message: fullResponse,
                    type: 'answer',
                    tabID: tabId,
                    messageID: this.messageId,
                    canBeVoted: true,
                })

                // Re-enable chat input
                this.messenger.sendChatInputEnabled(tabId, true)

                getLogger().debug('Streaming completed for messageId: %s', this.messageId)
                resolve()
            }

            // Call the API with streaming handlers
            try {
                this.streamingClient!.generateAssistantResponse(
                    input,
                    {
                        abortSignal: this.abortController?.signal,
                    },
                    callback
                )

                // Add event listeners for streaming
                // Note: This is a simplified approach - you may need to adjust based on
                // how the actual streaming implementation works in your SDK
                const stream = this.streamingClient as any
                if (stream.on) {
                    stream.on('data', handleChunk)
                    stream.on('end', handleComplete)
                    stream.on('error', reject)
                }
            } catch (error) {
                getLogger().error('Error in streamResponse: %O', error)
                reject(error)
            }
        })
    }

    /**
     * Cancel the current streaming response
     */
    public cancelStreaming(): void {
        if (this.isStreaming && this.abortController) {
            this.abortController.abort()
            getLogger().debug('Streaming cancelled for messageId: %s', this.messageId)
        }
    }
}
