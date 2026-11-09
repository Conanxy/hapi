import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/composer-drafts', () => ({
    clearDraft: vi.fn(),
    getDraftRevision: vi.fn(),
}))
vi.mock('@/lib/composer-attachment-drafts', () => ({
    clearDraftAttachments: vi.fn(),
}))

import { clearDraft, getDraftRevision } from '@/lib/composer-drafts'
import { clearDraftAttachments } from '@/lib/composer-attachment-drafts'
import { clearDraftsAfterSend } from './clearDraftsAfterSend'

const mockClearDraft = vi.mocked(clearDraft)
const mockClearDraftAttachments = vi.mocked(clearDraftAttachments)

describe('clearDraftsAfterSend', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getDraftRevision).mockReturnValue(7)
    })

    it('clears an unchanged submitted draft', () => {
        clearDraftsAfterSend('session-A', { sessionId: 'session-A', revision: 7 })
        expect(mockClearDraft).toHaveBeenCalledWith('session-A')
        expect(mockClearDraft).toHaveBeenCalledTimes(1)
        expect(mockClearDraftAttachments).toHaveBeenCalledWith('session-A')
    })

    it('preserves a new draft created while the request is in flight', () => {
        clearDraftsAfterSend('session-A', { sessionId: 'session-A', revision: 6 })
        expect(mockClearDraft).not.toHaveBeenCalled()
        expect(mockClearDraftAttachments).not.toHaveBeenCalled()
    })

    it('preserves drafts in a different resumed session and for retry sends', () => {
        clearDraftsAfterSend('resolved-B', { sessionId: 'session-A', revision: 7 })
        clearDraftsAfterSend('session-A')
        expect(mockClearDraft).not.toHaveBeenCalled()
        expect(mockClearDraftAttachments).not.toHaveBeenCalled()
    })
})
