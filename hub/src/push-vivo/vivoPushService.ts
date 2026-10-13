import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { NativePushSender, NativePushPayload, NativePushResult, NativePushTarget } from '../push-native/types'
import { canonicalJson, encryptEnvelope, PUSH_KEY_LENGTH } from '../push-native/envelope'
import type { Store } from '../store'
import type { VivoPushConfig } from './vivoPushConfig'

const VIVO_API = 'https://api-push.vivo.com.cn'
const REQUEST_TIMEOUT_MS = 10_000
const TOKEN_REFRESH_MS = 60 * 60 * 1000
const MAX_INTENT_LENGTH = 2048

const responseSchema = z.object({
    result: z.number().int(),
    authToken: z.string().min(1).optional(),
    invalidUser: z.object({
        status: z.number().int(),
        userid: z.string()
    }).optional()
})

type VivoResponse = z.infer<typeof responseSchema>
type SendOutcome = 'sent' | 'invalid' | 'failed'

/**
 * vivo's system renderer cannot decrypt notification text. Send a generic
 * preview and encrypt only the tap target; no chat text, paths, request IDs
 * or summaries leave the hub in plaintext.
 */
export function vivoNotificationIntent(pushKey: string | null, payload: NativePushPayload): string | null {
    if (!pushKey) return null
    const key = Buffer.from(pushKey, 'base64')
    if (key.length !== PUSH_KEY_LENGTH) return null
    const envelope = encryptEnvelope(key, canonicalJson({
        sessionId: payload.data.sessionId,
        type: payload.data.type,
        contractVersion: payload.data.contractVersion
    }))
    const uri = 'intent://push#Intent;scheme=hapicompanion;package=run.hapi.companion;' +
        'component=run.hapi.companion/app.hapi.companion.MainActivity;' +
        `S.hapi_v=1;S.hapi_e=${encodeURIComponent(envelope)};end`
    return uri.length <= MAX_INTENT_LENGTH ? uri : null
}

export class VivoPushService implements NativePushSender {
    private cachedToken: { value: string; expiresAt: number } | null = null
    private tokenRequest: Promise<string | null> | null = null

    constructor(
        private readonly config: Extract<VivoPushConfig, { mode: 'test' }>,
        private readonly store: Store,
        private readonly request: typeof fetch = fetch
    ) {}

    async sendToNamespace(namespace: string, payload: NativePushPayload, target?: NativePushTarget): Promise<NativePushResult> {
        const devices = this.store.fcm.getDevicesByNamespace(namespace, ['vivo'])
            .filter(device => !target || (device.deviceId === target.deviceId && device.platform === target.platform))
        const result: NativePushResult = { sent: 0, failed: 0, invalidTokens: [] }
        if (devices.length === 0) return result

        const token = await this.accessToken()
        if (!token) return { ...result, failed: devices.length }

        await Promise.all(devices.map(async device => {
            const intent = vivoNotificationIntent(device.pushKey, payload)
            const outcome = intent ? await this.send(token, device.token, intent, payload.data.type === 'test') : 'failed'
            if (outcome === 'sent') {
                result.sent += 1
            } else {
                result.failed += 1
                if (outcome === 'invalid') {
                    this.store.fcm.removeDeviceByToken(namespace, device.token)
                    result.invalidTokens.push(device.token)
                }
            }
        }))
        return result
    }

    private async accessToken(): Promise<string | null> {
        if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) return this.cachedToken.value
        // Fan-out and concurrent notifications share one provider auth request.
        if (this.tokenRequest) return this.tokenRequest
        this.tokenRequest = this.authenticate()
        try {
            return await this.tokenRequest
        } finally {
            this.tokenRequest = null
        }
    }

    private async authenticate(): Promise<string | null> {
        const timestamp = Date.now()
        const { appId, appKey, appSecret } = this.config
        const sign = createHash('md5').update(`${appId}${appKey}${timestamp}${appSecret}`).digest('hex')
        const response = await this.post('/message/auth', { appId, appKey, timestamp, sign })
        if (response?.result !== 0 || !response.authToken) return null
        this.cachedToken = { value: response.authToken, expiresAt: Date.now() + TOKEN_REFRESH_MS }
        return response.authToken
    }

    private async send(authToken: string, regId: string, skipContent: string, isTest: boolean): Promise<SendOutcome> {
        const response = await this.post('/message/send', {
            appId: this.config.appId,
            regId,
            pushMode: 1,
            // Task/approval alerts are work to-dos, not human-to-human IM.
            category: 'TODO',
            notifyType: 4,
            title: 'HAPI',
            content: isTest ? 'Test notification. Open HAPI.' : 'New session activity. Open HAPI to view details.',
            skipType: 4,
            skipContent,
            requestId: randomUUID()
        }, authToken)
        if (response?.result === 0) return 'sent'
        // Only explicit per-token evidence prunes a registration. Auth,
        // quota, permission and app/project mismatch errors retain it.
        if (response?.result === 10302 && response.invalidUser?.userid === regId &&
            response.invalidUser.status === 2) return 'invalid'
        return 'failed'
    }

    private async post(path: string, body: unknown, authToken?: string): Promise<VivoResponse | null> {
        try {
            const response = await this.request(`${VIVO_API}${path}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(authToken ? { authToken } : {})
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            })
            if (!response.ok) {
                if (response.status === 401) this.cachedToken = null
                console.error('[VivoPush] Provider request failed:', response.status)
                return null
            }
            const parsed = responseSchema.safeParse(await response.json())
            if (!parsed.success) return null
            if (parsed.data.result !== 0) {
                // Provider bodies can contain identifiers; log only the code.
                console.error('[VivoPush] Provider rejected request:', parsed.data.result)
                if (parsed.data.result === 10000) this.cachedToken = null
            }
            return parsed.data
        } catch {
            console.error('[VivoPush] Provider request failed')
            return null
        }
    }
}
