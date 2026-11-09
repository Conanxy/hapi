import { describe, expect, it, vi } from 'vitest'
import type { Attachment, AttachmentAdapter, PendingAttachment } from '@assistant-ui/react'
import { markSendRecoveryFailed } from '@/lib/send-recovery'
import { consumePreparedComposerSend, guardRecoveryAttachmentPreparation, previewComposerMessage, type PreparedComposerSend } from './composer-send-recovery'

vi.mock('@/lib/send-recovery', () => ({
    markSendRecoveryFailed: vi.fn(async () => {}),
}))

describe('composer send recovery preparation', () => {
    it('matches asynchronously prepared attachments to the correct send', () => {
        const pending: PreparedComposerSend[] = [
            { localId: 'first', text: 'same text', attachmentIds: ['a'], intent: 'queue', scheduledAt: null, draftRevision: 1 },
            { localId: 'second', text: 'same text', attachmentIds: ['b'], intent: 'default', scheduledAt: 42, draftRevision: 2 },
        ]

        expect(consumePreparedComposerSend(pending, 'same text', ['b'])?.localId).toBe('second')
        expect(consumePreparedComposerSend(pending, 'same text', ['a'])?.localId).toBe('first')
        expect(pending).toEqual([])
    })

    it('counts the attachment preview that will be included in the message JSON', () => {
        const file = new File(['document'], 'notes.txt', { type: 'text/plain' })
        const pending = {
            id: 'file-1',
            type: 'file',
            name: file.name,
            contentType: file.type,
            file,
            path: '/tmp/notes.txt',
            previewUrl: 'data:text/plain;base64,ZG9jdW1lbnQ=',
            status: { type: 'requires-action', reason: 'composer-send' },
        } as Attachment

        expect(previewComposerMessage(' hello ', [pending])).toEqual({
            text: 'hello',
            attachments: [{
                id: 'file-1',
                filename: 'notes.txt',
                mimeType: 'text/plain',
                size: 8,
                path: '/tmp/notes.txt',
                previewUrl: 'data:text/plain;base64,ZG9jdW1lbnQ=',
            }],
        })
    })

    it('matches the original send when an attachment is removed during preparation', () => {
        const pending: PreparedComposerSend[] = [{
            localId: 'first', text: 'hello', attachmentIds: ['a', 'b'],
            intent: 'default', scheduledAt: null, draftRevision: 1,
        }]
        expect(consumePreparedComposerSend(pending, 'hello', ['a'])?.localId).toBe('first')
    })

    it('makes the backup recoverable when attachment preparation fails', async () => {
        const pending = { current: [{
            localId: 'failed', text: 'hello', attachmentIds: ['file'],
            intent: 'default' as const, scheduledAt: null, draftRevision: 1,
        }] }
        const adapter: AttachmentAdapter = {
            accept: '*',
            async *add() {},
            async remove() {},
            async send() { throw new Error('attachment preparation failed') },
        }
        const guarded = guardRecoveryAttachmentPreparation(adapter, pending)

        await expect(guarded.send({ id: 'file' } as PendingAttachment)).rejects.toThrow('attachment preparation failed')
        expect(markSendRecoveryFailed).toHaveBeenCalledWith('failed', 'not_sent')
        expect(pending.current).toEqual([])
    })
})
