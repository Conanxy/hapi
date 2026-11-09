import { clearDraft, getDraftRevision } from '@/lib/composer-drafts'
import { clearDraftAttachments } from '@/lib/composer-attachment-drafts'

function clearComposerDraft(sessionId: string): void {
    clearDraft(sessionId)
    clearDraftAttachments(sessionId)
}

/**
 * Only clear the submitted composer if it has not been edited since dispatch.
 * A resumed session may already contain a different draft, so it is not
 * cleared using the source composer's revision.
 */
export function clearDraftsAfterSend(
    sentSessionId: string,
    guard?: { sessionId: string; revision: number },
): void {
    if (!guard || guard.sessionId !== sentSessionId) return
    if (getDraftRevision(guard.sessionId) !== guard.revision) return
    clearComposerDraft(guard.sessionId)
}
