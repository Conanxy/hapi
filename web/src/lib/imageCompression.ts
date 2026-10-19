export type ImageCompressionSettings = {
    enabled: boolean
    thresholdBytes: number
    maxDimension: number
    jpegQuality: number
}

export const IMAGE_COMPRESSION_STORAGE_KEY = 'hapi-image-compression'

export const IMAGE_COMPRESSION_DEFAULTS: ImageCompressionSettings = {
    enabled: true,
    thresholdBytes: 1 * 1024 * 1024,
    maxDimension: 2560,
    jpegQuality: 90,
}

export const IMAGE_COMPRESSION_THRESHOLD_OPTIONS = [
    { value: 512 * 1024, label: '512 KB' },
    { value: 1 * 1024 * 1024, label: '1 MB' },
    { value: 2 * 1024 * 1024, label: '2 MB' },
    { value: 4 * 1024 * 1024, label: '4 MB' },
] as const

export const IMAGE_COMPRESSION_DIMENSION_OPTIONS = [
    { value: 1280, label: '1280 px' },
    { value: 1920, label: '1920 px' },
    { value: 2560, label: '2560 px' },
    { value: 4096, label: '4096 px' },
] as const

export const IMAGE_COMPRESSION_QUALITY_OPTIONS = [
    { value: 70, label: '70' },
    { value: 80, label: '80' },
    { value: 85, label: '85' },
    { value: 90, label: '90' },
    { value: 95, label: '95' },
] as const

const RECOMPRESSIBLE_IMAGE_MIMES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
])

const thresholdValues: ReadonlySet<number> = new Set(IMAGE_COMPRESSION_THRESHOLD_OPTIONS.map((option) => option.value))
const dimensionValues: ReadonlySet<number> = new Set(IMAGE_COMPRESSION_DIMENSION_OPTIONS.map((option) => option.value))
const qualityValues: ReadonlySet<number> = new Set(IMAGE_COMPRESSION_QUALITY_OPTIONS.map((option) => option.value))

function isBrowser(): boolean {
    return typeof window !== 'undefined'
}

function readStoredSettings(): Partial<ImageCompressionSettings> | null {
    if (!isBrowser()) return null
    try {
        const raw = window.localStorage.getItem(IMAGE_COMPRESSION_STORAGE_KEY)
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return null
        return parsed as Partial<ImageCompressionSettings>
    } catch {
        return null
    }
}

export function parseImageCompressionSettings(
    stored: Partial<ImageCompressionSettings> | null | undefined,
): ImageCompressionSettings {
    return {
        enabled: typeof stored?.enabled === 'boolean'
            ? stored.enabled
            : IMAGE_COMPRESSION_DEFAULTS.enabled,
        thresholdBytes: typeof stored?.thresholdBytes === 'number'
            && thresholdValues.has(stored.thresholdBytes)
            ? stored.thresholdBytes
            : IMAGE_COMPRESSION_DEFAULTS.thresholdBytes,
        maxDimension: typeof stored?.maxDimension === 'number'
            && dimensionValues.has(stored.maxDimension)
            ? stored.maxDimension
            : IMAGE_COMPRESSION_DEFAULTS.maxDimension,
        jpegQuality: typeof stored?.jpegQuality === 'number'
            && qualityValues.has(stored.jpegQuality)
            ? stored.jpegQuality
            : IMAGE_COMPRESSION_DEFAULTS.jpegQuality,
    }
}

export function getImageCompressionSettings(): ImageCompressionSettings {
    return parseImageCompressionSettings(readStoredSettings())
}

export function isRecompressibleImageMimeType(mimeType: string): boolean {
    return RECOMPRESSIBLE_IMAGE_MIMES.has(mimeType.toLowerCase())
}

export function compressedImageFilename(original: string): string {
    const lastSlash = Math.max(original.lastIndexOf('/'), original.lastIndexOf('\\'))
    const nameStart = lastSlash + 1
    const dot = original.lastIndexOf('.')
    const stemEnd = dot > nameStart ? dot : original.length
    const stem = original.slice(nameStart, stemEnd) || 'image'
    return `${stem}.jpg`
}

const preparedFiles = new WeakSet<File>()

/** Mark bytes that came from an existing stored attachment as already prepared. */
export function markFileAsUploadReady(file: File): File {
    preparedFiles.add(file)
    return file
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality)
    })
}

async function decodeImage(file: File): Promise<{
    source: CanvasImageSource
    width: number
    height: number
    close: () => void
}> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                close: () => bitmap.close(),
            }
        } catch {
            // Fall through to the HTML image path for browsers without
            // ImageBitmap support for this format.
        }
    }

    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        throw new Error('Image decoding is unavailable')
    }

    const url = URL.createObjectURL(file)
    try {
        const image = new Image()
        image.decoding = 'async'
        image.src = url
        await image.decode()
        return {
            source: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            close: () => {},
        }
    } finally {
        URL.revokeObjectURL(url)
    }
}

async function encodeAsJpeg(file: File, settings: ImageCompressionSettings): Promise<Blob | null> {
    const decoded = await decodeImage(file)
    try {
        const longest = Math.max(decoded.width, decoded.height)
        const scale = longest > settings.maxDimension
            ? settings.maxDimension / longest
            : 1
        const width = Math.max(Math.round(decoded.width * scale), 1)
        const height = Math.max(Math.round(decoded.height * scale), 1)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return null
        context.drawImage(decoded.source, 0, 0, width, height)
        return await canvasBlob(canvas, settings.jpegQuality / 100)
    } finally {
        decoded.close()
    }
}

/**
 * Prepare a picked image before its first upload. Unsupported or undecodable
 * formats keep the original file so an image picker never becomes unusable.
 */
export async function prepareImageFileForUpload(
    file: File,
    settings: ImageCompressionSettings = getImageCompressionSettings(),
): Promise<File> {
    if (
        preparedFiles.has(file)
        || !settings.enabled
        || file.size <= settings.thresholdBytes
        || !isRecompressibleImageMimeType(file.type)
    ) {
        return file
    }

    try {
        const blob = await encodeAsJpeg(file, settings)
        if (!blob || blob.size >= file.size) return file
        const compressed = new File(
            [blob],
            compressedImageFilename(file.name),
            { type: 'image/jpeg', lastModified: file.lastModified },
        )
        preparedFiles.add(compressed)
        return compressed
    } catch {
        return file
    }
}
