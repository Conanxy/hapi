import type { AttachmentAdapter, PendingAttachment } from '@assistant-ui/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MIB = 1024 * 1024

function pickedImage(): File {
    return new File([new Uint8Array(3 * MIB)], 'photo.png', {
        type: 'image/png',
        lastModified: 123,
    })
}

function mockEncoder() {
    const decode = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }))
    vi.stubGlobal('createImageBitmap', decode)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({ drawImage: vi.fn() } as never)
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation((callback) => {
            callback(new Blob([new Uint8Array(1.5 * MIB).fill(7)], { type: 'image/jpeg' }))
        })
    return { decode, encode }
}

async function collect(adapter: AttachmentAdapter, file: File): Promise<PendingAttachment[]> {
    const emitted: PendingAttachment[] = []
    for await (const attachment of adapter.add({ file }) as AsyncIterable<PendingAttachment>) {
        emitted.push(attachment)
    }
    return emitted
}

// Keep records outside the module cache to simulate a reload that loses all
// File WeakSets and draft caches but retains IndexedDB data.
function installDraftDb() {
    type Draft = { sessionId: string; files: { uploadReady?: boolean; blob: Blob }[] }
    const records = new Map<string, Draft>()
    function request<T>(result: T) {
        const pending = { result, onsuccess: null as null | (() => void) }
        queueMicrotask(() => pending.onsuccess?.())
        return pending
    }
    const db = {
        transaction() {
            const transaction = {
                objectStore: () => ({
                    put: (record: Draft) => records.set(record.sessionId, record),
                    delete: (id: string) => records.delete(id),
                    get: (id: string) => request(records.get(id)),
                    getAll: () => request([...records.values()]),
                }),
                oncomplete: null as null | (() => void),
                onerror: null as null | (() => void),
                onabort: null as null | (() => void),
            }
            queueMicrotask(() => queueMicrotask(() => transaction.oncomplete?.()))
            return transaction
        },
        close() {},
    }
    vi.stubGlobal('indexedDB', { open: () => request(db) })
    return records
}

