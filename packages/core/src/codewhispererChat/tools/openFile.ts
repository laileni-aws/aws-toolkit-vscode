/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { fileExists } from '../../shared/filesystemUtilities'
import { getLogger } from '../../shared/logger/logger'

const logger = getLogger()

/**
 * Interface for the parameters required by the open_file tool
 */
export interface OpenFileParams {
    /**
     * Path to the file to open
     */
    path: string
}
enum OutputKind {
    Text = 'text',
    Json = 'json',
}
export interface InvokeOutput {
    output: {
        kind: OutputKind
        content: string
    }
}

/**
 * Opens a file in a new VSCode editor tab
 *
 * @param params Parameters for opening the file
 * @returns A result object indicating success or failure
 */
export async function openFile(params: OpenFileParams): Promise<InvokeOutput> {
    try {
        const { path } = params

        // Check if file exists
        if (!(await fileExists(path))) {
            throw Error('file does not exist')
        }

        // Create a URI from the file path
        const uri = vscode.Uri.file(path)

        // Open the document
        const document = await vscode.workspace.openTextDocument(uri)

        // Show the document in the editor
        await vscode.window.showTextDocument(document, {
            preview: false,
            preserveFocus: false,
        })

        return {
            output: {
                kind: OutputKind.Text,
                content: `Successfully opened file: ${path}`,
            },
        }
    } catch (error) {
        logger.error(`Failed to open file: ${error}`)

        throw error
    }
}
