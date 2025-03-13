/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { QCliStreamingHandler } from './qCliStreamingHandler'
import { Messenger } from '../controller/messenger/messenger'
import { Session } from '../session/session'
import { getLogger } from '../../../shared/logger/logger'

/**
 * Service class to manage Q CLI-like streaming functionality
 */
export class QCliStreamingService {
    private static instance: QCliStreamingService
    private streamingHandler: QCliStreamingHandler | undefined

    private constructor() {}

    /**
     * Get the singleton instance
     */
    public static getInstance(): QCliStreamingService {
        if (!QCliStreamingService.instance) {
            QCliStreamingService.instance = new QCliStreamingService()
        }
        return QCliStreamingService.instance
    }

    /**
     * Initialize the streaming service with a messenger
     * @param messenger The messenger to use for UI communication
     */
    public initialize(messenger: Messenger): void {
        this.streamingHandler = new QCliStreamingHandler(messenger)
        getLogger().debug('QCliStreamingService initialized')
    }

    /**
     * Process a user prompt and stream the response
     * @param userPrompt The user's prompt
     * @param tabId The tab ID to send responses to
     * @param session The current session
     */
    public async processUserPrompt(userPrompt: string, tabId: string, session: Session): Promise<void> {
        if (!this.streamingHandler) {
            getLogger().error('QCliStreamingService not initialized')
            throw new Error('QCliStreamingService not initialized')
        }

        try {
            await this.streamingHandler.processUserPrompt(userPrompt, tabId, session)
        } catch (error) {
            getLogger().error('Error processing user prompt: %O', error)
            throw error
        }
    }

    /**
     * Cancel the current streaming response
     */
    public cancelStreaming(): void {
        if (this.streamingHandler) {
            this.streamingHandler.cancelStreaming()
        }
    }
}
