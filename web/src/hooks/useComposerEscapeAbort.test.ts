import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESCAPE_ABORT_CONFIRMATION_MS, useComposerEscapeAbort } from './useComposerEscapeAbort'
import type { ComposerEscapeBehavior } from './useComposerEscapeBehavior'

describe('useComposerEscapeAbort', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    function setup() {
        return renderHook((props: Parameters<typeof useComposerEscapeAbort>[0]) => useComposerEscapeAbort(props), {
            initialProps: { sessionId: 'one', enabled: true, behavior: 'double' as ComposerEscapeBehavior },
        })
    }

    it('prompts first and confirms on a second separate press, then clears confirmation', () => {
        const { result } = setup()
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
        expect(result.current.pending).toBe(true)
        act(() => expect(result.current.confirmEscape(true)).toBe(false))
        act(() => expect(result.current.confirmEscape(false)).toBe(true))
        expect(result.current.pending).toBe(false)
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
    })

    it('expires the toast and requires a new first press after two seconds', () => {
        const { result } = setup()
        act(() => result.current.confirmEscape(false))
        act(() => vi.advanceTimersByTime(ESCAPE_ABORT_CONFIRMATION_MS))
        expect(result.current.pending).toBe(false)
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
    })

    it('checks elapsed time even when the timer has not fired', () => {
        const { result } = setup()
        act(() => result.current.confirmEscape(false))
        vi.setSystemTime(Date.now() + ESCAPE_ABORT_CONFIRMATION_MS)
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
    })

    it('ignores a held key without arming confirmation', () => {
        const { result } = setup()
        act(() => expect(result.current.confirmEscape(true)).toBe(false))
        expect(result.current.pending).toBe(false)
    })

    it('supports single press while still ignoring repeat events', () => {
        const { result, rerender } = setup()
        rerender({ sessionId: 'one', enabled: true, behavior: 'single' })
        act(() => expect(result.current.confirmEscape(true)).toBe(false))
        act(() => expect(result.current.confirmEscape(false)).toBe(true))
        expect(result.current.pending).toBe(false)
    })

    it('resets on session changes, task end, and preference changes', () => {
        const { result, rerender } = setup()
        act(() => result.current.confirmEscape(false))
        rerender({ sessionId: 'two', enabled: true, behavior: 'double' })
        expect(result.current.pending).toBe(false)
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
        rerender({ sessionId: 'two', enabled: false, behavior: 'double' })
        expect(result.current.pending).toBe(false)
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
        rerender({ sessionId: 'two', enabled: true, behavior: 'double' })
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
        rerender({ sessionId: 'two', enabled: true, behavior: 'single' })
        expect(result.current.pending).toBe(false)
    })

    it('resets on input reset and window blur, and cleans up timers on unmount', () => {
        const { result, unmount } = setup()
        act(() => result.current.confirmEscape(false))
        act(() => result.current.reset())
        expect(result.current.pending).toBe(false)
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
        act(() => window.dispatchEvent(new Event('blur')))
        expect(result.current.pending).toBe(false)
        act(() => expect(result.current.confirmEscape(false)).toBe(false))
        unmount()
        expect(vi.getTimerCount()).toBe(0)
    })
})
