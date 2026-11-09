import { describe, expect, it } from 'bun:test'
import { getPublicRequestBodyLimitBytes, HUB_REQUEST_BODY_LIMIT_BYTES } from './requestBodyLimits'

describe('public request body limit', () => {
    it('defaults to the hub request limit', () => {
        expect(getPublicRequestBodyLimitBytes({})).toBe(68 * 1024 * 1024)
    })

    it('advertises a smaller reverse-proxy limit when configured', () => {
        expect(getPublicRequestBodyLimitBytes({ HAPI_PUBLIC_REQUEST_BODY_LIMIT_BYTES: '1048576' })).toBe(1048576)
    })

    it('does not advertise a limit higher than the hub accepts', () => {
        expect(getPublicRequestBodyLimitBytes({
            HAPI_PUBLIC_REQUEST_BODY_LIMIT_BYTES: String(HUB_REQUEST_BODY_LIMIT_BYTES * 2)
        })).toBe(HUB_REQUEST_BODY_LIMIT_BYTES)
    })

    it('ignores invalid or non-positive limits', () => {
        for (const value of ['0', '-1', '1.5', '20mb', '']) {
            expect(getPublicRequestBodyLimitBytes({ HAPI_PUBLIC_REQUEST_BODY_LIMIT_BYTES: value }))
                .toBe(HUB_REQUEST_BODY_LIMIT_BYTES)
        }
    })
})
