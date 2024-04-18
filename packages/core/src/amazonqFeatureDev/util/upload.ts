/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import request, { RequestError } from '../../common/request'
import { getLogger } from '../../shared/logger/logger'

import { UploadCodeError } from '../errors'

/**
 * uploadCode
 *
 * uses a presigned url and files checksum to transfer data to s3 through http.
 */
export async function uploadCode(url: string, buffer: Buffer, requestHeaders: any, featureName: string) {
    try {
        await request.fetch('PUT', url, {
            body: buffer,
            headers: requestHeaders,
        }).response
    } catch (e: any) {
        getLogger().error(`${featureName}: failed to upload code to s3: ${(e as Error).message}`)
        throw new UploadCodeError(
            e instanceof RequestError ? `${e.response.status}: ${e.response.statusText}` : 'Unknown'
        )
    }
}
