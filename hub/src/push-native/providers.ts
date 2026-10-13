import type { NotificationChannel } from '../notifications/notificationTypes'
import type { Store } from '../store'
import { FcmService } from '../fcm/fcmService'
import { AndroidRelayService } from '../fcm/androidRelayService'
import { resolveAndroidPushConfig, type AndroidPushSettings } from '../fcm/androidPushConfig'
import { ApnsClient } from '../push-ios/apnsClient'
import { IosPushService } from '../push-ios/iosPushService'
import { IosPushNotificationChannel } from '../push-ios/iosPushChannel'
import { resolveIosPushConfig, type IosPushSettings } from '../push-ios/iosPushConfig'
import { VivoPushService } from '../push-vivo/vivoPushService'
import { resolveVivoPushConfig, type VivoPushSettings } from '../push-vivo/vivoPushConfig'
import { NativePushNotificationChannel } from './nativePushNotificationChannel'
import { RelayClient } from './relayClient'
import type { NativePushPlatform } from './platforms'
import type { NativePushSender } from './types'

export type NativePushSettings = AndroidPushSettings & IosPushSettings & VivoPushSettings
export type NativePushContext = { store: Store }
export type ResolvedPushProvider = {
    id: string
    platforms: readonly NativePushPlatform[]
    channel: NotificationChannel | null
    status: string
    testSender?: NativePushSender
    testPlatforms?: readonly NativePushPlatform[]
}
export type NativePushProvider = {
    id: string
    platforms: readonly NativePushPlatform[]
    create(settings: NativePushSettings, context: NativePushContext): Omit<ResolvedPushProvider, 'id' | 'platforms'>
}

/** Adding a transport belongs here and in its adapter, never in session/startup code. */
const providers: readonly NativePushProvider[] = [
    {
        id: 'android',
        platforms: ['phone', 'wear'],
        create(settings, { store }) {
            const config = resolveAndroidPushConfig(settings)
            if (config.mode === 'off') return { channel: null, status: `off (${config.reason})` }
            const sender = config.mode === 'fcm'
                ? new FcmService(config.fcm.projectId, config.fcm.serviceAccount, store)
                : new AndroidRelayService(new RelayClient(config.relayUrl, 'android'), store)
            return {
                channel: new NativePushNotificationChannel(sender, store),
                testSender: sender,
                testPlatforms: config.mode === 'fcm' ? ['phone', 'wear'] : ['phone'],
                status: config.mode === 'fcm' ? 'fcm' : 'encrypted relay'
            }
        }
    },
    {
        id: 'vivo',
        platforms: ['vivo'],
        create(settings, { store }) {
            const config = resolveVivoPushConfig(settings)
            if (config.mode === 'off') return { channel: null, status: `off (${config.reason})` }
            const sender = new VivoPushService(config, store)
            return {
                channel: new NativePushNotificationChannel(sender, store),
                testSender: sender,
                status: 'test (online devices only; provider daily quota applies)'
            }
        }
    },
    {
        id: 'ios',
        platforms: ['ios'],
        create(settings, { store }) {
            const config = resolveIosPushConfig(settings)
            if (config.mode === 'off') return { channel: null, status: `off (${config.reason})` }
            const transport = config.mode === 'apns' ? new ApnsClient(config) : new RelayClient(config.relayUrl, 'ios')
            return {
                channel: new IosPushNotificationChannel(new IosPushService(transport, store), store),
                status: config.mode
            }
        }
    }
]

export function createNativePushProviders(
    settings: NativePushSettings,
    context: NativePushContext,
    definitions: readonly NativePushProvider[] = providers
): ResolvedPushProvider[] {
    if (new Set(definitions.map(provider => provider.id)).size !== definitions.length) {
        throw new Error('Duplicate native push provider id')
    }
    return definitions.map(provider => ({
        id: provider.id, platforms: provider.platforms, ...provider.create(settings, context)
    }))
}
