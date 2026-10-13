import { describe, expect, it, mock, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import type { ResolvedPushProvider } from '../../push-native/providers'
import type { NativePushDevicesResponse } from '@hapi/protocol/apiTypes'
import { createDevicesRoutes } from './devices'

const target = { deviceId: 'install', platform: 'vivo' }

function fixture() {
    const store = new Store(':memory:')
    store.fcm.upsertDevice('mine', { ...target, platform: 'vivo', token: 'private-token', pushKey: Buffer.alloc(32).toString('base64') })
    store.fcm.upsertDevice('other', { deviceId: 'foreign', platform: 'vivo', token: 'other-token' })
    const send = mock(async () => ({ sent: 1, failed: 0, invalidTokens: [] as string[] }))
    const provider: ResolvedPushProvider = {
        id: 'vivo', platforms: ['vivo'], status: 'test', channel: null, testSender: { sendToNamespace: send }
    }
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => { c.set('namespace', 'mine'); await next() })
    app.route('/api', createDevicesRoutes(store, [provider]))
    const post = (body: unknown = target) => app.request('/api/devices/test', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
    return { store, app, send, post, provider }
}

describe('native push test routes', () => {
    it('lists only namespace-local metadata, never tokens or encryption keys', async () => {
        const { store, app } = fixture()
        try {
            const response = await app.request('/api/devices')
            expect(response.headers.get('cache-control')).toBe('no-store')
            const json = await response.json() as NativePushDevicesResponse
            expect(json.devices).toHaveLength(1)
            expect(Object.keys(json.devices[0]).sort()).toEqual(['deviceId', 'enabled', 'platform', 'providerId', 'testable', 'updatedAt'])
            expect(json.devices[0]).toMatchObject({ ...target, providerId: 'vivo', testable: true })
        } finally { store.close() }
    })

    it('sends a fixed test to exactly the selected namespace/device, returning accepted not delivered', async () => {
        const { store, post, send } = fixture()
        try {
            const response = await post()
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ status: 'accepted', providerId: 'vivo', retryAfterSeconds: 10 })
            expect(send).toHaveBeenCalledWith('mine', expect.objectContaining({
                data: expect.objectContaining({ type: 'test', sessionId: '__hapi_push_test__', contractVersion: '1' })
            }), target)
        } finally { store.close() }
    })

    it('rejects invalid, missing and cross-namespace targets without sending', async () => {
        const { store, post, send } = fixture()
        try {
            for (const body of [null, {}, { ...target, platform: 'unknown' }, { ...target, deviceId: '' }]) {
                expect((await post(body)).status).toBe(400)
            }
            expect((await post({ ...target, deviceId: 'foreign' })).status).toBe(404)
            expect((await post({ ...target, platform: 'phone' })).status).toBe(404)
            expect(send).not.toHaveBeenCalled()
        } finally { store.close() }
    })

    it('reports unsupported/disabled channels without invoking the sender', async () => {
        const { store, post, provider, send, app } = fixture()
        try {
            provider.testPlatforms = ['phone']
            expect((await post()).status).toBe(503)
            const json = await (await app.request('/api/devices')).json() as NativePushDevicesResponse
            expect(json.devices[0].testable).toBe(false)
            delete provider.testSender
            expect((await post()).status).toBe(503)
            expect(send).not.toHaveBeenCalled()
        } finally { store.close() }
    })

    it('retains cooldown after upstream failures, then allows retry', async () => {
        const { store, post, send } = fixture()
        const clock = spyOn(Date, 'now').mockReturnValue(100_000)
        try {
            send.mockResolvedValue({ sent: 0, failed: 1, invalidTokens: [] })
            expect((await post()).status).toBe(502)
            const limited = await post()
            expect(limited.status).toBe(429)
            expect(limited.headers.get('retry-after')).toBe('10')
            expect(send).toHaveBeenCalledTimes(1)
            clock.mockReturnValue(110_000)
            send.mockResolvedValue({ sent: 1, failed: 0, invalidTokens: [] })
            expect((await post()).status).toBe(200)
        } finally { clock.mockRestore(); store.close() }
    })

    it('blocks concurrent sends even after ten seconds in flight and handles thrown transports', async () => {
        const { store, post, send } = fixture()
        const clock = spyOn(Date, 'now').mockReturnValue(100_000)
        let rejectSend!: (reason: Error) => void
        let entered!: () => void
        const started = new Promise<void>(resolve => { entered = resolve })
        send.mockImplementation(() => { entered(); return new Promise((_, reject) => { rejectSend = reject }) })
        try {
            const first = post()
            await started
            clock.mockReturnValue(120_000)
            expect((await post()).status).toBe(429)
            rejectSend(new Error('private upstream error'))
            const response = await first
            expect(response.status).toBe(502)
            expect(await response.text()).not.toContain('private upstream error')
            expect((await post()).status).toBe(429)
        } finally { clock.mockRestore(); store.close() }
    })
})