describe('prepared image bytes across attachment drafts', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.stubGlobal('indexedDB', undefined)
        localStorage.clear()
        sessionStorage.clear()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('does not re-encode a compressed file after memory cloning or a resume transfer', async () => {
        const { decode, encode } = mockEncoder()
        const images = await import('./imageCompression')
        const drafts = await import('./composer-attachment-drafts')
        const transfer = await import('./composer-draft-transfer')
        const compressed = await images.prepareImageFileForUpload(pickedImage())
        expect(compressed.size).toBeGreaterThan(images.IMAGE_COMPRESSION_DEFAULTS.thresholdBytes)
        expect(compressed).toMatchObject({ name: 'photo.jpg', type: 'image/jpeg', lastModified: 123 })

        drafts.saveDraftAttachments('source', [{ id: 'image-1', file: compressed }])
        const [restored] = await drafts.getDraftAttachments('source')
        const [anotherCopy] = await drafts.getDraftAttachments('source')
        expect(restored).not.toBe(compressed)
        expect(anotherCopy).not.toBe(restored)
        expect(await images.prepareImageFileForUpload(restored!)).toBe(restored)
        expect(await images.prepareImageFileForUpload(anotherCopy!)).toBe(anotherCopy)

        await transfer.transferComposerDraft('source', 'resumed')
        const [resumed] = await drafts.getDraftAttachments('resumed')
        expect(resumed?.size).toBe(compressed.size)
        expect(await images.prepareImageFileForUpload(resumed!)).toBe(resumed)
        expect(await drafts.getDraftAttachments('source')).toEqual([])
        expect(decode).toHaveBeenCalledOnce()
        expect(encode).toHaveBeenCalledOnce()
    })

    it('persists the readiness bit for a pathless draft across a full module reload', async () => {
        const { decode } = mockEncoder()
        const records = installDraftDb()
        const images = await import('./imageCompression')
        const drafts = await import('./composer-attachment-drafts')
        const compressed = await images.prepareImageFileForUpload(pickedImage())
        drafts.saveDraftAttachments('persisted', [{ id: 'image-1', file: compressed }])
        await vi.waitFor(() => expect(records.get('persisted')?.files[0]?.uploadReady).toBe(true))

        vi.resetModules()
        const reloadedImages = await import('./imageCompression')
        const reloadedDrafts = await import('./composer-attachment-drafts')
        expect(reloadedImages.isFileUploadReady(compressed)).toBe(false)
        const [restored] = await reloadedDrafts.getDraftAttachments('persisted', { throwOnError: true })
        expect(restored?.size).toBe(compressed.size)
        expect(reloadedImages.isFileUploadReady(restored!)).toBe(true)
        expect(await reloadedImages.prepareImageFileForUpload(restored!)).toBe(restored)
        expect(decode).toHaveBeenCalledOnce()
    })

    it('still compresses a raw pending file saved before preparation', async () => {
        const { decode } = mockEncoder()
        const records = installDraftDb()
        const drafts = await import('./composer-attachment-drafts')
        drafts.saveDraftAttachments('raw', [{ id: 'image-raw', file: pickedImage() }])
        await vi.waitFor(() => expect(records.get('raw')?.files[0]?.uploadReady).toBe(false))

        vi.resetModules()
        const images = await import('./imageCompression')
        const reloadedDrafts = await import('./composer-attachment-drafts')
        const [restored] = await reloadedDrafts.getDraftAttachments('raw', { throwOnError: true })
        expect(images.isFileUploadReady(restored!)).toBe(false)
        const compressed = await images.prepareImageFileForUpload(restored!)
        expect(compressed).not.toBe(restored)
        expect(compressed.name).toBe('photo.jpg')
        expect(decode).toHaveBeenCalledOnce()
    })

    it('keeps prepared bytes when an upload throws and the draft is retried', async () => {
        const { decode } = mockEncoder()
        const { createAttachmentAdapter } = await import('./attachmentAdapter')
        const drafts = await import('./composer-attachment-drafts')
        const uploadFile = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ success: true, path: '/uploads/photo.jpg' })
        const adapter = createAttachmentAdapter({ uploadFile } as never, 'session')
        const failed = (await collect(adapter, pickedImage())).at(-1)!
        expect(failed.status).toEqual({ type: 'incomplete', reason: 'error' })
        expect(failed.file).toMatchObject({ name: 'photo.jpg', size: 1.5 * MIB })

        drafts.saveDraftAttachments('session', [{ id: failed.id, file: failed.file! }])
        const [restored] = await drafts.getDraftAttachments('session')
        const ready = (await collect(adapter, restored!)).at(-1)!
        expect(ready.status.type).toBe('requires-action')
        expect(ready.id).toBe(failed.id)
        expect(uploadFile.mock.calls[1]).toEqual(uploadFile.mock.calls[0])
        expect(decode).toHaveBeenCalledOnce()
    })

    it('hands prepared image bytes to a resumed composer without encoding again', async () => {
        const { decode } = mockEncoder()
        const drafts = await import('./composer-attachment-drafts')
        const transfer = await import('./composer-draft-transfer')
        const { createAttachmentAdapter } = await import('./attachmentAdapter')
        drafts.saveDraftAttachments('source', [{ id: 'image-1', file: pickedImage() }])
        const [pending] = await drafts.getDraftAttachments('source')
        const uploadFile = vi.fn().mockResolvedValue({ success: true, path: '/uploads/photo.jpg' })
        const inactive = createAttachmentAdapter(
            { uploadFile } as never,
            'source',
            async () => 'resumed',
            async (target, attachment) => transfer.transferComposerDraft('source', target, [attachment]),
        )
        await collect(inactive, pending!)
        expect(uploadFile).not.toHaveBeenCalled()
        expect(await drafts.getDraftAttachments('source')).toEqual([])

        const restored = await drafts.getDraftAttachments('resumed')
        expect(restored).toHaveLength(1)
        expect(restored[0]).toMatchObject({ name: 'photo.jpg', size: 1.5 * MIB })
        const resumed = createAttachmentAdapter({ uploadFile } as never, 'resumed')
        expect((await collect(resumed, restored[0]!)).at(-1)?.status.type).toBe('requires-action')
        expect(uploadFile).toHaveBeenCalledOnce()
        expect(decode).toHaveBeenCalledOnce()
    })

    it('keeps compressed chat bytes when a restored draft is parked in Scratchlist', async () => {
        const { decode } = mockEncoder()
        const images = await import('./imageCompression')
        const drafts = await import('./composer-attachment-drafts')
        const { prepareScratchlistParkAttachments } = await import('./scratchlistAttachmentFlow')
        const compressed = await images.prepareImageFileForUpload(pickedImage())
        drafts.saveDraftAttachments('session', [{
            id: 'image-1', file: compressed, path: '/uploads/photo.jpg',
        }])
        const [restored] = await drafts.getDraftAttachments('session')
        const uploadScratchlistAttachment = vi.fn().mockResolvedValue({
            success: true,
            attachment: { id: 'hub-image', path: 'hapi-hub:scratchlist/image' },
        })
        await prepareScratchlistParkAttachments({ uploadScratchlistAttachment } as never, 'session', [{
            id: 'image-1', name: restored!.name, file: restored, path: '/uploads/photo.jpg',
        }])
        expect(uploadScratchlistAttachment).toHaveBeenCalledWith(
            'session', 'photo.jpg', expect.any(String), 'image/jpeg',
        )
        expect(decode).toHaveBeenCalledOnce()
    })

    it.each(['disabled', 'small', 'larger-output', 'decode-error'] as const)(
        'retains the original preparation decision (%s) after draft restoration',
        async (reason) => {
            const { decode, encode } = mockEncoder()
            const images = await import('./imageCompression')
            const drafts = await import('./composer-attachment-drafts')
            const original = pickedImage()
            const settings = { ...images.IMAGE_COMPRESSION_DEFAULTS }
            if (reason === 'disabled') settings.enabled = false
            if (reason === 'small') settings.thresholdBytes = 4 * MIB
            if (reason === 'larger-output') {
                encode.mockImplementation((callback) => callback(new Blob([new Uint8Array(4 * MIB)])))
            }
            if (reason === 'decode-error') decode.mockRejectedValue(new Error('unsupported'))
            expect(await images.prepareImageFileForUpload(original, settings)).toBe(original)

            drafts.saveDraftAttachments('session', [{ id: 'original', file: original }])
            const [restored] = await drafts.getDraftAttachments('session')
            decode.mockClear()
            encode.mockClear()
            expect(await images.prepareImageFileForUpload(restored!)).toBe(restored)
            expect(restored).toMatchObject({ name: 'photo.png', size: 3 * MIB })
            expect(decode).not.toHaveBeenCalled()
            expect(encode).not.toHaveBeenCalled()
        },
    )
})
