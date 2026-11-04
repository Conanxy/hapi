import type { AttachmentAdapter, PendingAttachment } from '@assistant-ui/react'
import { SCRATCHLIST_ATTACHMENT_DEFAULT_LIMITS } from '@hapi/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAllowedScratchlistMime } from '../../../hub/src/config/scratchlistAttachmentLimits'
import { createAttachmentAdapter } from './attachmentAdapter'
import { getDraftAttachments, saveDraftAttachments } from './composer-attachment-drafts'
import { createScratchlistAttachmentAdapter } from './scratchlistAttachmentAdapter'
import { prepareScratchlistParkAttachments } from './scratchlistAttachmentFlow'
import { prepareScratchlistCompatibleImage } from './scratchlistImageCompression'

const MIB = 1024 * 1024

function image(type = 'image/png'): File {
    return new File([new Uint8Array(2 * MIB).fill(7)], 'image.png', { type, lastModified: 123 })
}

function encoder() {
    const decode = vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() }))
    vi.stubGlobal('createImageBitmap', decode)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({ drawImage: vi.fn() } as never)
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((callback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' })))
    return { decode, encode }
}

async function collect(adapter: AttachmentAdapter, file: File): Promise<PendingAttachment[]> {
    const states: PendingAttachment[] = []
    for await (const state of adapter.add({ file }) as AsyncIterable<PendingAttachment>) {
        states.push(state)
    }
    return states
}

describe('scratchlist-compatible image preparation', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal('indexedDB', undefined)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('preserves PNG in chat, through draft restoration, and when parked on a PNG-only hub', async () => {
        const { decode } = encoder()
        const limits = { ...SCRATCHLIST_ATTACHMENT_DEFAULT_LIMITS, allowedMimeTypes: ['image/png'] }
        const getScratchlistAttachmentLimits = vi.fn().mockResolvedValue({ limits })
        const uploadFile = vi.fn().mockResolvedValue({ success: true, path: '/uploads/image.png' })
        const uploadScratchlistAttachment = vi.fn(async (
            _sessionId: string,
            filename: string,
            _content: string,
            mimeType: string,
        ) => ({
            success: isAllowedScratchlistMime(mimeType, limits),
            attachment: {
                id: 'hub-image',
                filename,
                mimeType,
                size: 2 * MIB,
                path: 'hapi-hub:scratchlist/image',
            },
        }))
        const api = { getScratchlistAttachmentLimits, uploadFile, uploadScratchlistAttachment } as never
        const ready = (await collect(createAttachmentAdapter(api, 'session'), image())).at(-1)!

        expect(ready.status.type).toBe('requires-action')
        expect(ready.file).toMatchObject({ name: 'image.png', type: 'image/png', size: 2 * MIB })
        expect(uploadFile).toHaveBeenCalledWith('session', 'image.png', expect.any(String), 'image/png')

        saveDraftAttachments('png-only-session', [{
            id: ready.id,
            file: ready.file!,
            path: '/uploads/image.png',
        }])
        const [restored] = await getDraftAttachments('png-only-session')
        const parked = await prepareScratchlistParkAttachments(api, 'session', [{
            id: ready.id,
            name: restored!.name,
            file: restored,
            path: '/uploads/image.png',
        }])

        expect(parked[0]).toMatchObject({ filename: 'image.png', mimeType: 'image/png' })
        expect(uploadScratchlistAttachment).toHaveBeenCalledWith(
            'session', 'image.png', uploadFile.mock.calls[0]?.[2], 'image/png',
        )
        expect(getScratchlistAttachmentLimits).toHaveBeenCalledTimes(1)
        expect(decode).not.toHaveBeenCalled()
    })

    it('uploads the original PNG directly from scratchlist mode when JPEG is forbidden', async () => {
        const { decode } = encoder()
        const limits = { ...SCRATCHLIST_ATTACHMENT_DEFAULT_LIMITS, allowedMimeTypes: ['image/png'] }
        const uploadScratchlistAttachment = vi.fn(async (
            _sessionId: string,
            filename: string,
            _content: string,
            mimeType: string,
        ) => ({
            success: isAllowedScratchlistMime(mimeType, limits),
            attachment: { id: 'hub-image', filename, mimeType, size: 2 * MIB, path: 'hapi-hub:scratchlist/image' },
        }))
        const api = {
            getScratchlistAttachmentLimits: vi.fn().mockResolvedValue({ limits }),
            uploadScratchlistAttachment,
        } as never
        const ready = (await collect(createScratchlistAttachmentAdapter(api, 'session'), image())).at(-1)!

        expect(ready.status.type).toBe('requires-action')
        expect(ready.file).toMatchObject({ name: 'image.png', type: 'image/png' })
        expect(uploadScratchlistAttachment).toHaveBeenCalledWith('session', 'image.png', expect.any(String), 'image/png')
        expect(decode).not.toHaveBeenCalled()
    })

    it('preserves an unprepared PNG when migrating a chat attachment', async () => {
        const { decode } = encoder()
        const limits = { ...SCRATCHLIST_ATTACHMENT_DEFAULT_LIMITS, allowedMimeTypes: ['image/png'] }
        const uploadScratchlistAttachment = vi.fn().mockResolvedValue({
            success: true,
            attachment: { id: 'hub-image', filename: 'image.png', mimeType: 'image/png', path: 'hapi-hub:scratchlist/image' },
        })
        const api = {
            getScratchlistAttachmentLimits: vi.fn().mockResolvedValue({ limits }),
            uploadScratchlistAttachment,
        } as never

        const parked = await prepareScratchlistParkAttachments(api, 'session', [{
            id: 'image-1',
            name: 'image.png',
            file: image(),
            path: '/uploads/image.png',
        }])

        expect(parked[0]).toMatchObject({ filename: 'image.png', mimeType: 'image/png' })
        expect(uploadScratchlistAttachment).toHaveBeenCalledWith('session', 'image.png', expect.any(String), 'image/png')
        expect(decode).not.toHaveBeenCalled()
    })

    it('keeps JPEG compression when the hub permits it, case-insensitively', async () => {
        const { decode, encode } = encoder()
        const api = {
            getScratchlistAttachmentLimits: vi.fn().mockResolvedValue({
                limits: { ...SCRATCHLIST_ATTACHMENT_DEFAULT_LIMITS, allowedMimeTypes: ['IMAGE/JPEG', 'image/png'] },
            }),
        } as never

        const prepared = await prepareScratchlistCompatibleImage(api, 'session', image())

        expect(prepared).toMatchObject({ name: 'image.jpg', type: 'image/jpeg', size: 4 })
        expect(decode).toHaveBeenCalledOnce()
        expect(encode).toHaveBeenCalledOnce()
    })

    it.each(['offline', 'invalid'] as const)('keeps the original when limits are %s', async (failure) => {
        const { decode } = encoder()
        const getScratchlistAttachmentLimits = failure === 'offline'
            ? vi.fn().mockRejectedValue(new Error('offline'))
            : vi.fn().mockResolvedValue({ limits: { allowedMimeTypes: ['image/jpeg'] } })
        const original = image()

        const prepared = await prepareScratchlistCompatibleImage(
            { getScratchlistAttachmentLimits } as never, 'session', original,
        )

        expect(prepared).toBe(original)
        expect(prepared.type).toBe('image/png')
        expect(decode).not.toHaveBeenCalled()
    })

    it('does not fetch limits when compression cannot change the input MIME', async () => {
        const { decode } = encoder()
        const getScratchlistAttachmentLimits = vi.fn()
        const api = { getScratchlistAttachmentLimits } as never
        const jpeg = new File([new Uint8Array(2 * MIB)], 'photo.jpg', { type: 'image/jpeg' })
        const small = new File(['png'], 'small.png', { type: 'image/png' })

        expect((await prepareScratchlistCompatibleImage(api, 'session', jpeg)).type).toBe('image/jpeg')
        expect(await prepareScratchlistCompatibleImage(api, 'session', small)).toBe(small)
        expect(getScratchlistAttachmentLimits).not.toHaveBeenCalled()
        expect(decode).toHaveBeenCalledOnce()
    })
})
