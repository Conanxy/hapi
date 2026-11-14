import type { AttachmentAdapter, PendingAttachment, CompleteAttachment, Attachment } from '@assistant-ui/react'
import {
    DEFAULT_UPLOAD_CHUNK_BYTES,
    LEGACY_SINGLE_UPLOAD_MAX_BYTES,
    MAX_CONFIGURABLE_UPLOAD_BYTES,
    UPLOAD_CHUNK_MAX_BYTES
} from '@hapi/protocol/apiTypes'
import { ApiError, type ApiClient } from '@/api/client'
import type { AttachmentMetadata } from '@/types/api'
import { isImageMimeType } from '@/lib/fileAttachments'
import { randomId } from '@/lib/randomId'
import { getRestoredUploadMetadata } from '@/lib/composer-attachment-drafts'
import type { AttachmentDraftHandoff } from '@/lib/composer-draft-transfer'
import { prepareScratchlistCompatibleImage } from '@/lib/scratchlistImageCompression'

/** Client sanity ceiling matching the Hub/CLI max configurable byte limit. */
export const MAX_UPLOAD_BYTES = MAX_CONFIGURABLE_UPLOAD_BYTES
/** Files above 8 MiB stream in chunks instead of buffering Base64 in browser memory. */
export const CHUNKED_UPLOAD_THRESHOLD_BYTES = UPLOAD_CHUNK_MAX_BYTES
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024

type ActiveUploadEntry = {
    chunkController: AbortController
    uploadSessionId: string
    uploadId?: string
    abortSent?: boolean
    finalizing?: boolean
}

function isNonRetryableUploadError(error: unknown, code?: string): boolean {
    if (code === 'upload_too_large') {
        return true
    }
    return error instanceof ApiError && (error.status === 413 || error.code === 'upload_too_large')
}

function isUnsupportedChunkedUploadError(error: unknown, code?: string): boolean {
    if (code === 'rpc_target_missing') {
        return true
    }
    if (!(error instanceof ApiError)) {
        return false
    }
    return error.code === 'rpc_target_missing'
        || (error.status === 404 && error.code !== 'Session not found')
}

function getUploadErrorCode(error: unknown): 'file_too_large' | 'request_body_too_large' | undefined {
    if (error instanceof ApiError && (error.status === 413 || error.code === 'request_body_too_large')) {
        return 'request_body_too_large'
    }
    return undefined
}

type PendingUploadAttachment = PendingAttachment & {
    path?: string
    previewUrl?: string
    uploadSessionId?: string
    retryable?: boolean
    errorCode?: 'file_too_large' | 'request_body_too_large'
}

