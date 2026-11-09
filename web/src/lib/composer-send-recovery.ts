import type { Attachment, AttachmentAdapter } from '@assistant-ui/react'
import type { AttachmentMetadata } from '@/types/api'
import type { ComposerSendIntent } from '@/lib/messageDelivery'
import { markSendRecoveryFailed } from '@/lib/send-recovery'

export type PreparedComposerSend = {
    localId: string
    text: string
    attachmentIds: string[]
    intent: ComposerSendIntent
    scheduledAt: number | null
    draftRevision: number
    scheduleRevision?: number
}

export function consumePreparedComposerSend(
    pending: PreparedComposerSend[],
    text: string,
    attachmentIds: readonly string[],
): PreparedComposerSend | undefined {
    const index = pending.findIndex((entry) => (
        entry.text === text.trim()
        && attachmentIds.length <= entry.attachmentIds.length
        && attachmentIds.every((id) => entry.attachmentIds.includes(id))
    ))
    if (index < 0) return undefined
    return pending.splice(index, 1)[0]
}

export function guardRecoveryAttachmentPreparation(
    adapter: AttachmentAdapter,
    pending: { current: PreparedComposerSend[] },
): AttachmentAdapter {
    return {
        ...adapter,
        async send(attachment) {
            try {
                return await adapter.send(attachment)
            } catch (error) {
                const index = pending.current.findIndex((entry) => entry.attachmentIds.includes(attachment.id))
                if (index >= 0) {
                    const [entry] = pending.current.splice(index, 1)
                    if (entry) void markSendRecoveryFailed(entry.localId, 'not_sent').catch(() => {})
                }
                throw error
            }
        },
    }
}

/**
 * Preview the content produced by the normal attachment adapter. The final
 * request is checked again after assistant-ui finishes preparing attachments.
 */
export function previewComposerMessage(
    text: string,
    attachments: readonly Attachment[],
): { text: string; attachments: AttachmentMetadata[] } {
    const metadata: AttachmentMetadata[] = []
    const otherTexts: string[] = []
    for (const attachment of attachments) {
        if (attachment.status.type === 'complete') {
            for (const part of attachment.content ?? []) {
                if (part.type !== 'text') continue
                try {
                    const parsed = JSON.parse(part.text) as { __attachmentMetadata?: AttachmentMetadata }
                    if (parsed?.__attachmentMetadata) {
                        metadata.push(parsed.__attachmentMetadata)
                        continue
                    }
                } catch {
                    // Non-metadata text is included in the message body.
                }
                otherTexts.push(part.text)
            }
            continue
        }

        const pending = attachment as typeof attachment & { path?: string; previewUrl?: string }
        if (!pending.path) continue
        metadata.push({
            id: attachment.id,
            filename: attachment.name,
            mimeType: attachment.contentType ?? 'application/octet-stream',
            size: attachment.file?.size ?? 0,
            path: pending.path,
            previewUrl: pending.previewUrl,
        })
    }
    return {
        text: [otherTexts.join('\n'), text.trim()].filter(Boolean).join('\n\n').trim(),
        attachments: metadata,
    }
}
