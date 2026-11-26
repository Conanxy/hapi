import { useState } from 'react'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { SettingsSwitch } from './SettingsPrimitives'

export function PushNotificationsControl() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { isSupported, permission, isSubscribed, alwaysNotifyOnReady, requestPermission, subscribe, unsubscribe } = usePushNotifications(api)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState<'push' | 'ready' | null>(null)

    const change = async (enabled: boolean, readyOnly = false) => {
        const setting = readyOnly ? 'ready' : 'push'
        setBusy(true)
        setFailed(null)
        try {
            // requestPermission must run directly in the user's click handler.
            const ok = readyOnly
                ? await subscribe(enabled)
                : enabled ? (await requestPermission()) && await subscribe() : await unsubscribe()
            if (!ok) setFailed(setting)
        } catch {
            setFailed(setting)
        } finally {
            setBusy(false)
        }
    }

    const description = !isSupported ? t('settings.notifications.unsupported')
        : permission === 'denied' ? t('settings.notifications.denied')
            : failed === 'push' ? t('settings.notifications.failed')
                : t('settings.notifications.description')
    const disabled = !api || !isSupported || permission === 'denied' || busy
    return <>
        <SettingsSwitch
            label={t('settings.notifications.push')}
            description={description}
            checked={isSubscribed}
            disabled={disabled}
            onChange={(enabled) => { void change(enabled) }}
        />
        <SettingsSwitch
            label={t('settings.notifications.alwaysNotifyOnReady')}
            description={failed === 'ready'
                ? t('settings.notifications.failed')
                : t('settings.notifications.alwaysNotifyOnReady.description')}
            checked={isSubscribed && alwaysNotifyOnReady}
            disabled={disabled || !isSubscribed}
            onChange={(enabled) => { void change(enabled, true) }}
        />
    </>
}
