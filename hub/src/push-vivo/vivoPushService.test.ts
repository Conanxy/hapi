import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { Store } from '../store'
import { decryptEnvelope } from '../push-native/envelope'
import type { NativePushPayload } from '../push-native/types'
import { VivoPushService, vivoNotificationIntent } from './vivoPushService'

const config = { mode: 'test' as const, appId: 10004, appKey: 'app-key', appSecret: 'server-secret' }
const key = Buffer.alloc(32, 5)
const payload: NativePushPayload = {
    title: 'Private project', body: 'Sensitive assistant response', data: {
        type: 'permission-request', sessionId: 'private-session', sessionName: 'Secret project',
        url: '/sessions/private-session', title: 'Private project', body: 'Sensitive assistant response',
        requestId: 'secret-request', contractVersion: '1', notifySummary: 'secret-summary'
    }
}

function addDevice(store: Store, token = 'vivo-token') {
    store.fcm.upsertDevice('default', { token, deviceId: token, platform: 'vivo', pushKey: key.toString('base64') })
}

describe('vivo test push', () => {
    it('targets a single registration and marks the generic notification as a test', async () => {
        const store = new Store(':memory:')
        try {
            addDevice(store, 'one')
            addDevice(store, 'two')
            const sends: Record<string, unknown>[] = []
            const request = (async (url: string | URL | Request, init?: RequestInit) => {
                if (String(url).endsWith('/auth')) return Response.json({ result: 0, authToken: 'token' })
                sends.push(JSON.parse(String(init?.body)))
                return Response.json({ result: 0 })
            }) as typeof fetch
            const service = new VivoPushService(config, store, request)
            expect(await service.sendToNamespace('default', { ...payload, data: { ...payload.data, type: 'test' } },
                { deviceId: 'two', platform: 'vivo' })).toEqual({ sent: 1, failed: 0, invalidTokens: [] })
            expect(sends).toHaveLength(1)
            expect(sends[0]).toMatchObject({ regId: 'two', content: 'Test notification. Open HAPI.', pushMode: 1 })
            await service.sendToNamespace('default', payload, { deviceId: 'two', platform: 'phone' })
            expect(sends).toHaveLength(1)
        } finally { store.close() }
    })
    it('authenticates once, isolates providers/namespaces and encrypts the tap target', async () => {
        const store = new Store(':memory:')
        try {
            addDevice(store)
            store.fcm.upsertDevice('default', { token: 'fcm-token', deviceId: 'pixel', platform: 'phone' })
            store.fcm.upsertDevice('other', { token: 'other-token', deviceId: 'other', platform: 'vivo', pushKey: key.toString('base64') })
            const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = []
            const request = (async (url: string | URL | Request, init?: RequestInit) => {
                calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
                return Response.json(String(url).endsWith('/auth') ? { result: 0, authToken: 'provider-token' } : { result: 0 })
            }) as typeof fetch
            const service = new VivoPushService(config, store, request)
            expect(await service.sendToNamespace('default', payload)).toEqual({ sent: 1, failed: 0, invalidTokens: [] })
            await service.sendToNamespace('default', payload)
            expect(calls.filter(call => call.url.endsWith('/auth'))).toHaveLength(1)
            const auth = calls[0].body
            expect(auth.sign).toBe(createHash('md5').update(`10004app-key${auth.timestamp}server-secret`).digest('hex'))
            expect(auth).not.toHaveProperty('appSecret')
            const send = calls[1]
            expect(send.headers.get('authToken')).toBe('provider-token')
            expect(send.body).toMatchObject({ appId: 10004, regId: 'vivo-token', pushMode: 1, category: 'TODO', skipType: 4, title: 'HAPI' })
            const encoded = String(send.body.skipContent).match(/;S\.hapi_e=([^;]+);/)?.[1]
            expect(encoded).toBeDefined()
            expect(JSON.parse(decryptEnvelope(key, decodeURIComponent(encoded!)))).toEqual({
                type: 'permission-request', sessionId: 'private-session', contractVersion: '1'
            })
            const wire = JSON.stringify(send.body)
            for (const secret of ['Private project', 'Sensitive assistant response', 'private-session', 'secret-request', 'secret-summary', 'server-secret']) {
                expect(wire).not.toContain(secret)
            }
        } finally {
            store.close()
        }
    })

    it('rejects missing keys and oversized routes without truncating IDs', () => {
        expect(vivoNotificationIntent(null, payload)).toBeNull()
        expect(vivoNotificationIntent(Buffer.alloc(31).toString('base64'), payload)).toBeNull()
        expect(vivoNotificationIntent(key.toString('base64'), {
            ...payload, data: { ...payload.data, sessionId: 'x'.repeat(3000) }
        })).toBeNull()
    })

    it('shares auth across concurrent sends', async () => {
        const store = new Store(':memory:')
        try {
            addDevice(store)
            let authCalls = 0
            const request = (async (url: string | URL | Request) => {
                if (String(url).endsWith('/auth')) {
                    authCalls += 1
                    await new Promise(resolve => setTimeout(resolve, 5))
                    return Response.json({ result: 0, authToken: 'token' })
                }
                return Response.json({ result: 0 })
            }) as typeof fetch
            const service = new VivoPushService(config, store, request)
            const results = await Promise.all([service.sendToNamespace('default', payload), service.sendToNamespace('default', payload)])
            expect(authCalls).toBe(1)
            expect(results.map(result => result.sent)).toEqual([1, 1])
        } finally {
            store.close()
        }
    })

    it('retains tokens for quota/auth/mismatch errors and only prunes explicit unsubscribe evidence', async () => {
        for (const response of [
            { result: 10045 },
            { result: 10000 },
            { result: 10094 },
            { result: 10302, invalidUser: { userid: 'vivo-token', status: 1 } },
            { result: 10302, invalidUser: { userid: 'unrelated', status: 2 } },
            { result: 10302, invalidUser: { userid: 'vivo-token', status: 2 } }
        ]) {
            const store = new Store(':memory:')
            try {
                addDevice(store)
                const request = (async (url: string | URL | Request) =>
                    Response.json(String(url).endsWith('/auth') ? { result: 0, authToken: 'token' } : response)) as typeof fetch
                const result = await new VivoPushService(config, store, request).sendToNamespace('default', payload)
                const invalid = response.result === 10302 && response.invalidUser?.userid === 'vivo-token' && response.invalidUser.status === 2
                expect(result).toEqual({ sent: 0, failed: 1, invalidTokens: invalid ? ['vivo-token'] : [] })
                expect(store.fcm.getDevicesByNamespace('default')).toHaveLength(invalid ? 0 : 1)
            } finally {
                store.close()
            }
        }
    })

    it('keeps registrations after network failures, malformed responses and expired auth', async () => {
        const store = new Store(':memory:')
        try {
            addDevice(store)
            let authCalls = 0
            let fail = true
            const request = (async (url: string | URL | Request) => {
                if (String(url).endsWith('/auth')) {
                    authCalls += 1
                    return Response.json({ result: 0, authToken: 'token' })
                }
                if (fail) return new Response('', { status: 401 })
                return Response.json({ result: 0 })
            }) as typeof fetch
            const service = new VivoPushService(config, store, request)
            expect((await service.sendToNamespace('default', payload)).failed).toBe(1)
            fail = false
            expect((await service.sendToNamespace('default', payload)).sent).toBe(1)
            expect(authCalls).toBe(2)
            for (const request of [
                (async () => { throw new Error('offline') }) as unknown as typeof fetch,
                (async () => Response.json({ unexpected: 'response' })) as unknown as typeof fetch
            ]) {
                expect((await new VivoPushService(config, store, request).sendToNamespace('default', payload)).failed).toBe(1)
            }
            expect(store.fcm.getDevicesByNamespace('default')).toHaveLength(1)
        } finally {
            store.close()
        }
    })
})
