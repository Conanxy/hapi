/**
 * Per-notification dispatch context shared across channels in one
 * NotificationHub notify* call. Providers that suppress Web Push set
 * `nativeGate.sent` when a provider accepts a send. PushNotificationChannel
 * uses that flag to suppress Web Push and SSE toasts for this dispatch.
 */
export type NativeDeliveryGate = {
    sent: boolean
}

export type NotificationSendContext = {
    nativeGate?: NativeDeliveryGate
}
