import { expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '.'

it('preserves v36 subscriptions and updates the completion preference per endpoint and namespace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-push-v37-'))
    try {
        const path = join(dir, 'hub.db')
        new Store(path).close()
        const legacy = new Database(path)
        try {
            legacy.exec('ALTER TABLE push_subscriptions DROP COLUMN always_notify_on_ready; PRAGMA user_version = 36;')
            legacy.prepare(`
                INSERT INTO push_subscriptions (namespace, endpoint, p256dh, auth, created_at)
                VALUES ('default', 'https://push.example/endpoint', 'key', 'auth', 1)
            `).run()
        } finally {
            legacy.close()
        }
        const store = new Store(path)
        try {
            const subscription = { endpoint: 'https://push.example/endpoint', p256dh: 'key', auth: 'auth' }
            expect(store.push.getPushSubscriptionsByNamespace('default')).toMatchObject([
                { ...subscription, alwaysNotifyOnReady: false }
            ])
            store.push.addPushSubscription('default', { ...subscription, alwaysNotifyOnReady: true })
            store.push.addPushSubscription('other', subscription)
            store.push.addPushSubscription('default', subscription)
            expect(store.push.getPushSubscriptionsByNamespace('default')[0]?.alwaysNotifyOnReady).toBe(true)
            expect(store.push.getPushSubscriptionsByNamespace('other')[0]?.alwaysNotifyOnReady).toBe(false)
            store.push.addPushSubscription('default', { ...subscription, alwaysNotifyOnReady: false })
            expect(store.push.getPushSubscriptionsByNamespace('default')[0]?.alwaysNotifyOnReady).toBe(false)
        } finally {
            store.close()
        }
    } finally {
        Bun.gc(true)
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
})
