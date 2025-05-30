/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import * as sinon from 'sinon'
import { Ec2Instance } from '../../../shared/clients/ec2'
import { getIconCode } from '../../../awsService/ec2/utils'
import { DefaultAwsContext } from '../../../shared'

describe('utils', async function () {
    before(function () {
        sinon.stub(DefaultAwsContext.prototype, 'getCredentialAccountId')
    })

    after(function () {
        sinon.restore()
    })

    describe('getIconCode', function () {
        it('gives code based on status', function () {
            const runningInstance: Ec2Instance = {
                InstanceId: 'X',
                LastSeenStatus: 'running',
            }
            const stoppedInstance: Ec2Instance = {
                InstanceId: 'XX',
                LastSeenStatus: 'stopped',
            }
            const terminatedInstance: Ec2Instance = {
                InstanceId: 'XXX',
                LastSeenStatus: 'terminated',
            }

            assert.strictEqual(getIconCode(runningInstance), 'pass')
            assert.strictEqual(getIconCode(stoppedInstance), 'circle-slash')
            assert.strictEqual(getIconCode(terminatedInstance), 'stop')
        })

        it('defaults to loading~spin', function () {
            const pendingInstance: Ec2Instance = {
                InstanceId: 'X',
                LastSeenStatus: 'pending',
            }
            const stoppingInstance: Ec2Instance = {
                InstanceId: 'XX',
                LastSeenStatus: 'shutting-down',
            }

            assert.strictEqual(getIconCode(pendingInstance), 'loading~spin')
            assert.strictEqual(getIconCode(stoppingInstance), 'loading~spin')
        })
    })
})
