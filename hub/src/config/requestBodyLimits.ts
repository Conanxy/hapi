export const HUB_REQUEST_BODY_LIMIT_BYTES = 68 * 1024 * 1024

/**
 * The proxy limit cannot be discovered from the hub. Deployments with a
 * smaller limit should advertise it explicitly so clients can check locally.
 */
export function getPublicRequestBodyLimitBytes(env: NodeJS.ProcessEnv = process.env): number {
    const configured = env.HAPI_PUBLIC_REQUEST_BODY_LIMIT_BYTES
    if (!configured || !/^\d+$/.test(configured)) return HUB_REQUEST_BODY_LIMIT_BYTES

    const bytes = Number(configured)
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return HUB_REQUEST_BODY_LIMIT_BYTES
    return Math.min(bytes, HUB_REQUEST_BODY_LIMIT_BYTES)
}
