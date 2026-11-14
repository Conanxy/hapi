import type { Session } from '../sync/syncEngine'
import type { ModelErrorNotification, ModelErrorSendOutcome, NotificationChannel } from '../notifications/notificationTypes'
import type { NotificationSendContext } from '../notifications/notificationSendContext'
import { NATIVE_CONTRACT_VERSION, NativeNotificationComposer, type ComposedNativeNotification } from '../notifications/nativeNotificationComposer'
import { formatModelErrorBody, formatModelErrorTitle } from '../notifications/modelErrorCopy'
import { getAgentName, getSessionName } from '../notifications/sessionInfo'
import type { Store } from '../store'
import type { NativePushPayload, NativePushResult, NativePushSender } from './types'

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

    async sendModelError(
        session: Session,
        notification: ModelErrorNotification,
        ctx?: NotificationSendContext
    ): Promise<ModelErrorSendOutcome> {
        // A retry can outlive the active flag, so let NotificationHub decide
        // whether this delivery should still be attempted.
        const agentName = getAgentName(session)
        const sessionName = getSessionName(session)
        const title = formatModelErrorTitle(notification.kind)
        const body = formatModelErrorBody(notification, { agentName, sessionName })
        const tag = `model-error-${session.id}-${notification.eventId}`
        const result = await this.deliver(session, {
            title,
            body,
            tag,
            data: {
                type: 'model-error',
                sessionId: session.id,
                sessionName,
                url: `/sessions/${session.id}`,
                title,
                body,
                contractVersion: NATIVE_CONTRACT_VERSION,
                severity: 'error',
                tag
            }
        }, ctx)
        if (result.sent > 0) {
            return 'delivered'
        }
        if (result.failed === 0) {
            return 'unavailable'
        }
        return 'failed'
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

    private async deliver(
        session: Session,
        payload: NativePushPayload,
        ctx?: NotificationSendContext
    ): Promise<NativePushResult> {
        // Native delivery is independent of PWA visibility. Providers own
        // transport details; successful delivery engages the Web Push gate.
        const result = await this.sender.sendToNamespace(session.namespace, payload)
        const outcome = result ?? { sent: 0, failed: 0, invalidTokens: [] }
        if (outcome.sent > 0 && ctx?.nativeGate) {
            ctx.nativeGate.sent = true
        }
        return outcome
    }
}
