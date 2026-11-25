import { describe, expect, it, spyOn } from 'bun:test'
import type { Session } from '../sync/syncEngine'
import { PushNotificationChannel } from '../push/pushNotificationChannel'
import type { PushPayload } from '../push/pushService'
import { Store } from '../store'
import { createNativePushProviders, type NativePushSettings } from './providers'

const settings: NativePushSettings = {
    androidPushMode: 'off', fcmServiceAccountPath: null,
    iosPushMode: 'off', iosPushRelayUrl: null, apnsKeyP8Path: null, apnsKeyId: null,
    apnsTeamId: null, apnsBundleId: null, apnsEnv: null,
    vivoPushMode: null, vivoAppId: null, vivoAppKey: null, vivoAppSecret: null
}

describe('native push provider registry', () => {
    it('registers built-in providers without activating optional transports', () => {
        const store = new Store(':memory:')
        try {
            const providers = createNativePushProviders(settings, { store })
            expect(providers.map(provider => provider.id)).toEqual(['android', 'vivo', 'ios'])
            expect(providers.every(provider => provider.channel === null)).toBe(true)
            const vivo = createNativePushProviders({
                ...settings, vivoPushMode: 'test', vivoAppId: '10004', vivoAppKey: 'key', vivoAppSecret: 'secret'
            }, { store }).find(provider => provider.id === 'vivo')
            expect(vivo?.channel).not.toBeNull()
            expect(vivo?.status).not.toContain('secret')
        } finally {
            store.close()
        }
    })

    it('delivers completion, permission and model-error notifications through Web Push after vivo accepts them', async () => {
        const store = new Store(':memory:')
        try {
            const vivo = createNativePushProviders({
                ...settings, vivoPushMode: 'test', vivoAppId: '10004', vivoAppKey: 'key', vivoAppSecret: 'secret'
            }, { store }).find(provider => provider.id === 'vivo')
            if (!vivo?.channel?.sendModelError || !vivo.testSender) throw new Error('vivo push provider is unavailable')

            const sendVivo = spyOn(vivo.testSender, 'sendToNamespace')
                .mockResolvedValue({ sent: 1, failed: 0, invalidTokens: [] })
            const pushed: PushPayload[] = []
            const web = new PushNotificationChannel(
                {
                    sendToNamespace: async (_namespace: string, payload: PushPayload) => {
                        pushed.push(payload)
                        return { sent: 1, failed: 0, subscriptions: 1 }
                    }
                } as never,
                { sendToast: async () => 0 } as never,
                { hasVisibleConnection: () => false } as never,
                ''
            )
            const session = {
                id: 'session-vivo', namespace: 'default', active: true,
                metadata: { flavor: 'codex' },
                agentState: { requests: { 'request-1': { tool: 'Bash', arguments: {} } } }
            } as unknown as Session
            const notification = {
                eventId: 'error-1', kind: 'quota_exhausted', transient: false,
                rawSnippet: '', priorAssistantClaimsDone: false, atTs: 1
            } as const
            const readyContext = { nativeGate: { sent: false } }
            const permissionContext = { nativeGate: { sent: false } }
            const errorContext = { nativeGate: { sent: false } }

            await vivo.channel.sendReady(session, readyContext)
            await web.sendReady(session, readyContext)
            await vivo.channel.sendPermissionRequest(session, permissionContext)
            await web.sendPermissionRequest(session, permissionContext)
            expect(await vivo.channel.sendModelError(session, notification, errorContext)).toBe('delivered')
            expect(await web.sendModelError(session, notification, errorContext)).toBe('delivered')

            expect(sendVivo.mock.calls.map(([, payload]) => payload.data.type))
                .toEqual(['ready', 'permission-request', 'model-error'])
            expect(pushed.map(payload => payload.data?.type))
                .toEqual(['ready', 'permission-request', 'model-error'])
        } finally {
            store.close()
        }
    })

    it('accepts a new provider through the registry alone and rejects duplicate IDs', () => {
        const store = new Store(':memory:')
        try {
            const channel = { sendReady: async () => {}, sendPermissionRequest: async () => {}, sendTaskNotification: async () => {} }
            const provider = { id: 'next-provider', platforms: [], create: () => ({ status: 'enabled', channel }) }
            expect(createNativePushProviders(settings, { store }, [provider])).toEqual([{ id: 'next-provider', platforms: [], status: 'enabled', channel }])
            expect(() => createNativePushProviders(settings, { store }, [provider, provider])).toThrow('Duplicate')
        } finally {
            store.close()
        }
    })
})
