import { ScratchlistAttachmentLimitsSchema } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import {
    getImageCompressionSettings,
    isFileUploadReady,
    isRecompressibleImageMimeType,
    markFileAsUploadReady,
    prepareImageFileForUpload,
} from '@/lib/imageCompression'

/**
 * A chat attachment can later be parked in the scratchlist. Avoid changing its
 * MIME type unless the hub accepts JPEG, and preserve it when limits are unknown.
 */
export async function prepareScratchlistCompatibleImage(
    api: ApiClient,
    sessionId: string,
    file: File,
): Promise<File> {
    const settings = getImageCompressionSettings()
    if (
        isFileUploadReady(file)
        || !settings.enabled
        || file.size <= settings.thresholdBytes
        || !isRecompressibleImageMimeType(file.type)
        || file.type.toLowerCase() === 'image/jpeg'
    ) {
        return await prepareImageFileForUpload(file, settings)
    }

    try {
        const response = await api.getScratchlistAttachmentLimits(sessionId)
        const limits = ScratchlistAttachmentLimitsSchema.safeParse(response.limits)
        if (!limits.success || !limits.data.allowedMimeTypes.some((mime) => mime.toLowerCase() === 'image/jpeg')) {
            return markFileAsUploadReady(file)
        }
    } catch {
        return markFileAsUploadReady(file)
    }
    return await prepareImageFileForUpload(file, settings)
}
