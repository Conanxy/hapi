import { useCallback, useEffect, useState } from 'react'
import {
    getImageCompressionSettings,
    IMAGE_COMPRESSION_DEFAULTS,
    IMAGE_COMPRESSION_DIMENSION_OPTIONS,
    IMAGE_COMPRESSION_QUALITY_OPTIONS,
    IMAGE_COMPRESSION_STORAGE_KEY,
    IMAGE_COMPRESSION_THRESHOLD_OPTIONS,
    parseImageCompressionSettings,
    type ImageCompressionSettings,
} from '@/lib/imageCompression'

function saveSettings(settings: ImageCompressionSettings): void {
    try {
        if (
            settings.enabled === IMAGE_COMPRESSION_DEFAULTS.enabled
            && settings.thresholdBytes === IMAGE_COMPRESSION_DEFAULTS.thresholdBytes
            && settings.maxDimension === IMAGE_COMPRESSION_DEFAULTS.maxDimension
            && settings.jpegQuality === IMAGE_COMPRESSION_DEFAULTS.jpegQuality
        ) {
            localStorage.removeItem(IMAGE_COMPRESSION_STORAGE_KEY)
        } else {
            localStorage.setItem(IMAGE_COMPRESSION_STORAGE_KEY, JSON.stringify(settings))
        }
    } catch {
        // Ignore storage errors. The in-memory setting still applies.
    }
}

export function useImageCompressionSettings(): {
    settings: ImageCompressionSettings
    setSettings: (settings: ImageCompressionSettings) => void
} {
    const [settings, setSettingsState] = useState<ImageCompressionSettings>(getImageCompressionSettings)

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key === IMAGE_COMPRESSION_STORAGE_KEY) {
                try {
                    setSettingsState(parseImageCompressionSettings(
                        event.newValue ? JSON.parse(event.newValue) as Partial<ImageCompressionSettings> : null,
                    ))
                } catch {
                    setSettingsState(IMAGE_COMPRESSION_DEFAULTS)
                }
            }
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setSettings = useCallback((next: ImageCompressionSettings) => {
        setSettingsState(next)
        saveSettings(next)
    }, [])

    return { settings, setSettings }
}

export {
    IMAGE_COMPRESSION_DIMENSION_OPTIONS,
    IMAGE_COMPRESSION_QUALITY_OPTIONS,
    IMAGE_COMPRESSION_THRESHOLD_OPTIONS,
}
