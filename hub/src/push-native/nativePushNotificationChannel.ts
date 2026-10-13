import type { Session } from '../sync/syncEngine'
import type { NotificationChannel, TaskNotification } from '../notifications/notificationTypes'
import type { NotificationSendContext } from '../notifications/notificationSendContext'
import { NATIVE_CONTRACT_VERSION, NativeNotificationComposer, type ComposedNativeNotification } from '../notifications/nativeNotificationComposer'
import type { Store } from '../store'
import type { NativePushPayload, NativePushSender } from './types'

export class NativePushNotificationChannel implements NotificationChannel {
    private readonly composer: NativeNotificationComposer

    constructor(
        private readonly sender: NativePushSender,
        private readonly store?: Store
    ) {
        this.composer = new NativeNotificationComposer(store)
    }

    async sendPermissionRequest(session: Session, ctx?: NotificationSendContext): Promise<void> {
        if (!session.active) {
            return
        }

        await this.deliver(session, this.toPayload(this.composer.composePermissionRequest(session)), ctx)
    }

    async sendReady(session: Session, ctx?: NotificationSendContext): Promise<void> {
        if (!session.active) {
            return
        }

        await this.deliver(session, this.toPayload(this.composer.composeReady(session)), ctx)
    }

    async sendTaskNotification(session: Session, notification: TaskNotification, ctx?: NotificationSendContext): Promise<void> {
        if (!session.active) {
            return
        }

        await this.deliver(session, this.toPayload(this.composer.composeTask(session, notification)), ctx)
    }

    private toPayload(composed: ComposedNativeNotification): NativePushPayload {
        return {
            title: composed.title,
            body: composed.body,
            tag: composed.tag,
            data: {
                type: composed.type,
                sessionId: composed.sessionId,
                sessionName: composed.sessionName,
                url: composed.url,
                requestId: composed.requestId,
                title: composed.title,
                body: composed.body,
                contractVersion: NATIVE_CONTRACT_VERSION,
                severity: composed.severity,
                ...(composed.notifySummary ? { notifySummary: composed.notifySummary } : {})
            }
        }
    }

    private async deliver(session: Session, payload: NativePushPayload, ctx?: NotificationSendContext): Promise<void> {
        // Native delivery is independent of PWA visibility. Providers own
        // transport details; successful delivery engages the Web Push gate.
        const result = await this.sender.sendToNamespace(session.namespace, payload)
        if ((result?.sent ?? 0) > 0 && ctx?.nativeGate) {
            ctx.nativeGate.sent = true
        }
    }
}
