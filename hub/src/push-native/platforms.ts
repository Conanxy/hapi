/**
 * Registration catalog. New native providers register their wire platform
 * here, including encryption requirements and Android selection grouping.
 */
export const NATIVE_PUSH_PLATFORMS = {
    phone: { android: true, requiresKey: false },
    wear: { android: false, requiresKey: false },
    ios: { android: false, requiresKey: true },
    vivo: { android: true, requiresKey: true }
} as const

export type NativePushPlatform = keyof typeof NATIVE_PUSH_PLATFORMS
export const nativePushPlatforms = Object.keys(NATIVE_PUSH_PLATFORMS) as [NativePushPlatform, ...NativePushPlatform[]]
export const androidPhonePlatforms = nativePushPlatforms.filter(platform => NATIVE_PUSH_PLATFORMS[platform].android)
