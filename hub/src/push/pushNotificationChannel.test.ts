import { describe, expect, it } from 'bun:test'
import type { Session } from '../sync/syncEngine'
import { PushNotificationChannel } from './pushNotificationChannel'
import type { PushPayload } from './pushService'

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-toast',
        namespace: 'default',
        name: 'Demo session',
        active: true,
        metadata: { flavor: 'codex' },
        ...overrides
    } as Session
}

describe('PushNotificationChannel', () => {
    it('sends ready notifications to visible web clients before falling back to push', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const toasts: unknown[] = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload, optedInOnly = false) => {
                    if (!optedInOnly) pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async (_namespace: string, event: unknown) => {
                    toasts.push(event)
                    return 1
                }
            } as never,
            {
                hasVisibleConnection: () => true
            } as never,
            ''
        )

        await channel.sendReady(createSession())

        expect(toasts).toHaveLength(1)
        expect(pushed).toHaveLength(0)
    })

    it('skips web-push when native FCM delivered in the same dispatch', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload, optedInOnly = false) => {
                    if (!optedInOnly) pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => 0
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            ''
        )

        const ctx = { nativeGate: { sent: true } }

        await channel.sendPermissionRequest(createSession({
            agentState: {
                requests: { 'req-1': { tool: 'Bash', arguments: {} } }
            }
        }), ctx)
        await channel.sendReady(createSession(), ctx)

        expect(pushed).toHaveLength(0)
    })

    it.each([
        { visible: true, nativeSent: false, toastCount: 1, optedInOnly: true },
        { visible: false, nativeSent: true, toastCount: 0, optedInOnly: true },
        { visible: false, nativeSent: false, toastCount: 0, optedInOnly: false }
    ])('sends ready Web Push only once (visible=$visible, native=$nativeSent)', async ({
        visible, nativeSent, toastCount, optedInOnly
    }) => {
        const deliveries: boolean[] = []
        let toasts = 0
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (_namespace: string, payload: PushPayload, optedIn = false) => {
                    expect(payload.data?.type).toBe('ready')
                    deliveries.push(optedIn)
                }
            } as never,
            { sendToast: async () => ++toasts } as never,
            { hasVisibleConnection: () => visible } as never,
            ''
        )

        await channel.sendReady(createSession(), { nativeGate: { sent: nativeSent } })

        expect(deliveries).toEqual([optedInOnly])
        expect(toasts).toBe(toastCount)
    })

    it('falls back to web-push when native gate is unset (FCM failed or absent)', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => 0
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            ''
        )

        await channel.sendReady(createSession(), { nativeGate: { sent: false } })

        expect(pushed).toHaveLength(1)
    })

    it('still sends web-push when no native gate is provided', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => 0
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            ''
        )

        await channel.sendReady(createSession())

        expect(pushed).toHaveLength(1)
    })

    it('also skips SSE in-page toast when native gate reports delivery', async () => {
        const pushed: Array<{ type: string | undefined; optedInOnly: boolean }> = []
        const toasts: unknown[] = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (_namespace: string, payload: PushPayload, optedInOnly = false) => {
                    pushed.push({ type: payload.data?.type, optedInOnly })
                }
            } as never,
            {
                sendToast: async (_namespace: string, event: unknown) => {
                    toasts.push(event)
                    return 99
                }
            } as never,
            {
                hasVisibleConnection: () => true
            } as never,
            ''
        )

        const ctx = { nativeGate: { sent: true } }

        await channel.sendReady(createSession(), ctx)
        await channel.sendPermissionRequest(createSession({
            agentState: { requests: { 'r-1': { tool: 'Bash', arguments: {} } } }
        }), ctx)

        expect(toasts).toHaveLength(0)
        expect(pushed).toEqual([{ type: 'ready', optedInOnly: true }])
    })

    it('sendModelError defers when nativeGate.sent is true', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                    return { sent: 1, failed: 0, subscriptions: 1 }
                }
            } as never,
            { sendToast: async () => 0 } as never,
            { hasVisibleConnection: () => false } as never,
            ''
        )

        await channel.sendModelError(createSession(), {
            eventId: 'evt-1',
            kind: 'quota_exhausted',
            transient: false,
            rawSnippet: 'x',
            priorAssistantClaimsDone: false,
            atTs: 1
        }, { nativeGate: { sent: true } })

        expect(pushed).toHaveLength(0)
    })
    it('sendModelError fires web-push when nativeGate.sent is false', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                    return { sent: 1, failed: 0, subscriptions: 1 }
                }
            } as never,
            { sendToast: async () => 0 } as never,
            { hasVisibleConnection: () => false } as never,
            ''
        )

        await channel.sendModelError(createSession(), {
            eventId: 'evt-2',
            kind: 'rate_limited',
            transient: true,
            rawSnippet: 'y',
            priorAssistantClaimsDone: false,
            atTs: 2
        }, { nativeGate: { sent: false } })

        expect(pushed).toHaveLength(1)
        expect(pushed[0]?.payload.data?.type).toBe('model-error')
    })
})
