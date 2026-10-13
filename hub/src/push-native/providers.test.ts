import { describe, expect, it } from 'bun:test'
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
