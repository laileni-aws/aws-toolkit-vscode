/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as sinon from 'sinon'
import assert from 'assert'
import { afterEach, beforeEach, describe, it } from 'mocha'
import {
    startTestGenerationProcess,
    shouldContinueRunning,
    runBuildCommand,
    cancelBuild,
} from '../../../codewhisperer/commands/startTestGeneration'
import * as testGenHandler from '../../../codewhisperer/service/testGenHandler'
import { ChatSessionManager } from '../../../amazonqTest/chat/storages/chatSession'
import { testGenState } from '../../../codewhisperer/models/model'
import { ZipUtil } from '../../../codewhisperer/util/zipUtil'
import { BuildStatus } from '../../../amazonqTest/chat/session/session'
import { TestGenerationJobStatus } from '../../../codewhisperer/models/constants'
import { ChildProcess } from '../../../shared/utilities/processUtils'
import { EventEmitter } from 'events'
import { fs } from '../../../shared/fs/fs'

describe('startTestGeneration', () => {
    let sandbox: sinon.SinonSandbox
    let mockChatSession: any
    let mockZipUtil: sinon.SinonStubbedInstance<ZipUtil>
    let mockChatControllers: any

    beforeEach(() => {
        sandbox = sinon.createSandbox()

        // Mock ChatSessionManager
        mockChatSession = {
            tabID: 'test-tab-id',
            projectRootPath: '/test/project',
            sourceFilePath: 'src/main.js',
            listOfTestGenerationJobId: new Set<string>(),
            shortAnswer: undefined,
            testGenerationJob: undefined,
            artifactsUploadDuration: 0,
            numberOfTestsGenerated: 0,
        }
        sandbox.stub(ChatSessionManager.Instance, 'getSession').returns(mockChatSession)

        // Mock ZipUtil
        mockZipUtil = sandbox.createStubInstance(ZipUtil)
        mockZipUtil.getProjectPath.returns('/test/project')
        mockZipUtil.generateZipTestGen.resolves({
            zipFilePath: '/tmp/test.zip',
            zipFileSizeInBytes: 1000,
            buildPayloadSizeInBytes: 800,
            rootDir: '/test/project',
            scannedFiles: new Set<string>(),
            srcPayloadSizeInBytes: 800,
            lines: 100,
            language: 'javascript',
        })
        sandbox.stub(ZipUtil.prototype, 'getProjectPath').returns('/test/project')
        sandbox.stub(ZipUtil.prototype, 'generateZipTestGen').resolves({
            zipFilePath: '/tmp/test.zip',
            zipFileSizeInBytes: 1000,
            buildPayloadSizeInBytes: 800,
            rootDir: '/test/project',
            scannedFiles: new Set<string>(),
            srcPayloadSizeInBytes: 800,
            lines: 100,
            language: 'javascript',
        })
        sandbox.stub(ZipUtil.prototype, 'removeTmpFiles').resolves()

        // Mock testGenHandler functions
        sandbox.stub(testGenHandler, 'getPresignedUrlAndUploadTestGen').resolves({ SourceCode: 'test-upload-id' })
        sandbox.stub(testGenHandler, 'createTestJob').resolves({
            $response: {
                requestId: 'test-request-id',
                error: undefined,
                data: {},
                hasNextPage: () => false,
                // eslint-disable-next-line unicorn/no-null
                nextPage: () => null,
                redirectCount: 0,
                retryCount: 0,
                httpResponse: { statusCode: 200 } as any,
            },
            testGenerationJob: {
                testGenerationJobId: 'test-job-id',
                testGenerationJobGroupName: 'test-group-name',
                status: TestGenerationJobStatus.COMPLETED,
                creationTime: new Date(),
            },
        })
        sandbox.stub(testGenHandler, 'pollTestJobStatus').resolves(TestGenerationJobStatus.COMPLETED)
        sandbox.stub(testGenHandler, 'exportResultsArchive').resolves()
        sandbox.stub(testGenHandler, 'throwIfCancelled').returns()

        // Mock testGenState
        mockChatControllers = {
            errorThrown: { fire: sandbox.stub() },
            sendUpdatePromptProgress: { fire: sandbox.stub() },
            showCodeGenerationResults: { fire: sandbox.stub() },
        }
        sandbox.stub(testGenState, 'getChatControllers').returns(mockChatControllers)
        sandbox.stub(testGenState, 'setToNotStarted').returns()
        sandbox.stub(testGenState, 'isCancelling').returns(false)

        // Mock fs
        sandbox.stub(fs, 'existsFile').resolves(false)
        sandbox.stub(fs, 'delete').resolves()
        sandbox.stub(fs, 'mkdir').resolves()
        sandbox.stub(fs, 'writeFile').resolves()
    })

    afterEach(() => {
        sandbox.restore()
    })

    describe('startTestGenerationProcess', () => {
        it('should successfully complete the test generation process', async () => {
            await startTestGenerationProcess('src/main.js', 'Generate unit tests', 'test-tab-id', true)

            assert.strictEqual(mockChatSession.srcZipFileSize, 1000)
            assert.strictEqual(mockChatSession.srcPayloadSize, 800)
            assert.ok((testGenHandler.getPresignedUrlAndUploadTestGen as sinon.SinonStub).calledOnce)
            assert.ok((testGenHandler.createTestJob as sinon.SinonStub).calledOnce)
            assert.ok((testGenHandler.pollTestJobStatus as sinon.SinonStub).calledOnce)
            assert.ok((testGenHandler.exportResultsArchive as sinon.SinonStub).calledOnce)
            assert.ok((testGenState.setToNotStarted as sinon.SinonStub).calledOnce)
        })

        it('should handle tab ID mismatch', async () => {
            await startTestGenerationProcess('src/main.js', 'Generate unit tests', 'wrong-tab-id', true)

            assert.ok((testGenHandler.getPresignedUrlAndUploadTestGen as sinon.SinonStub).notCalled)
            assert.ok((testGenHandler.createTestJob as sinon.SinonStub).notCalled)
            assert.ok((testGenHandler.pollTestJobStatus as sinon.SinonStub).notCalled)
            assert.ok((testGenHandler.exportResultsArchive as sinon.SinonStub).notCalled)
            assert.ok((testGenState.setToNotStarted as sinon.SinonStub).calledOnce)
        })

        it('should handle test generation failure', async () => {
            ;(testGenHandler.pollTestJobStatus as sinon.SinonStub).resolves(TestGenerationJobStatus.FAILED)

            await startTestGenerationProcess('src/main.js', 'Generate unit tests', 'test-tab-id', true)

            assert.strictEqual(mockChatSession.numberOfTestsGenerated, 0)
            assert.ok(mockChatControllers.errorThrown.fire.calledOnce)
            assert.ok((testGenState.setToNotStarted as sinon.SinonStub).calledOnce)
        })

        it('should handle errors during the process', async () => {
            const error = new Error('Test error')
            ;(testGenHandler.getPresignedUrlAndUploadTestGen as sinon.SinonStub).rejects(error)

            await startTestGenerationProcess('src/main.js', 'Generate unit tests', 'test-tab-id', true)

            assert.ok(mockChatControllers.errorThrown.fire.calledOnce)
            assert.ok((testGenState.setToNotStarted as sinon.SinonStub).calledOnce)
        })

        it('should handle selection range when provided', async () => {
            const selectionRange = {
                start: { line: 10, character: 0 },
                end: { line: 20, character: 10 },
            }

            await startTestGenerationProcess('src/main.js', 'Generate unit tests', 'test-tab-id', true, selectionRange)

            assert.ok((testGenHandler.createTestJob as sinon.SinonStub).calledOnce)
            const createTestJobArgs = (testGenHandler.createTestJob as sinon.SinonStub).getCall(0).args
            assert.deepStrictEqual(createTestJobArgs[1][0].targetLineRangeList, [selectionRange])
        })
    })

    describe('shouldContinueRunning', () => {
        it('should return true when tab ID matches', () => {
            const result = shouldContinueRunning('test-tab-id')
            assert.strictEqual(result, true)
        })

        it('should return false when tab ID does not match', () => {
            const result = shouldContinueRunning('wrong-tab-id')
            assert.strictEqual(result, false)
        })
    })

    describe('runBuildCommand', () => {
        let mockChildProcess: any

        beforeEach(() => {
            mockChildProcess = new EventEmitter()
            mockChildProcess.stdout = new EventEmitter()
            mockChildProcess.stderr = new EventEmitter()
            mockChildProcess.kill = sandbox.stub()

            sandbox.stub(ChildProcess, 'run').returns(mockChildProcess as any)
        })

        it('should return SUCCESS when build commands succeed', async () => {
            const buildPromise = runBuildCommand(['npm test'])

            // Simulate successful build
            setTimeout(() => {
                mockChildProcess.emit('close', 0)
            }, 10)

            const result = await buildPromise
            assert.strictEqual(result, BuildStatus.SUCCESS)
        })

        it('should return FAILURE when build command fails', async () => {
            const buildPromise = runBuildCommand(['npm test'])

            // Simulate failed build
            setTimeout(() => {
                mockChildProcess.emit('close', 1)
            }, 10)

            const result = await buildPromise
            assert.strictEqual(result, BuildStatus.FAILURE)
        })

        it('should handle multiple build commands', async () => {
            const buildPromise = runBuildCommand(['npm install', 'npm test'])

            // Simulate successful builds
            setTimeout(() => {
                mockChildProcess.emit('close', 0)
                // Simulate second command execution
                setTimeout(() => {
                    mockChildProcess.emit('close', 0)
                }, 10)
            }, 10)

            const result = await buildPromise
            assert.strictEqual(result, BuildStatus.SUCCESS)
            assert.strictEqual((ChildProcess.run as sinon.SinonStub).callCount, 2)
        })

        it('should stop execution when a build command fails', async () => {
            const buildPromise = runBuildCommand(['npm install', 'npm test'])

            // Simulate failed first build
            setTimeout(() => {
                mockChildProcess.emit('close', 1)
            }, 10)

            const result = await buildPromise
            assert.strictEqual(result, BuildStatus.FAILURE)
            assert.strictEqual((ChildProcess.run as sinon.SinonStub).callCount, 1)
        })
    })

    describe('cancelBuild', () => {
        let mockChildProcess: any

        beforeEach(async () => {
            mockChildProcess = {
                kill: sandbox.stub(),
            }
            sandbox.stub(ChildProcess, 'run').returns(mockChildProcess as any)

            // Run a build to set the spawnResult
            await runBuildCommand(['npm test'])
        })

        it('should kill the process when a build is running', () => {
            cancelBuild()
            assert.ok(mockChildProcess.kill.calledOnce)
        })
    })
})