export function createAttachmentAdapter(
    api: ApiClient,
    sessionId: string,
    resolveSessionId?: () => Promise<string>,
    // Always hand off after resume merges into a new session id, even when
    // the pick is cancelled, so the caller can navigate off a deleted source.
    // Cancellation is re-checked at transfer save time via isCancelled().
    onSessionResolved?: (sessionId: string, pending: AttachmentDraftHandoff) => Promise<void>,
): AttachmentAdapter {
    const cancelledAttachmentIds = new Set<string>()
    const activeUploads = new Map<string, ActiveUploadEntry>()

    const deleteUpload = async (path?: string, uploadSessionId = sessionId) => {
        if (!path) return
        try {
            await api.deleteUploadFile(uploadSessionId, path)
        } catch {
            // Best effort cleanup.
        }
    }

    const abortActiveChunkedUpload = (entry: ActiveUploadEntry | undefined) => {
        if (!entry || entry.abortSent || !entry.uploadId) {
            return
        }
        entry.abortSent = true
        void api.abortChunkedUpload(entry.uploadSessionId, entry.uploadId).catch(() => {})
    }

    return {
        // assistant-ui uses the exact "*" sentinel for an allow-all adapter.
        accept: '*',

        async *add({ file }): AsyncGenerator<PendingAttachment> {
            const restored = getRestoredUploadMetadata(file)
            if (!resolveSessionId && restored?.path) {
                yield {
                    id: restored.id,
                    type: 'file',
                    name: file.name,
                    contentType: file.type || 'application/octet-stream',
                    file,
                    status: { type: 'requires-action', reason: 'composer-send' },
                    path: restored.path,
                    previewUrl: restored.previewUrl,
                    uploadSessionId: restored.uploadSessionId,
                } as PendingUploadAttachment
                return
            }

            const id = restored?.id ?? randomId()
            let preparedFile = file
            let activeEntry: ActiveUploadEntry | undefined
            let finalized = false

            const makeIncomplete = (
                retryable: boolean,
                errorCode?: 'file_too_large' | 'request_body_too_large'
            ): PendingUploadAttachment => ({
                id,
                type: 'file',
                name: preparedFile.name,
                contentType: preparedFile.type || 'application/octet-stream',
                file: preparedFile,
                status: { type: 'incomplete', reason: 'error' },
                ...(errorCode ? { errorCode } : {}),
                retryable,
            } as PendingUploadAttachment)

            try {
                // Compress picked images before any Base64 read or upload.
                preparedFile = await prepareScratchlistCompatibleImage(api, sessionId, file)
                const contentType = preparedFile.type || 'application/octet-stream'
                const name = preparedFile.name

                if (preparedFile.size > MAX_UPLOAD_BYTES) {
                    yield makeIncomplete(false, 'file_too_large')
                    return
                }

                let previewUrl: string | undefined
                if (isImageMimeType(contentType) && preparedFile.size <= MAX_PREVIEW_BYTES) {
                    try {
                        previewUrl = await fileToDataUrl(preparedFile)
                    } catch {
                        // Preview generation is optional; retry the read for the upload payload below.
                    }
                }

                yield {
                    id,
                    type: 'file',
                    name,
                    contentType,
                    file: preparedFile,
                    status: { type: 'running', reason: 'uploading', progress: 0 },
                    previewUrl
                } as PendingUploadAttachment

                if (cancelledAttachmentIds.has(id)) {
                    return
                }

                const uploadSessionId = resolveSessionId ? await resolveSessionId() : sessionId
                if (uploadSessionId !== sessionId && onSessionResolved) {
                    await onSessionResolved(uploadSessionId, {
                        id,
                        file: preparedFile,
                        previewUrl,
                        isCancelled: () => cancelledAttachmentIds.has(id),
                    })
                    return
                }
                if (cancelledAttachmentIds.has(id)) {
                    return
                }

                let useLegacySingleUpload = preparedFile.size <= CHUNKED_UPLOAD_THRESHOLD_BYTES
                if (!useLegacySingleUpload) {
                    const chunkController = new AbortController()
                    activeEntry = { chunkController, uploadSessionId }
                    activeUploads.set(id, activeEntry)

                    let initResult: Awaited<ReturnType<ApiClient['initChunkedUpload']>> | null = null
                    let chunkedUnsupported = typeof api.initChunkedUpload !== 'function'
                    try {
                        if (!chunkedUnsupported) {
                            initResult = await api.initChunkedUpload(
                                uploadSessionId,
                                { filename: name, size: preparedFile.size, mimeType: contentType }
                            )
                        }
                    } catch (error) {
                        if (cancelledAttachmentIds.has(id)) {
                            return
                        }
                        if (isUnsupportedChunkedUploadError(error)) {
                            chunkedUnsupported = true
                        } else {
                            throw error
                        }
                    }

                    if (initResult?.success && initResult.uploadId) {
                        activeEntry.uploadId = initResult.uploadId
                    }

                    if (cancelledAttachmentIds.has(id)) {
                        abortActiveChunkedUpload(activeEntry)
                        return
                    }

                    if (!chunkedUnsupported && initResult && !initResult.success) {
                        if (isUnsupportedChunkedUploadError(undefined, initResult.code)) {
                            chunkedUnsupported = true
                        } else {
                            yield makeIncomplete(!isNonRetryableUploadError(undefined, initResult.code))
                            return
                        }
                    }

                    if (chunkedUnsupported) {
                        activeUploads.delete(id)
                        activeEntry = undefined
                        if (preparedFile.size > LEGACY_SINGLE_UPLOAD_MAX_BYTES) {
                            yield makeIncomplete(false, 'file_too_large')
                            return
                        }
                        useLegacySingleUpload = true
                    } else if (!initResult?.uploadId) {
                        yield makeIncomplete(true)
                        return
                    } else {
                        const uploadId = initResult.uploadId
                        const chunkSize = Math.min(
                            Math.max(1, initResult.chunkSize ?? DEFAULT_UPLOAD_CHUNK_BYTES),
                            UPLOAD_CHUNK_MAX_BYTES
                        )
                        const totalChunks = Math.ceil(preparedFile.size / chunkSize)

                        for (let index = 0; index < totalChunks; index += 1) {
                            if (cancelledAttachmentIds.has(id)) {
                                abortActiveChunkedUpload(activeEntry)
                                return
                            }
                            const start = index * chunkSize
                            const end = Math.min(start + chunkSize, preparedFile.size)
                            const chunkRes = await api.uploadFileChunk(
                                uploadSessionId,
                                uploadId,
                                index,
                                preparedFile.slice(start, end),
                                { signal: chunkController.signal }
                            )
                            if (cancelledAttachmentIds.has(id)) {
                                abortActiveChunkedUpload(activeEntry)
                                return
                            }
                            if (!chunkRes.success) {
                                abortActiveChunkedUpload(activeEntry)
                                yield makeIncomplete(!isNonRetryableUploadError(undefined, chunkRes.code))
                                return
                            }
                            const progress = Math.min(99, Math.max(1, Math.round((end / preparedFile.size) * 95)))
                            yield {
                                id,
                                type: 'file',
                                name,
                                contentType,
                                file: preparedFile,
                                status: { type: 'running', reason: 'uploading', progress },
                                previewUrl
                            } as PendingUploadAttachment
                        }

                        activeEntry.finalizing = true
                        const finalResult = await api.finalizeChunkedUpload(uploadSessionId, uploadId)

                        if (cancelledAttachmentIds.has(id)) {
                            if (finalResult.success && finalResult.path) {
                                finalized = true
                                await deleteUpload(finalResult.path, uploadSessionId)
                            } else {
                                activeEntry.finalizing = false
                                abortActiveChunkedUpload(activeEntry)
                            }
                            return
                        }

                        if (!finalResult.success || !finalResult.path) {
                            activeEntry.finalizing = false
                            abortActiveChunkedUpload(activeEntry)
                            yield makeIncomplete(!isNonRetryableUploadError(undefined, finalResult.code))
                            return
                        }

                        finalized = true
                        yield {
                            id,
                            type: 'file',
                            name,
                            contentType,
                            file: preparedFile,
                            status: { type: 'requires-action', reason: 'composer-send' },
                            path: finalResult.path,
                            previewUrl,
                            uploadSessionId,
                        } as PendingUploadAttachment
                        return
                    }
                }

                if (useLegacySingleUpload) {
                    // This is the only path that embeds file bytes in JSON.
                    const emptyBody = JSON.stringify({ filename: name, content: '', mimeType: contentType })
                    const requestBytes = new Blob([emptyBody]).size + Math.ceil(preparedFile.size / 3) * 4
                    if (typeof api.assertRequestBodySize === 'function') {
                        await api.assertRequestBodySize(requestBytes)
                    }

                    const content = previewUrl
                        ? base64FromDataUrl(previewUrl)
                        : await fileToBase64(preparedFile)

                    if (cancelledAttachmentIds.has(id)) {
                        return
                    }

                    yield {
                        id,
                        type: 'file',
                        name,
                        contentType,
                        file: preparedFile,
                        status: { type: 'running', reason: 'uploading', progress: 50 },
                        previewUrl
                    } as PendingUploadAttachment

                    const result = await api.uploadFile(uploadSessionId, name, content, contentType)
                    if (cancelledAttachmentIds.has(id)) {
                        if (result.success && result.path) {
                            await deleteUpload(result.path, uploadSessionId)
                        }
                        return
                    }

                    if (!result.success || !result.path) {
                        yield makeIncomplete(!isNonRetryableUploadError(undefined, result.code))
                        return
                    }

                    yield {
                        id,
                        type: 'file',
                        name,
                        contentType,
                        file: preparedFile,
                        status: { type: 'requires-action', reason: 'composer-send' },
                        path: result.path,
                        previewUrl,
                        uploadSessionId,
                    } as PendingUploadAttachment
                }
            } catch (error) {
                if (!finalized) {
                    abortActiveChunkedUpload(activeEntry)
                }
                if (cancelledAttachmentIds.has(id)) {
                    return
                }
                const errorCode = getUploadErrorCode(error)
                yield makeIncomplete(!isNonRetryableUploadError(error), errorCode)
            } finally {
                activeUploads.delete(id)
            }
        },

        async remove(attachment: Attachment): Promise<void> {
            cancelledAttachmentIds.add(attachment.id)
            const active = activeUploads.get(attachment.id)
            if (active) {
                active.chunkController.abort()
                if (!active.finalizing) {
                    abortActiveChunkedUpload(active)
                }
            }
            const path = (attachment as PendingUploadAttachment).path
            const uploadSessionId = (attachment as PendingUploadAttachment).uploadSessionId
            // The composer waits for remove() before dropping the chip. Remote
            // cleanup is best effort and must not delay that local update.
            void deleteUpload(path, uploadSessionId)
        },

        async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
            const pending = attachment as PendingUploadAttachment
            const path = pending.path
            const metadata: AttachmentMetadata | undefined = path ? {
                id: attachment.id,
                filename: attachment.name,
                mimeType: attachment.contentType ?? 'application/octet-stream',
                size: attachment.file?.size ?? 0,
                path,
                previewUrl: pending.previewUrl
            } : undefined

            return {
                id: attachment.id,
                type: attachment.type,
                name: attachment.name,
                contentType: attachment.contentType,
                status: { type: 'complete' },
                content: metadata ? [{ type: 'text', text: JSON.stringify({ __attachmentMetadata: metadata }) }] : []
            }
        }
    }
}

async function fileToBase64(file: File): Promise<string> {
    return base64FromDataUrl(await fileToDataUrl(file))
}

function base64FromDataUrl(dataUrl: string): string {
    const separatorIndex = dataUrl.indexOf(',')
    const base64 = separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : ''
    if (!base64) {
        throw new Error('Failed to read file')
    }
    return base64
}

async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            resolve(reader.result as string)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}
