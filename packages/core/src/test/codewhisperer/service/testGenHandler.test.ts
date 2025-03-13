/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as sinon from 'sinon'
import assert from 'assert'
import { afterEach, beforeEach, describe, it } from 'mocha'
import {
    getPresignedUrlAndUploadTestGen,
    createTestJob,
    pollTestJobStatus,
    exportResultsArchive,
    throwIfCancelled,
    downloadResultArchive,
} from '../../../codewhisperer/service/testGenHandler'
import * as codewhispererClient from '../../../codewhisperer/client/codewhisperer'
import { testGenState } from '../../../codewhisperer/models/model'
import { ChatSessionManager } from '../../../amazonqTest/chat/storages/chatSession'
import { TestGenerationJobStatus } from '../../../codewhisperer/models/constants'
import {
    CreateTestJobError,
    CreateUploadUrlError,
    ExportResultsArchiveError,
    InvalidSourceZipError,
    TestGenStoppedError,
} from '../../../amazonqTest/error'
import * as securityScanHandler from '../../../codewhisperer/service/securityScanHandler'
import { fs } from '../../../shared/fs/fs'
import AdmZip from 'adm-zip'
import path from 'path'
import * as timeoutUtils from '../../../shared/utilities/timeoutUtils'
import * as downloadUtils from '../../../shared/utilities/download'
import * as cwChatClient from '../../../shared/clients/codewhispererChatClient'
import { ExportIntent } from '@amzn/codewhisperer-streaming'

