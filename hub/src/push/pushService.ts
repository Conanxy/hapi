import * as webPush from 'web-push'
import type { Store } from '../store'
import type { VapidKeys } from '../config/vapidKeys'

export type PushPayload = {
    title: string
    body: string
    tag?: string
    data?: {
        type: string
        sessionId: string
        url: string
        /** First pending request id; input-request uses it for correlation, never approval. */
        requestId?: string
    }
}

type StoredSubscription = {
    endpoint: string
    p256dh: string
    auth: string
}

type PushSubscription = {
    endpoint: string
    keys: {
        p256dh: string
        auth: string
    }
}

export class PushService {
    constructor(
        private readonly vapidKeys: VapidKeys,
        private readonly subject: string,
        private readonly store: Store
    ) {
        webPush.setVapidDetails(this.subject, this.vapidKeys.publicKey, this.vapidKeys.privateKey)
    }

    async sendToNamespace(namespace: string, payload: PushPayload, onlyAlwaysNotifyOnReady = false): Promise<{ sent: number; failed: number; subscriptions: number }> {
        const subscriptions = this.store.push.getPushSubscriptionsByNamespace(namespace)
            .filter(subscription => !onlyAlwaysNotifyOnReady || subscription.alwaysNotifyOnReady)
        if (subscriptions.length === 0) {
            return { sent: 0, failed: 0, subscriptions: 0 }
        }

        const body = JSON.stringify(payload)
        // A tag replaces a previous notification for the same session.
        // Opted-in devices need a fresh alert for each completion.
        const readyBody = payload.data?.type === 'ready'
            ? JSON.stringify({ ...payload, tag: undefined })
            : body
        const results = await Promise.all(subscriptions.map((subscription) => {
            return this.sendToSubscription(namespace, subscription, subscription.alwaysNotifyOnReady ? readyBody : body)
        }))
        let sent = 0
        let failed = 0
        for (const result of results) {
            if (result === 'sent') {
                sent++
            } else {
                failed++
            }
        }
        return { sent, failed, subscriptions: subscriptions.length }
    }

    private async sendToSubscription(
        namespace: string,
        subscription: StoredSubscription,
        body: string
    ): Promise<'sent' | 'failed'> {
        const pushSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        }

        try {
            await webPush.sendNotification(pushSubscription, body)
            return 'sent'
        } catch (error) {
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode
                : null

            if (statusCode === 410) {
                this.store.push.removePushSubscription(namespace, subscription.endpoint)
                return 'failed'
            }

            console.error('[PushService] Failed to send notification:', error)
            return 'failed'
        }
    }
}
