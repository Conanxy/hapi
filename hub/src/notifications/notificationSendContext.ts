/**
 * Per-notification dispatch context shared across channels in one
 * NotificationHub notify* call. NativePushNotificationChannel runs first and
 * sets `nativeGate.sent` when a provider accepts a send; PushNotificationChannel
 * consults the same gate before suppressing web-push/SSE (never on stale
 * registration/health probes alone).
 */
export type NativeDeliveryGate = {
    sent: boolean
}

export type NotificationSendContext = {
    nativeGate?: NativeDeliveryGate
}
