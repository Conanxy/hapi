import { Hono } from 'hono'
import { z } from 'zod'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { NATIVE_PUSH_PLATFORMS, nativePushPlatforms } from '../../push-native/platforms'
import type { ResolvedPushProvider } from '../../push-native/providers'
import type { NativePushPayload } from '../../push-native/types'
import type { NativePushDevicesResponse, NativePushTestResponse } from '@hapi/protocol/apiTypes'

const PUSH_KEY_BYTES = 32

/**
 * Strict base64 -> exactly 32 bytes, or null. `Buffer.from(_, 'base64')`
 * silently skips invalid characters, so an alphabet check comes first -
 * otherwise garbage like `"!!!!" + 43 chars` could sneak past the length
 * gate and register an undecryptable key.
 */
function decodePushKey(pushKey: string): Buffer | null {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pushKey)) {
        return null
    }
    const decoded = Buffer.from(pushKey, 'base64')
    return decoded.length === PUSH_KEY_BYTES ? decoded : null
}

const registerSchema = z.object({
    token: z.string().min(1),
    platform: z.enum(nativePushPlatforms),
    deviceId: z.string().min(1).max(128),
    /**
     * Base64 of 32 device-generated random bytes. Required for iOS/vivo;
     * optional for phone (old direct-FCM clients), ignored for Wear.
     */
    pushKey: z.string().optional()
}).superRefine((data, ctx) => {
    if (data.platform === 'wear' || (!NATIVE_PUSH_PLATFORMS[data.platform].requiresKey && data.pushKey === undefined)) {
        return
    }
    if (!data.pushKey || decodePushKey(data.pushKey) === null) {
        ctx.addIssue({
            code: 'custom',
            path: ['pushKey'],
            message: 'pushKey must be base64 of exactly 32 bytes for encrypted native push'
        })
    }
})

const unregisterSchema = z.object({
    token: z.string().min(1)
})

export function createDevicesRoutes(store: Store, providers: readonly ResolvedPushProvider[] = []): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const cooldowns = new Map<string, { until: number; pending: boolean }>()
    const cooldownMs = 10_000

    app.get('/devices', (c) => {
        c.header('Cache-Control', 'no-store')
        const devices = store.fcm.getDevicesByNamespace(c.get('namespace')).map(device => {
            const provider = providers.find(candidate => candidate.platforms.includes(device.platform))
            return {
                deviceId: device.deviceId,
                platform: device.platform,
                updatedAt: device.updatedAt,
                providerId: provider?.id ?? null,
                enabled: Boolean(provider?.channel),
                testable: Boolean(provider?.testSender && (!provider.testPlatforms || provider.testPlatforms.includes(device.platform)))
            }
        })
        return c.json({ devices } satisfies NativePushDevicesResponse)
    })

    app.post('/devices/test', async (c) => {
        c.header('Cache-Control', 'no-store')
        const parsed = z.object({
            deviceId: z.string().min(1).max(128),
            platform: z.enum(nativePushPlatforms)
        }).safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const namespace = c.get('namespace')
        const target = parsed.data
        const device = store.fcm.getDevicesByNamespace(namespace, [target.platform])
            .find(candidate => candidate.deviceId === target.deviceId)
        if (!device) return c.json({ error: 'Device not registered', code: 'device-not-found' }, 404)
        const provider = providers.find(candidate => candidate.platforms.includes(target.platform))
        if (!provider?.testSender || (provider.testPlatforms && !provider.testPlatforms.includes(target.platform))) {
            return c.json({ error: 'Push test unavailable', code: 'push-test-unavailable' }, 503)
        }

        const now = Date.now()
        for (const [key, entry] of cooldowns) {
            if (!entry.pending && entry.until <= now) cooldowns.delete(key)
        }
        const key = JSON.stringify([namespace, provider.id])
        const previous = cooldowns.get(key)
        if (previous || cooldowns.size >= 1024) {
            const retryAfterSeconds = Math.max(1, Math.ceil(((previous?.until ?? now + cooldownMs) - now) / 1000))
            c.header('Retry-After', String(retryAfterSeconds))
            return c.json({ error: 'Push test rate limited', code: 'push-test-rate-limited', retryAfterSeconds }, 429)
        }
        // Reserve before awaiting: concurrent clicks cannot consume the provider quota.
        const entry = { until: now + cooldownMs, pending: true }
        cooldowns.set(key, entry)
        const title = 'HAPI'
        const body = 'Test notification. Open HAPI.'
        const payload: NativePushPayload = {
            title, body, tag: 'hapi-push-test',
            data: { type: 'test', sessionId: '__hapi_push_test__', sessionName: '', url: '/',
                title, body, contractVersion: '1' }
        }
        try {
            const result = await provider.testSender.sendToNamespace(namespace, payload, target)
            if (result.sent !== 1 || result.failed !== 0) {
                return c.json({ error: 'Push provider did not accept the test', code: 'push-test-failed' }, 502)
            }
            return c.json({ status: 'accepted', providerId: provider.id, retryAfterSeconds: 10 } satisfies NativePushTestResponse)
        } catch {
            return c.json({ error: 'Push provider did not accept the test', code: 'push-test-failed' }, 502)
        } finally {
            entry.pending = false
            entry.until = Date.now() + cooldownMs
        }
    })

    app.post('/devices/register', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = registerSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const namespace = c.get('namespace')
        const { token, platform, deviceId, pushKey } = parsed.data
        if (platform !== 'wear' && pushKey !== undefined) {
            // Store the canonical re-encoding so the send path always
            // decodes cleanly regardless of the client's padding style.
            const decoded = decodePushKey(pushKey ?? '')!
            store.fcm.upsertDevice(namespace, {
                token,
                platform,
                deviceId,
                pushKey: decoded.toString('base64')
            })
        } else {
            store.fcm.upsertDevice(namespace, { token, platform, deviceId })
        }
        return c.json({ ok: true })
    })

    app.delete('/devices/register', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = unregisterSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const namespace = c.get('namespace')
        store.fcm.removeDeviceByToken(namespace, parsed.data.token)
        return c.json({ ok: true })
    })

    return app
}
