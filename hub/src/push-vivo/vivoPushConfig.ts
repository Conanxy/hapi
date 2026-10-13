export type VivoPushSettings = {
    vivoPushMode: string | null
    vivoAppId: string | null
    vivoAppKey: string | null
    vivoAppSecret: string | null
}

export type VivoPushConfig =
    | { mode: 'off'; reason: string }
    | { mode: 'test'; appId: number; appKey: string; appSecret: string }

/** Deliberately opt-in and test-only: unpublished apps have no production entitlement. */
export function resolveVivoPushConfig(settings: VivoPushSettings): VivoPushConfig {
    const mode = settings.vivoPushMode?.trim() ?? 'off'
    if (mode === 'off') return { mode: 'off', reason: 'disabled' }
    if (mode !== 'test') return { mode: 'off', reason: 'HAPI_VIVO_PUSH must be test or off' }

    const appId = settings.vivoAppId?.trim() ?? ''
    const appKey = settings.vivoAppKey?.trim()
    const appSecret = settings.vivoAppSecret?.trim()
    if (!/^[1-9]\d*$/.test(appId) || !Number.isSafeInteger(Number(appId)) || !appKey || !appSecret) {
        return { mode: 'off', reason: 'test mode requires VIVO_APP_ID, VIVO_APP_KEY and VIVO_APP_SECRET' }
    }
    return { mode: 'test', appId: Number(appId), appKey, appSecret }
}
