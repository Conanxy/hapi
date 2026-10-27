import {
    AssistantRuntimeProvider,
    type AssistantRuntime,
    type AttachmentAdapter,
    type ChatModelAdapter,
    useLocalRuntime,
} from '@assistant-ui/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { addTextContextAttachment, createTextContextFile } from '@/lib/textContext'
import { I18nProvider } from '@/lib/i18n-context'
import { HappyComposer } from './HappyComposer'

vi.mock('@/hooks/useComposerDraft', () => ({
    useComposerDraft: () => ({ complete: true, restoredAny: false, hasStoredAttachments: false }),
}))
vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ isTouch: false, haptic: { impact() {}, notification() {} } }),
}))
vi.mock('@/hooks/usePWAInstall', () => ({
    usePWAInstall: () => ({ isStandalone: false, isIOS: false }),
}))
vi.mock('@/components/AssistantChat/StatusBar', () => ({ StatusBar: () => null }))
vi.mock('@/components/AssistantChat/ComposerButtons', () => ({
    ComposerButtons: (props: { onTextContext: () => void }) => (
        <button type="button" onClick={props.onTextContext}>Text context</button>
    ),
    UnifiedButton: () => null,
    isComposerPrimaryFillHeight: () => true,
}))

const model: ChatModelAdapter = { async *run() {} }
const pastedText = 'long context\n'.repeat(300)

function setup(attachmentAdapter: AttachmentAdapter, initialText = '') {
    const runtimeRef: { current?: AssistantRuntime } = {}
    function Harness() {
        const runtime = useLocalRuntime(model, { adapters: { attachments: attachmentAdapter } })
        runtimeRef.current = runtime
        return (
            <AssistantRuntimeProvider runtime={runtime}>
                <I18nProvider><HappyComposer /></I18nProvider>
            </AssistantRuntimeProvider>
        )
    }
    render(<Harness />)
    const composer = runtimeRef.current!.thread.composer
    act(() => composer.setText(initialText))
    return composer
}

function paste(input: HTMLElement) {
    fireEvent.paste(input, {
        clipboardData: { files: [], getData: () => pastedText },
    })
}

