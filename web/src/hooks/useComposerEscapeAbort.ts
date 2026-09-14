import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerEscapeBehavior } from './useComposerEscapeBehavior'

export const ESCAPE_ABORT_CONFIRMATION_MS = 2000

export function useComposerEscapeAbort(input: {
    sessionId?: string
    enabled: boolean
    behavior: ComposerEscapeBehavior
}) {
    const { sessionId, enabled, behavior } = input
    const [pending, setPending] = useState(false)
    const deadlineRef = useRef<number | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const reset = useCallback(() => {
        deadlineRef.current = null
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = null
        setPending(false)
    }, [])

    useEffect(() => {
        reset()
        window.addEventListener('blur', reset)
        return () => {
            window.removeEventListener('blur', reset)
            if (timerRef.current !== null) clearTimeout(timerRef.current)
            deadlineRef.current = null
        }
    }, [sessionId, enabled, behavior, reset])

    const confirmEscape = useCallback((repeat: boolean): boolean => {
        if (!enabled || repeat) return false
        if (behavior === 'single') return true
        const now = Date.now()
        if (deadlineRef.current !== null && now < deadlineRef.current) {
            reset()
            return true
        }
        reset()
        deadlineRef.current = now + ESCAPE_ABORT_CONFIRMATION_MS
        setPending(true)
        timerRef.current = setTimeout(reset, ESCAPE_ABORT_CONFIRMATION_MS)
        return false
    }, [enabled, behavior, reset])

    return { pending, confirmEscape, reset }
}
