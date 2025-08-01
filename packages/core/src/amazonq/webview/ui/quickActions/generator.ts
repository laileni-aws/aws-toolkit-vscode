/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { QuickActionCommand, QuickActionCommandGroup } from '@aws/mynah-ui/dist/static'
import { TabType } from '../storages/tabsStorage'
import { MynahIcons } from '@aws/mynah-ui'

export interface QuickActionGeneratorProps {
    isGumbyEnabled: boolean
    isScanEnabled: boolean
    disableCommands?: string[]
}

export class QuickActionGenerator {
    private isGumbyEnabled: boolean
    private isScanEnabled: boolean
    private disabledCommands: string[]

    constructor(props: QuickActionGeneratorProps) {
        this.isGumbyEnabled = props.isGumbyEnabled
        this.isScanEnabled = props.isScanEnabled
        this.disabledCommands = props.disableCommands ?? []
    }

    public generateForTab(tabType: TabType): QuickActionCommandGroup[] {
        // TODO: Update acc to UX
        const quickActionCommands = [
            {
                commands: [
                    ...(!this.disabledCommands.includes('/dev')
                        ? [
                              {
                                  command: '/dev',
                                  icon: MynahIcons.CODE_BLOCK,
                                  placeholder: 'Describe your task or issue in as much detail as possible',
                                  description: 'Generate code to make a change in your project',
                              },
                          ]
                        : []),
                    ...(!this.disabledCommands.includes('/test')
                        ? [
                              {
                                  command: '/test',
                                  icon: MynahIcons.CHECK_LIST,
                                  placeholder: 'Specify a function(s) in the current file (optional)',
                                  description: 'Generate unit tests for selected code',
                              },
                          ]
                        : []),
                    ...(this.isScanEnabled && !this.disabledCommands.includes('/review')
                        ? [
                              {
                                  command: '/review',
                                  icon: MynahIcons.BUG,
                                  description: 'Identify and fix code issues before committing',
                              },
                          ]
                        : []),
                    ...(!this.disabledCommands.includes('/doc')
                        ? [
                              {
                                  command: '/doc',
                                  icon: MynahIcons.FILE,
                                  description: 'Generate documentation',
                              },
                          ]
                        : []),
                    ...(this.isGumbyEnabled && !this.disabledCommands.includes('/transform')
                        ? [
                              {
                                  command: '/transform',
                                  description: 'Transform your Java project',
                                  icon: MynahIcons.TRANSFORM,
                              },
                          ]
                        : []),
                ],
            },
            {
                groupName: 'Quick Actions',
                commands: [
                    {
                        command: '/help',
                        icon: MynahIcons.HELP,
                        description: 'Learn more about Amazon Q',
                    },
                    {
                        command: '/clear',
                        icon: MynahIcons.TRASH,
                        description: 'Clear this session',
                    },
                ],
            },
        ].filter((section) => section.commands.length > 0)

        const commandUnavailability: Record<
            Exclude<TabType, []>,
            {
                description: string
                unavailableItems: string[]
            }
        > = {
            cwc: {
                description: '',
                unavailableItems: [],
            },
            review: {
                description: "This command isn't available in /review",
                unavailableItems: ['/help', '/clear'],
            },
            gumby: {
                description: "This command isn't available in /transform",
                unavailableItems: ['/dev', '/test', '/doc', '/review', '/help', '/clear'],
            },
            welcome: {
                description: '',
                unavailableItems: ['/clear'],
            },
            unknown: {
                description: '',
                unavailableItems: [],
            },
        }

        return quickActionCommands.map((commandGroup) => {
            return {
                groupName: commandGroup.groupName,
                commands: commandGroup.commands.map((commandItem: QuickActionCommand) => {
                    const commandNotAvailable = commandUnavailability[tabType].unavailableItems.includes(
                        commandItem.command
                    )
                    return {
                        ...commandItem,
                        disabled: commandNotAvailable,
                        description: commandNotAvailable
                            ? commandUnavailability[tabType].description
                            : commandItem.description,
                    }
                }) as QuickActionCommand[],
            }
        }) as QuickActionCommandGroup[]
    }
}
