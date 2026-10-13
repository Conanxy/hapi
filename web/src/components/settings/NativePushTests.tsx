import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { NativePushTestRequest } from '@hapi/protocol/apiTypes'
import { ApiError } from '@/api/client'
import { ShareIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'

const platformNames: Record<string, string> = { vivo: 'vivo', phone: 'Android', wear: 'Wear OS', ios: 'iOS' }

function retryAfter(error: unknown): number {
    if (!(error instanceof ApiError) || error.status !== 429 || !error.body) return 10
    try {
        const value = (JSON.parse(error.body) as { retryAfterSeconds?: unknown }).retryAfterSeconds
        return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 10
    } catch {
        return 10
    }
}

function DeviceTests() {
    const { api, baseUrl, token } = useAppContext()
    const { t, locale } = useTranslation()
    const [remaining, setRemaining] = useState(0)
    const [cooldownUntil, setCooldownUntil] = useState(0)
    const devices = useQuery({
        queryKey: queryKeys.nativePushDevices(baseUrl, token),
        queryFn: () => api.getNativePushDevices(),
        staleTime: 15_000,
        retry: false,
    })
    const mutation = useMutation({
        mutationFn: (target: NativePushTestRequest) => api.testNativePush(target),
        retry: false,
        onSettled: (data, error) => {
            const seconds = data?.retryAfterSeconds ?? retryAfter(error)
            setRemaining(seconds)
            setCooldownUntil(Date.now() + seconds * 1000)
            void devices.refetch()
        },
    })

    useEffect(() => {
        if (!cooldownUntil) return
        const update = () => {
            const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
            setRemaining(seconds)
            if (seconds === 0) setCooldownUntil(0)
        }
        const timer = window.setInterval(update, 1000)
        return () => window.clearInterval(timer)
    }, [cooldownUntil])

    const errorCode = mutation.error instanceof ApiError ? mutation.error.code : null
    const errorKey = errorCode === 'device-not-found' ? 'deviceMissing'
        : errorCode === 'push-test-unavailable' ? 'unavailable'
        : errorCode === 'push-test-rate-limited' ? 'rateLimited'
        : 'failed'

    return (
        <div className="border-t border-[var(--app-divider)] px-3 py-3">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{t('settings.pushTest.title')}</h3>
                <Button type="button" variant="outline" size="sm" disabled={devices.isFetching} onClick={() => void devices.refetch()}>
                    {t('settings.pushTest.refresh')}
                </Button>
            </div>
            {devices.isPending ? <p role="status" className="text-sm text-[var(--app-hint)]">{t('settings.pushTest.loading')}</p> : null}
            {devices.isError ? <p role="alert" className="text-sm text-[var(--app-hint)]">{t('settings.pushTest.loadFailed')}</p> : null}
            {devices.data?.devices.length === 0 ? <p className="text-sm text-[var(--app-hint)]">{t('settings.pushTest.empty')}</p> : null}
            <ul className="divide-y divide-[var(--app-divider)]">
                {devices.data?.devices.map(device => (
                    <li key={`${device.platform}:${device.deviceId}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0 flex-1 basis-40">
                            <div className="text-sm font-medium">{platformNames[device.platform] ?? device.platform}</div>
                            <div className="break-all font-mono text-xs text-[var(--app-hint)]">{device.deviceId}</div>
                            <div className="text-xs text-[var(--app-hint)]">
                                {t('settings.pushTest.updated', { date: new Date(device.updatedAt).toLocaleString(locale) })}
                            </div>
                            {!device.testable ? <div className="text-xs text-[var(--app-hint)]">{t(device.enabled ? 'settings.pushTest.unsupported' : 'settings.pushTest.disabled')}</div> : null}
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 gap-2"
                            title={t('settings.pushTest.send')}
                            aria-label={t('settings.pushTest.sendTo', { device: `${platformNames[device.platform] ?? device.platform} ${device.deviceId}` })}
                            disabled={!device.testable || mutation.isPending || remaining > 0}
                            onClick={() => mutation.mutate({ deviceId: device.deviceId, platform: device.platform })}
                        >
                            <ShareIcon className="h-4 w-4" />
                            {t('settings.pushTest.send')}
                        </Button>
                    </li>
                ))}
            </ul>
            <div role="status" aria-live="polite" className="space-y-1 text-sm text-[var(--app-hint)]">
                {mutation.isPending ? <p>{t('settings.pushTest.sending')}</p> : null}
                {mutation.isSuccess ? <p>{t('settings.pushTest.accepted')}</p> : null}
                {mutation.isError ? <p>{t(`settings.pushTest.${errorKey}`)}</p> : null}
                {remaining > 0 ? <p>{t('settings.pushTest.cooldown', { seconds: remaining })}</p> : null}
            </div>
        </div>
    )
}

export function NativePushTests() {
    const { baseUrl, token } = useAppContext()
    return <DeviceTests key={JSON.stringify([baseUrl, token])} />
}
