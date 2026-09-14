import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getInitialComposerEscapeBehavior, useComposerEscapeBehavior } from './useComposerEscapeBehavior'

const STORAGE_KEY = 'hapi-composer-escape-behavior'

describe('useComposerEscapeBehavior', () => {
    beforeEach(() => window.localStorage.clear())

    it('defaults to double press for missing or invalid preferences', () => {
        expect(getInitialComposerEscapeBehavior()).toBe('double')
        window.localStorage.setItem(STORAGE_KEY, 'invalid')
        expect(getInitialComposerEscapeBehavior()).toBe('double')
        window.localStorage.setItem(STORAGE_KEY, 'single')
        expect(getInitialComposerEscapeBehavior()).toBe('single')
    })

    it('persists and synchronizes between mounted consumers', () => {
        const settings = renderHook(() => useComposerEscapeBehavior())
        const composer = renderHook(() => useComposerEscapeBehavior())
        act(() => settings.result.current.setComposerEscapeBehavior('single'))
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('single')
        expect(composer.result.current.composerEscapeBehavior).toBe('single')
        act(() => settings.result.current.setComposerEscapeBehavior('double'))
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
        expect(composer.result.current.composerEscapeBehavior).toBe('double')
    })

    it('refreshes on cross-tab storage changes and clearing storage', () => {
        const { result } = renderHook(() => useComposerEscapeBehavior())
        act(() => {
            window.localStorage.setItem(STORAGE_KEY, 'single')
            window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
        })
        expect(result.current.composerEscapeBehavior).toBe('single')
        act(() => {
            window.localStorage.clear()
            window.dispatchEvent(new StorageEvent('storage', { key: null }))
        })
        expect(result.current.composerEscapeBehavior).toBe('double')
    })

    it('keeps consumers synchronized when storage writes fail', () => {
        const settings = renderHook(() => useComposerEscapeBehavior())
        const composer = renderHook(() => useComposerEscapeBehavior())
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('Storage unavailable')
        })
        try {
            act(() => settings.result.current.setComposerEscapeBehavior('single'))
            expect(composer.result.current.composerEscapeBehavior).toBe('single')
        } finally {
            spy.mockRestore()
        }
    })
})
