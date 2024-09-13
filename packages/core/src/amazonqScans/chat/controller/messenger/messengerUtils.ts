/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 */

// These enums map to string IDs
export enum ButtonActions {
    RUN_PROJECT_SCAN = 'runProjectScan',
    RUN_FILE_SCAN = 'runFileScan',
}

export enum ScanCommands {
    CLEAR_CHAT = 'aws.awsq.clearchat',
    START_SCAN_FLOW = 'aws.awsq.scan',
}

export default class MessengerUtils {
    static stringToEnumValue = <T extends { [key: string]: string }, K extends keyof T & string>(
        enumObject: T,
        value: `${T[K]}`
    ): T[K] => {
        if (Object.values(enumObject).includes(value)) {
            return value as unknown as T[K]
        } else {
            throw new Error('Value provided was not found in Enum')
        }
    }
}