describe('testGenHandler', () => {
    let sandbox: sinon.SinonSandbox
    let mockChatSession: any
    let mockCodeWhispererClient: any
    let mockChatControllers: any

    beforeEach(() => {
        sandbox = sinon.createSandbox()

        // Mock ChatSessionManager
        mockChatSession = {
            tabID: 'test-tab-id',
            projectRootPath: '/test/project',
            sourceFilePath: 'src/main.js',
            listOfTestGenerationJobId: new Set<string>(),
            testGenerationJobGroupName: 'test-group-name',
            testGenerationJob: {
                testGenerationJobId: 'test-job-id',
                testGenerationJobGroupName: 'test-group-name',
                status: TestGenerationJobStatus.IN_PROGRESS,
            },
            numberOfTestsGenerated: 0,
            references: [],
            targetFileInfo: undefined,
        }
        sandbox.stub(ChatSessionManager.Instance, 'getSession').returns(mockChatSession)

        // Mock CodeWhispererClient
        mockCodeWhispererClient = {
            createUploadUrl: sandbox.stub(),
            startTestGeneration: sandbox.stub(),
            getTestGeneration: sandbox.stub(),
        }
        sandbox.stub(codewhispererClient, 'codeWhispererClient').value(mockCodeWhispererClient)

        // Mock testGenState
        mockChatControllers = {
            errorThrown: { fire: sandbox.stub() },
            sendUpdatePromptProgress: { fire: sandbox.stub() },
            showCodeGenerationResults: { fire: sandbox.stub() },
            updateTargetFileInfo: { fire: sandbox.stub() },
        }
        sandbox.stub(testGenState, 'getChatControllers').returns(mockChatControllers)
        sandbox.stub(testGenState, 'isCancelling').returns(false)

        // Mock other dependencies
        sandbox.stub(securityScanHandler, 'getMd5').returns('test-md5')
        sandbox.stub(securityScanHandler, 'uploadArtifactToS3').resolves()

        // Properly stub fs methods to use Sinon's spy/stub functionality
        sandbox.stub(fs, 'existsDir').resolves(false)
        sandbox.stub(fs, 'delete').resolves()
        sandbox.stub(fs, 'mkdir').resolves()

        sandbox.stub(timeoutUtils, 'sleep').resolves()
        sandbox.stub(downloadUtils, 'downloadExportResultArchive').resolves()

        // Mock AdmZip
        sandbox.stub(AdmZip.prototype, 'extractAllTo').returns()

        // Mock createCodeWhispererChatStreamingClient
        const mockStreamingClient = { destroy: sandbox.stub() }
        sandbox.stub(cwChatClient, 'createCodeWhispererChatStreamingClient').resolves(mockStreamingClient as any)
    })

    afterEach(() => {
        sandbox.restore()
    })

    describe('throwIfCancelled', () => {
        it('should throw TestGenStoppedError when test gen is cancelling', () => {
            ;(testGenState.isCancelling as sinon.SinonStub).returns(true)

            assert.throws(() => {
                throwIfCancelled()
            }, TestGenStoppedError)
        })

        it('should not throw when test gen is not cancelling', () => {
            ;(testGenState.isCancelling as sinon.SinonStub).returns(false)

            assert.doesNotThrow(() => {
                throwIfCancelled()
            })
        })
    })

    describe('getPresignedUrlAndUploadTestGen', () => {
        beforeEach(() => {
            mockCodeWhispererClient.createUploadUrl.resolves({
                $response: {
                    requestId: 'test-request-id',
                    error: undefined,
                },
                uploadId: 'test-upload-id',
                uploadUrl: 'https://test-url.com',
            })
        })

        it('should successfully get presigned URL and upload test gen', async () => {
            const zipMetadata = {
                zipFilePath: '/tmp/test.zip',
                zipFileSizeInBytes: 1000,
                buildPayloadSizeInBytes: 800,
            }

            const result = await getPresignedUrlAndUploadTestGen(zipMetadata as any)

            assert.deepStrictEqual(result, { SourceCode: 'test-upload-id' })
            assert.ok(mockCodeWhispererClient.createUploadUrl.calledOnce)
            assert.ok(securityScanHandler.uploadArtifactToS3)
        })

        it('should throw InvalidSourceZipError when zip file path is empty', async () => {
            const zipMetadata = {
                zipFilePath: '',
                zipFileSizeInBytes: 0,
                buildPayloadSizeInBytes: 0,
            }

            await assert.rejects(
                async () => await getPresignedUrlAndUploadTestGen(zipMetadata as any),
                InvalidSourceZipError
            )
        })

        it('should throw CreateUploadUrlError when createUploadUrl fails', async () => {
            mockCodeWhispererClient.createUploadUrl.rejects(new Error('API error'))

            const zipMetadata = {
                zipFilePath: '/tmp/test.zip',
                zipFileSizeInBytes: 1000,
                buildPayloadSizeInBytes: 800,
            }

            await assert.rejects(
                async () => await getPresignedUrlAndUploadTestGen(zipMetadata as any),
                CreateUploadUrlError
            )
        })
    })

    describe('createTestJob', () => {
        beforeEach(() => {
            mockCodeWhispererClient.startTestGeneration.resolves({
                $response: {
                    requestId: 'test-request-id',
                    error: undefined,
                    data: {},
                    hasNextPage: () => false,
                    nextPage: () => undefined,
                    redirectCount: 0,
                    retryCount: 0,
                    httpResponse: { statusCode: 200 } as any,
                },
                testGenerationJob: {
                    testGenerationJobId: 'test-job-id',
                    testGenerationJobGroupName: 'test-group-name',
                    status: TestGenerationJobStatus.IN_PROGRESS,
                    creationTime: new Date(),
                },
            })
        })

        it('should successfully create a test job', async () => {
            const artifactMap = { SourceCode: 'test-upload-id' }
            const targetCode = [
                {
                    relativeTargetPath: 'src/main.js',
                    targetLineRangeList: [],
                },
            ]
            const userInputPrompt = 'Generate unit tests'

            const result = await createTestJob(artifactMap, targetCode, userInputPrompt)

            assert.deepStrictEqual(result.testGenerationJob?.testGenerationJobId, 'test-job-id')
            assert.deepStrictEqual(result.testGenerationJob?.testGenerationJobGroupName, 'test-group-name')
            assert.ok(mockCodeWhispererClient.startTestGeneration.calledOnce)
            assert.ok(mockChatSession.listOfTestGenerationJobId.has('test-job-id'))
        })

        it('should handle target line ranges correctly', async () => {
            const artifactMap = { SourceCode: 'test-upload-id' }
            const targetCode = [
                {
                    relativeTargetPath: 'src/main.js',
                    targetLineRangeList: [
                        {
                            start: { line: 10, character: 0 },
                            end: { line: 20, character: 10 },
                        },
                    ],
                },
            ]
            const userInputPrompt = 'Generate unit tests'

            await createTestJob(artifactMap, targetCode, userInputPrompt)

            const callArgs = mockCodeWhispererClient.startTestGeneration.getCall(0).args[0]
            assert.deepStrictEqual(callArgs.targetCodeList[0].targetLineRangeList[0], {
                start: { line: 10, character: 0 },
                end: { line: 20, character: 10 },
            })
        })

        it('should throw CreateTestJobError when startTestGeneration fails', async () => {
            mockCodeWhispererClient.startTestGeneration.rejects(new Error('API error'))

            const artifactMap = { SourceCode: 'test-upload-id' }
            const targetCode = [{ relativeTargetPath: 'src/main.js', targetLineRangeList: [] }]
            const userInputPrompt = 'Generate unit tests'

            await assert.rejects(
                async () => await createTestJob(artifactMap, targetCode, userInputPrompt),
                CreateTestJobError
            )
        })
    })

    describe('pollTestJobStatus', () => {
        beforeEach(() => {
            // Setup mock responses for different polling stages
            const inProgressResponse = {
                $response: {
                    requestId: 'test-request-id',
                    error: undefined,
                },
                testGenerationJob: {
                    testGenerationJobId: 'test-job-id',
                    testGenerationJobGroupName: 'test-group-name',
                    status: TestGenerationJobStatus.IN_PROGRESS,
                    progressRate: 50,
                    jobSummary: '`Test generation in progress`',
                    packageInfoList: [
                        {
                            targetFileInfoList: [
                                {
                                    numberOfTestMethods: 5,
                                    testFilePath: 'test/main.test.js',
                                    filePlan: 'Plan to test main functions',
                                    codeReferences: [{ title: 'Reference 1', url: 'http://example.com' }],
                                },
                            ],
                        },
                    ],
                },
            }

            const completedResponse = {
                $response: {
                    requestId: 'test-request-id',
                    error: undefined,
                },
                testGenerationJob: {
                    testGenerationJobId: 'test-job-id',
                    testGenerationJobGroupName: 'test-group-name',
                    status: TestGenerationJobStatus.COMPLETED,
                    progressRate: 100,
                    jobSummary: '`Test generation completed`',
                    packageInfoList: [
                        {
                            targetFileInfoList: [
                                {
                                    numberOfTestMethods: 10,
                                    testFilePath: 'test/main.test.js',
                                    filePlan: 'Plan to test main functions',
                                    codeReferences: [{ title: 'Reference 1', url: 'http://example.com' }],
                                },
                            ],
                        },
                    ],
                },
            }

            mockCodeWhispererClient.getTestGeneration.onFirstCall().resolves(inProgressResponse)
            mockCodeWhispererClient.getTestGeneration.onSecondCall().resolves(completedResponse)
        })

        it('should poll until job is completed', async () => {
            const result = await pollTestJobStatus('test-job-id', 'test-group-name', '/test/project/src/main.js', true)

            assert.strictEqual(result, TestGenerationJobStatus.COMPLETED)
            assert.strictEqual(mockCodeWhispererClient.getTestGeneration.callCount, 2)
            assert.strictEqual(mockChatSession.numberOfTestsGenerated, 10)
            assert.ok(mockChatControllers.sendUpdatePromptProgress.fire.calledTwice)
            assert.ok(mockChatControllers.updateTargetFileInfo.fire.calledOnce)
        })

        it('should update session with job information', async () => {
            await pollTestJobStatus('test-job-id', 'test-group-name', '/test/project/src/main.js', true)

            assert.strictEqual(mockChatSession.numberOfTestsGenerated, 10)
            assert.strictEqual(mockChatSession.jobSummary, 'Test generation completed')
            assert.strictEqual(mockChatSession.generatedFilePath, 'test/main.test.js')
            assert.deepStrictEqual(mockChatSession.references, [{ title: 'Reference 1', url: 'http://example.com' }])
        })

        it('should not update target file info on non-initial execution', async () => {
            await pollTestJobStatus('test-job-id', 'test-group-name', '/test/project/src/main.js', false)

            assert.ok(mockChatControllers.updateTargetFileInfo.fire.notCalled)
        })
    })

    describe('exportResultsArchive', () => {
        beforeEach(() => {
            sandbox.stub(path, 'join').returns('/tmp/test-path')
            sandbox.stub(global, 'setTimeout').callsFake((callback: any) => {
                callback()
                return 1 as any
            })

            // Properly stub downloadResultArchive for testing
            sandbox.stub(downloadUtils, 'downloadExportResultArchive').resolves()
        })

        it('should successfully export results archive', async () => {
            sandbox.stub(AdmZip.prototype, 'extractAllTo')

            await exportResultsArchive(
                'test-upload-id',
                'test-group-name',
                'test-job-id',
                'test-project',
                '/test/project',
                true
            )

            assert.ok((fs.existsDir as sinon.SinonStub).calledOnce)
            assert.ok((fs.delete as sinon.SinonStub).calledOnce)
            assert.ok((fs.mkdir as sinon.SinonStub).calledOnce)
            assert.ok(mockChatControllers.showCodeGenerationResults.fire.calledOnce)
            assert.ok(mockChatControllers.sendUpdatePromptProgress.fire.calledOnce)
        })

        it('should not show code generation results on non-initial execution', async () => {
            await exportResultsArchive(
                'test-upload-id',
                'test-group-name',
                'test-job-id',
                'test-project',
                '/test/project',
                false
            )

            assert.ok(mockChatControllers.showCodeGenerationResults.fire.notCalled)
        })

        it('should handle errors during export', async () => {
            const error = new Error('Export error')
            ;(downloadUtils.downloadExportResultArchive as sinon.SinonStub).rejects(error)

            await assert.rejects(
                async () =>
                    await exportResultsArchive(
                        'test-upload-id',
                        'test-group-name',
                        'test-job-id',
                        'test-project',
                        '/test/project',
                        true
                    ),
                ExportResultsArchiveError
            )

            assert.strictEqual(mockChatSession.numberOfTestsGenerated, 0)
        })
    })

    describe('downloadResultArchive', () => {
        it('should successfully download result archive', async () => {
            await downloadResultArchive('test-upload-id', 'test-group-name', 'test-job-id', '/tmp/archive.zip')

            assert.ok((downloadUtils.downloadExportResultArchive as sinon.SinonStub).calledOnce)
            const callArgs = (downloadUtils.downloadExportResultArchive as sinon.SinonStub).getCall(0).args[1]
            assert.strictEqual(callArgs.exportId, 'test-upload-id')
            assert.strictEqual(callArgs.exportIntent, ExportIntent.UNIT_TESTS)
            assert.strictEqual(
                callArgs.exportContext.unitTestGenerationExportContext.testGenerationJobGroupName,
                'test-group-name'
            )
            assert.strictEqual(
                callArgs.exportContext.unitTestGenerationExportContext.testGenerationJobId,
                'test-job-id'
            )
        })

        it('should handle download errors', async () => {
            const error = new Error('Download error')
            ;(downloadUtils.downloadExportResultArchive as sinon.SinonStub).rejects(error)

            await assert.rejects(
                async () =>
                    await downloadResultArchive('test-upload-id', 'test-group-name', 'test-job-id', '/tmp/archive.zip'),
                ExportResultsArchiveError
            )
        })
    })
})
