/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageListener } from '../../../../amazonq/messages/messageListener'
import { ExtensionMessage } from '../../../../amazonq/webview/ui/commands'
import { ScanChatControllerEventEmitters } from '../../controller/controller'

type UIMessage = ExtensionMessage & {
    tabID?: string
}

export interface UIMessageListenerProps {
    readonly chatControllerEventEmitters: ScanChatControllerEventEmitters
    readonly webViewMessageListener: MessageListener<any>
}

export class UIMessageListener {
    private scanControllerEventsEmitters: ScanChatControllerEventEmitters | undefined
    private webViewMessageListener: MessageListener<any>

    constructor(props: UIMessageListenerProps) {
        this.scanControllerEventsEmitters = props.chatControllerEventEmitters
        this.webViewMessageListener = props.webViewMessageListener

        // Now we are listening to events that get sent from amazonq/webview/actions/actionListener (e.g. the tab)
        this.webViewMessageListener.onMessage((msg) => {
            this.handleMessage(msg)
        })
    }

    private handleMessage(msg: ExtensionMessage) {
        switch (msg.command) {
            case 'scan':
                this.scan(msg)
                break
            case 'new-tab-was-created':
                this.tabOpened(msg)
                break
            case 'tab-was-removed':
                this.tabClosed(msg)
                break
            case 'auth-follow-up-was-clicked':
                this.authClicked(msg)
                break
            case 'form-action-click':
                this.formActionClicked(msg)
                break
            case 'chat-prompt':
                this.processChatPrompt(msg)
                break
            case 'response-body-link-click':
                this.linkClicked(msg)
                break
        }
    }

    private processChatPrompt(msg: UIMessage) {
        this.scanControllerEventsEmitters?.processHumanChatMessage.fire({
            message: msg.chatMessage,
            tabID: msg.tabID,
        })
    }

    private scan(msg: UIMessage) {
        this.scanControllerEventsEmitters?.runScan.fire({
            tabID: msg.tabID,
        })
    }

    private tabOpened(msg: UIMessage) {
        this.scanControllerEventsEmitters?.tabOpened.fire({
            tabID: msg.tabID,
        })
    }

    private tabClosed(msg: UIMessage) {
        this.scanControllerEventsEmitters?.tabClosed.fire({
            tabID: msg.tabID,
        })
    }

    private authClicked(msg: UIMessage) {
        this.scanControllerEventsEmitters?.authClicked.fire({
            tabID: msg.tabID,
            authType: msg.authType,
        })
    }

    private formActionClicked(msg: UIMessage) {
        this.scanControllerEventsEmitters?.formActionClicked.fire({
            ...msg,
        })
    }

    private linkClicked(msg: UIMessage) {
        this.scanControllerEventsEmitters?.linkClicked.fire({
            ...msg,
        })
    }
}