describe('text context upload recovery with the real attachment runtime', () => {
    beforeEach(() => {
        localStorage.clear()
        localStorage.setItem('hapi.fue.v1.rich-composer-mentions', '1')
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        localStorage.clear()
        window.getSelection()?.removeAllRanges()
    })

    it.each(['rejected', 'missing-path', 'network'])(
        'keeps dialog fields on %s upload failure and removes the failed chip before retry',
        async (failure) => {
            const uploadFile = vi.fn()
                .mockImplementationOnce(async () => {
                    if (failure === 'network') throw new Error('offline')
                    return failure === 'missing-path'
                        ? { success: true }
                        : { success: false, error: 'upload rejected' }
                })
                .mockResolvedValue({ success: true, path: '/uploads/context.txt' })
            const composer = setup(createAttachmentAdapter({ uploadFile } as never, 'session-1'), 'request')

            fireEvent.click(screen.getByRole('button', { name: 'Text context' }))
            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'History' } })
            fireEvent.change(screen.getByLabelText('Context'), { target: { value: pastedText } })
            fireEvent.click(screen.getByRole('button', { name: 'Add as context' }))

            await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
            expect(screen.getByLabelText('Name')).toHaveValue('History')
            expect(screen.getByLabelText('Context')).toHaveValue(pastedText)
            expect(composer.getState().attachments).toHaveLength(0)
            expect(composer.getState().text).toBe('request')

            fireEvent.click(screen.getByRole('button', { name: 'Add as context' }))
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
            expect(uploadFile).toHaveBeenCalledTimes(2)
            expect(composer.getState().attachments).toHaveLength(1)
            expect(composer.getState().attachments[0]).toMatchObject({
                name: 'History.txt',
                status: { type: 'requires-action', reason: 'composer-send' },
                path: '/uploads/context.txt',
            })
            expect(composer.getState().text).toBe('request')
        },
    )

    it('restores failed long paste into the latest plain-text selection', async () => {
        localStorage.setItem('hapi.composer.richMentions', '0')
        let finishUpload!: (value: { success: boolean }) => void
        const uploadFile = vi.fn(() => new Promise((resolve) => { finishUpload = resolve }))
        const composer = setup(createAttachmentAdapter({ uploadFile } as never, 'session-1'), 'before after')
        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        input.setSelectionRange(7, 7)
        paste(input)
        await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce())

        fireEvent.change(input, { target: { value: 'new text here' } })
        input.setSelectionRange(4, 8)
        await act(async () => finishUpload({ success: false }))

        await waitFor(() => expect(input).toHaveValue(`new ${pastedText} here`))
        expect(composer.getState().text).toBe(`new ${pastedText} here`)
        expect(composer.getState().attachments).toHaveLength(0)
        await waitFor(() => expect(input.selectionStart).toBe(4 + pastedText.length))
    })

    it('restores failed rich paste without losing session references or adding spaces', async () => {
        const uploadFile = vi.fn().mockRejectedValue(new Error('offline'))
        const original = 'before [Related](/sessions/session-related) after'
        const composer = setup(createAttachmentAdapter({ uploadFile } as never, 'session-1'), original)
        const input = screen.getByTestId('rich-composer-input')
        const suffix = input.lastChild!
        const selection = window.getSelection()!
        const range = document.createRange()
        range.setStart(suffix, 1)
        range.setEnd(suffix, 6)
        selection.removeAllRanges()
        selection.addRange(range)
        paste(input)

        const restored = `before [Related](/sessions/session-related) ${pastedText}`
        await waitFor(() => expect(composer.getState().text).toBe(restored))
        expect(input.querySelector('[data-session-id="session-related"]')).toHaveTextContent('@Related')
        expect(composer.getState().text).not.toContain('\uFFFC')
        expect(composer.getState().attachments).toHaveLength(0)

        fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
        expect(composer.getState().text).toBe(original)
    })

    it('ignores unrelated failed attachments when context upload succeeds', async () => {
        const uploadFile = vi.fn()
            .mockResolvedValueOnce({ success: false })
            .mockResolvedValueOnce({ success: true, path: '/uploads/context.txt' })
        const composer = setup(createAttachmentAdapter({ uploadFile } as never, 'session-1'))
        await act(async () => {
            await composer.addAttachment(new File(['other'], 'other.txt'))
            await addTextContextAttachment(composer, createTextContextFile('context'), 'failed')
        })
        expect(composer.getState().attachments).toHaveLength(2)
        expect(composer.getState().attachments[0]?.status.type).toBe('incomplete')
        expect(composer.getState().attachments[1]?.status.type).toBe('requires-action')
        expect(composer.getState().text).toBe('')
    })

    it('keeps a successful long paste as a single attachment without inserting it into the body', async () => {
        localStorage.setItem('hapi.composer.richMentions', '0')
        const uploadFile = vi.fn().mockResolvedValue({ success: true, path: '/uploads/context.txt' })
        const composer = setup(createAttachmentAdapter({ uploadFile } as never, 'session-1'), 'request')
        await act(async () => paste(screen.getByRole('textbox')))
        await waitFor(() => expect(composer.getState().attachments[0]?.status.type).toBe('requires-action'))
        expect(composer.getState().attachments).toHaveLength(1)
        expect(composer.getState().text).toBe('request')
    })

    it('does not restore pasted text when its upload was cancelled', async () => {
        localStorage.setItem('hapi.composer.richMentions', '0')
        let finishUpload!: (value: { success: boolean; path: string }) => void
        const uploadFile = vi.fn(() => new Promise((resolve) => { finishUpload = resolve }))
        const deleteUploadFile = vi.fn().mockResolvedValue(undefined)
        const composer = setup(createAttachmentAdapter({ uploadFile, deleteUploadFile } as never, 'session-1'), 'request')
        paste(screen.getByRole('textbox'))
        await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce())
        await act(async () => {
            await composer.getAttachmentByIndex(0).remove()
            finishUpload({ success: true, path: '/uploads/cancelled.txt' })
        })
        await waitFor(() => expect(deleteUploadFile).toHaveBeenCalledOnce())
        expect(composer.getState().text).toBe('request')
        expect(composer.getState().attachments).toHaveLength(0)
    })

    it('does not restore pasted text after a successful cross-session handoff', async () => {
        localStorage.setItem('hapi.composer.richMentions', '0')
        const uploadFile = vi.fn()
        const onSessionResolved = vi.fn().mockResolvedValue(undefined)
        const composer = setup(createAttachmentAdapter(
            { uploadFile } as never,
            'session-1',
            async () => 'session-resumed',
            onSessionResolved,
        ), 'request')
        await act(async () => paste(screen.getByRole('textbox')))
        expect(onSessionResolved).toHaveBeenCalledOnce()
        expect(uploadFile).not.toHaveBeenCalled()
        expect(composer.getState().text).toBe('request')
    })
})
