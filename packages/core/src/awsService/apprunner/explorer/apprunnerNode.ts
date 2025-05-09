/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { compareTreeItems, makeChildrenNodes } from '../../../shared/treeview/utils'
import * as vscode from 'vscode'
import { AWSTreeNodeBase } from '../../../shared/treeview/nodes/awsTreeNodeBase'
import { AppRunnerServiceNode } from './apprunnerServiceNode'
import { PlaceholderNode } from '../../../shared/treeview/nodes/placeholderNode'
import * as nls from 'vscode-nls'
import { AppRunnerClient, CreateServiceRequest, ServiceSummary } from '../../../shared/clients/apprunner'
import { PollingSet } from '../../../shared/utilities/pollingSet'

const localize = nls.loadMessageBundle()

export class AppRunnerNode extends AWSTreeNodeBase {
    private readonly serviceNodes: Map<string, AppRunnerServiceNode> = new Map()
    private readonly pollingSet: PollingSet<string> = new PollingSet(20000, this.refresh.bind(this))

    public constructor(
        public override readonly regionCode: string,
        public readonly client: AppRunnerClient
    ) {
        super('App Runner', vscode.TreeItemCollapsibleState.Collapsed)
        this.contextValue = 'awsAppRunnerNode'
    }

    public override async getChildren(): Promise<AWSTreeNodeBase[]> {
        return await makeChildrenNodes({
            getChildNodes: async () => {
                await this.updateChildren()

                return [...this.serviceNodes.values()]
            },
            getNoChildrenPlaceholderNode: async () =>
                new PlaceholderNode(
                    this,
                    localize('AWS.explorerNode.apprunner.noServices', '[No App Runner services found]')
                ),
            sort: (nodeA, nodeB) => compareTreeItems(nodeA, nodeB),
        })
    }

    private async getServiceSummaries(): Promise<ServiceSummary[]> {
        // TODO: avoid resolving all services at once.
        const serviceCollection = this.client.paginateServices({})
        return await serviceCollection.flatten().promise()
    }

    public async updateChildren(): Promise<void> {
        const serviceSummaries = await this.getServiceSummaries()
        const deletedNodeArns = new Set(this.serviceNodes.keys())

        await Promise.all(
            serviceSummaries.map(async (summary) => {
                if (this.serviceNodes.has(summary.ServiceArn)) {
                    this.serviceNodes.get(summary.ServiceArn)!.update(summary)
                    if (summary.Status !== 'OPERATION_IN_PROGRESS') {
                        this.pollingSet.delete(summary.ServiceArn)
                        this.pollingSet.clearTimer()
                    }
                } else {
                    this.serviceNodes.set(summary.ServiceArn, new AppRunnerServiceNode(this, this.client, summary))
                }
                deletedNodeArns.delete(summary.ServiceArn)
            })
        )

        // eslint-disable-next-line unicorn/no-array-for-each
        deletedNodeArns.forEach(this.deleteNode.bind(this))
    }

    public startPollingNode(id: string): void {
        this.pollingSet.add(id)
    }

    public stopPollingNode(id: string): void {
        this.pollingSet.delete(id)
        this.serviceNodes.get(id)?.refresh()
        this.pollingSet.clearTimer()
    }

    public deleteNode(id: string): void {
        this.serviceNodes.delete(id)
        this.pollingSet.delete(id)
    }

    public async createService(request: CreateServiceRequest): Promise<void> {
        await this.client.createService(request)
        this.refresh()
    }
}
