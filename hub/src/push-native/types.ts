import type { NativePushPlatform } from './platforms'

export type NativePushTarget = { deviceId: string; platform: NativePushPlatform }

/** Provider-independent notification data shared by Android transports. */
export type NativePushData = {
    type: string
    sessionId: string
    sessionName: string
    url: string
    requestId?: string
    title: string
    body: string
    contractVersion: string
    severity?: 'info' | 'success' | 'warning' | 'error'
    notifySummary?: string
}

export type NativePushPayload = {
    title: string
    body: string
    tag?: string
    data: NativePushData
}

export type NativePushResult = {
    sent: number
    failed: number
    invalidTokens: string[]
}

export interface NativePushSender {
    sendToNamespace(namespace: string, payload: NativePushPayload, target?: NativePushTarget): Promise<NativePushResult>
}
