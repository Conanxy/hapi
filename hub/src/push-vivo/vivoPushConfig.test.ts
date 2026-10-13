import { describe, expect, it } from 'bun:test'
import { resolveVivoPushConfig, type VivoPushSettings } from './vivoPushConfig'

const base: VivoPushSettings = { vivoPushMode: null, vivoAppId: null, vivoAppKey: null, vivoAppSecret: null }

describe('vivo push configuration', () => {
    it('is off by default, even when credentials exist', () => {
        expect(resolveVivoPushConfig(base).mode).toBe('off')
        expect(resolveVivoPushConfig({ ...base, vivoAppId: '10004', vivoAppKey: 'key', vivoAppSecret: 'secret' }).mode).toBe('off')
    })

    it('only permits explicitly configured test delivery', () => {
        const settings = { ...base, vivoPushMode: 'test', vivoAppId: '10004', vivoAppKey: 'key', vivoAppSecret: 'secret' }
        expect(resolveVivoPushConfig(settings)).toEqual({ mode: 'test', appId: 10004, appKey: 'key', appSecret: 'secret' })
        for (const mode of ['production', 'auto', 'garbage']) {
            expect(resolveVivoPushConfig({ ...settings, vivoPushMode: mode }).mode).toBe('off')
        }
        for (const appId of ['0', '-1', '1.1', '10004oops', '9007199254740992', '']) {
            expect(resolveVivoPushConfig({ ...settings, vivoAppId: appId }).mode).toBe('off')
        }
        expect(resolveVivoPushConfig({ ...settings, vivoAppSecret: null }).mode).toBe('off')
    })
})
