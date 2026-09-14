import { useCallback, useEffect, useState } from 'react'

export type ComposerEscapeBehavior = 'double' | 'single'

const STORAGE_KEY = 'hapi-composer-escape-behavior'
const CHANGE_EVENT = 'hapi-composer-escape-behavior-changed'

function parseBehavior(value: unknown): ComposerEscapeBehavior {
    return value === 'single' ? 'single' : 'double'
}

export function getInitialComposerEscapeBehavior(): ComposerEscapeBehavior {
    try {
        return parseBehavior(window.localStorage.getItem(STORAGE_KEY))
    } catch {
        return 'double'
    }
}

export function useComposerEscapeBehavior() {
    const [composerEscapeBehavior, setBehavior] = useState(getInitialComposerEscapeBehavior)

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY || event.key === null) {
                setBehavior(getInitialComposerEscapeBehavior())
            }
        }
        const onLocalChange = (event: Event) => {
            if (event instanceof CustomEvent) setBehavior(parseBehavior(event.detail))
        }
        window.addEventListener('storage', onStorage)
        window.addEventListener(CHANGE_EVENT, onLocalChange)
        return () => {
            window.removeEventListener('storage', onStorage)
            window.removeEventListener(CHANGE_EVENT, onLocalChange)
        }
    }, [])

    const setComposerEscapeBehavior = useCallback((behavior: ComposerEscapeBehavior) => {
        setBehavior(behavior)
        try {
            if (behavior === 'double') window.localStorage.removeItem(STORAGE_KEY)
            else window.localStorage.setItem(STORAGE_KEY, behavior)
        } catch {
            // Still synchronize mounted consumers when storage is unavailable.
        }
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: behavior }))
    }, [])

    return { composerEscapeBehavior, setComposerEscapeBehavior }
}
