import { expect, it, spyOn } from 'bun:test'
import * as webPush from 'web-push'
import { Store } from '../store'
import { PushService } from './pushService'

it('delivers opted-in ready push only to matching subscriptions in the namespace', async () => {
    const store = new Store(':memory:')
    const send = spyOn(webPush, 'sendNotification').mockResolvedValue({
        statusCode: 201, body: '', headers: {}
    })
    try {
        const keys = webPush.generateVAPIDKeys()
        const service = new PushService(keys, 'mailto:test@example.com', store)
        for (const [namespace, device, alwaysNotifyOnReady] of [
            ['default', 'enabled', true],
            ['default', 'disabled', false],
            ['other', 'other-namespace', true]
        ] as const) {
            store.push.addPushSubscription(namespace, {
                endpoint: `https://push.example/${device}`,
                p256dh: 'test-key', auth: 'test-auth', alwaysNotifyOnReady
            })
        }
        const payload = {
            title: 'Ready for input',
            body: 'Test session is ready',
            tag: 'ready-test',
            data: { type: 'ready', sessionId: 'test', url: '/sessions/test' }
        }

        expect(await service.sendToNamespace('default', payload, true))
            .toEqual({ sent: 1, failed: 0, subscriptions: 1 })
        expect(send.mock.calls.map(([recipient]) => recipient.endpoint))
            .toEqual(['https://push.example/enabled'])

        send.mockClear()
        expect(await service.sendToNamespace('default', payload))
            .toEqual({ sent: 2, failed: 0, subscriptions: 2 })
        expect(send.mock.calls.map(([recipient, body]) => ({
            endpoint: recipient.endpoint,
            tag: JSON.parse(body?.toString() ?? '{}').tag
        }))).toEqual(expect.arrayContaining([
            { endpoint: 'https://push.example/disabled', tag: 'ready-test' },
            { endpoint: 'https://push.example/enabled', tag: undefined }
        ]))
    } finally {
        send.mockRestore()
        store.close()
    }
})
