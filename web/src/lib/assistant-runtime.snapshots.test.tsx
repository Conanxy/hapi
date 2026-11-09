import { StrictMode, useRef, useSyncExternalStore } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from '@assistant-ui/react'
import type { PendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'
import type { Session } from '@/types/api'
import { useHappyRuntime } from './assistant-runtime'
import type { PreparedComposerSend } from './composer-send-recovery'
import { useComposerDraft } from '@/hooks/useComposerDraft'
import { clearDraft, getDraft, getDraftRevision, saveDraft } from '@/lib/composer-drafts'
import { clearDraftsAfterSend } from '@/lib/clearDraftsAfterSend'

describe('assistant-ui composer snapshots', () => {
    it('keeps snapshots stable and updates running state without a composer edit', async () => {
        const onSendMessage = vi.fn()
        const onAbort = vi.fn(async () => {})
        const session = { id: 'snapshot-test', active: true, thinking: false } as Session
        const { result, rerender } = renderHook(({ isRunning }) => {
            const runtime = useHappyRuntime({
                session,
                blocks: [],
                messagesVersion: 0,
                historyVersion: 0,
                isSending: false,
                isRunning,
                onSendMessage,
                onAbort,
            })
            const composer = runtime.thread.composer
            const snapshot = useSyncExternalStore(composer.subscribe, composer.getState)
            return { composer, snapshot }
        }, { initialProps: { isRunning: false }, wrapper: StrictMode })

        expect(result.current.snapshot.canCancel).toBe(false)
        expect(result.current.composer.getState()).toBe(result.current.snapshot)

        // Dictation and draft restoration both write through setText.
        act(() => result.current.composer.setText('dictated words'))
        expect(result.current.snapshot.text).toBe('dictated words')
        expect(result.current.composer.getState()).toBe(result.current.snapshot)

        rerender({ isRunning: true })
        expect(result.current.snapshot.canCancel).toBe(true)
        expect(result.current.snapshot.text).toBe('dictated words')
        rerender({ isRunning: false })
        expect(result.current.snapshot.canCancel).toBe(false)

        await act(async () => result.current.composer.send())
        expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('dictated words', undefined, null, 'default')
        expect(result.current.snapshot.text).toBe('')
        expect(result.current.composer.getState()).toBe(result.current.snapshot)
    })

    it('sends a custom relative schedule from the actual send time', async () => {
        const onSendMessage = vi.fn()
        const session = { id: 'scheduled-test', active: true, thinking: false } as Session
        const pendingScheduleRef: { current: PendingSchedule | null } = {
            current: { type: 'relative', minutes: 15 },
        }
        const { result } = renderHook(() => useHappyRuntime({
            session,
            blocks: [],
            messagesVersion: 0,
            historyVersion: 0,
            isSending: false,
            isRunning: false,
            onSendMessage,
            onAbort: vi.fn(async () => {}),
            pendingScheduleRef,
        }))
        act(() => result.current.thread.composer.setText('send later'))

        const sendNow = 1_700_000_000_000
        const clock = vi.spyOn(Date, 'now').mockReturnValue(sendNow)
        try {
            await act(async () => result.current.thread.composer.send())
            expect(onSendMessage).toHaveBeenCalledExactlyOnceWith(
                'send later',
                undefined,
                sendNow + 15 * 60_000,
                'default',
            )
        } finally {
            clock.mockRestore()
        }
    })

    it('clears the submitted draft while preserving edits made after dispatch', async () => {
        const sessionId = 'snapshot-draft-guard'
        const session = { id: sessionId, active: true, thinking: false } as Session
        saveDraft(sessionId, 'first message')
        const { result, unmount } = renderHook(() => {
            const runtime = useHappyRuntime({
                session,
                blocks: [],
                messagesVersion: 0,
                historyVersion: 0,
                isSending: false,
                onSendMessage: vi.fn(),
                onAbort: vi.fn(async () => {}),
            })
            const composer = runtime.thread.composer
            const snapshot = useSyncExternalStore(composer.subscribe, composer.getState)
            const sentTextRef = useRef<{ sessionId: string; text: string } | null>(null)
            const hydration = useComposerDraft(
                sessionId, snapshot.text, [], true,
                (text) => composer.setText(text),
                async (file) => { await composer.addAttachment(file) },
                sentTextRef,
            )
            return { composer, snapshot, sentTextRef, hydration }
        })

        await waitFor(() => {
            expect(result.current.hydration.complete).toBe(true)
            expect(result.current.snapshot.text).toBe('first message')
        })
        const firstRevision = getDraftRevision(sessionId)
        result.current.sentTextRef.current = { sessionId, text: 'first message' }
        await act(async () => result.current.composer.send())
        clearDraftsAfterSend(sessionId, { sessionId, revision: firstRevision })
        expect(getDraft(sessionId)).toBe('')

        act(() => result.current.composer.setText('second message'))
        saveDraft(sessionId, 'second message')
        const secondRevision = getDraftRevision(sessionId)
        result.current.sentTextRef.current = { sessionId, text: 'second message' }
        await act(async () => result.current.composer.send())
        act(() => result.current.composer.setText('new draft'))
        clearDraftsAfterSend(sessionId, { sessionId, revision: secondRevision })
        unmount()
        expect(getDraft(sessionId)).toBe('new draft')
        clearDraft(sessionId)
    })

    it('keeps the prepared recovery id until asynchronous attachment preparation finishes', async () => {
        const onSendMessage = vi.fn()
        const preparedSendsRef = { current: [] as PreparedComposerSend[] }
        const finish = new Map<string, (attachment: CompleteAttachment) => void>()
        const attachmentAdapter: AttachmentAdapter = {
            accept: '*',
            async *add({ file }) {
                yield {
                    id: file.name,
                    name: file.name,
                    type: 'file',
                    contentType: file.type,
                    file,
                    status: { type: 'requires-action', reason: 'composer-send' },
                } as PendingAttachment
            },
            async remove() {},
            async send(attachment) {
                return await new Promise<CompleteAttachment>((resolve) => finish.set(attachment.id, resolve))
            },
        }
        const session = { id: 'recovery-test', active: true, thinking: false } as Session
        const { result } = renderHook(() => useHappyRuntime({
            session,
            blocks: [],
            messagesVersion: 0,
            historyVersion: 0,
            isSending: false,
            onSendMessage,
            onAbort: vi.fn(async () => {}),
            attachmentAdapter,
            preparedSendsRef,
        }))
        const composer = result.current.thread.composer
        const complete = (id: string): CompleteAttachment => ({
            id,
            name: id,
            type: 'file',
            contentType: 'text/plain',
            status: { type: 'complete' },
            content: [{
                type: 'text',
                text: JSON.stringify({
                    __attachmentMetadata: { id, filename: id, mimeType: 'text/plain', size: 1, path: `/${id}` },
                }),
            }],
        })
        const prepare = (id: string, localId: string) => preparedSendsRef.current.push({
            localId, text: 'same', attachmentIds: [id], intent: 'queue', scheduledAt: null,
            draftRevision: 4, scheduleRevision: 7,
        })

        await act(async () => { await composer.addAttachment(new File(['a'], 'first.txt', { type: 'text/plain' })) })
        act(() => { composer.setText('same') })
        act(() => { prepare('first.txt', 'local-first'); composer.send() })
        expect(onSendMessage).not.toHaveBeenCalled()
        await act(async () => { finish.get('first.txt')!(complete('first.txt')) })

        await act(async () => { await composer.addAttachment(new File(['b'], 'second.txt', { type: 'text/plain' })) })
        act(() => { composer.setText('same') })
        act(() => { prepare('second.txt', 'local-second'); composer.send() })
        await act(async () => { finish.get('second.txt')!(complete('second.txt')) })

        expect(onSendMessage.mock.calls.map((call) => call[4])).toEqual(['local-first', 'local-second'])
        expect(onSendMessage.mock.calls.map((call) => call[6])).toEqual([7, 7])
        expect(preparedSendsRef.current).toEqual([])
    })
})
