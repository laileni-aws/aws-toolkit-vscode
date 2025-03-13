/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// private async handleUpdatePromptProgress(data: any) {
//     this.messenger.sendUpdatePromptProgress(data.tabID, data.status === 'cancel' ? cancellingProgressField : null)
// }

// /**
//  * Process a user message using Q CLI streaming functionality
//  */
// private async processQCliStreamingMessage(data: { prompt: string; tabID: string }): Promise<void> {
//     const session = this.sessionStorage.getSession()
//     const logger = getLogger()

//     try {
//         logger.debug('Processing Q CLI streaming message: %s', data.prompt)

//         // Check authentication
//         const authState = await AuthUtil.instance.getChatAuthState()
//         if (authState.amazonQ !== 'connected') {
//             void this.messenger.sendAuthNeededExceptionMessage(authState, data.tabID)
//             session.isAuthenticating = true
//             return
//         }

//         // Process the user prompt through the streaming service
//         await QCliStreamingService.getInstance().processUserPrompt(data.prompt, data.tabID, session)
//     } catch (error) {
//         logger.error('Error processing Q CLI streaming message: %O', error)
//         this.messenger.sendErrorMessage('Failed to process your request. Please try again.', data.tabID)
//     }
// }
/* [object Object]*/
