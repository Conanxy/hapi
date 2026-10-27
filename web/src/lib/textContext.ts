import type { ComposerRuntime } from '@assistant-ui/react'

export const AUTO_TEXT_CONTEXT_CHARACTER_THRESHOLD = 3_000
export const AUTO_TEXT_CONTEXT_LINE_THRESHOLD = 60
export const USER_MESSAGE_COLLAPSED_LINE_LIMIT = 15

function splitTextLines(text: string): string[] {
    return text.split(/\r\n|\n|\r/)
}

export function countTextLines(text: string): number {
    return text.length === 0 ? 0 : splitTextLines(text).length
}

export function shouldConvertPastedTextToContext(
    text: string,
    thresholds: {
        characterThreshold?: number
        lineThreshold?: number
    } = {},
): boolean {
    const characterThreshold = thresholds.characterThreshold
        ?? AUTO_TEXT_CONTEXT_CHARACTER_THRESHOLD
    const lineThreshold = thresholds.lineThreshold
        ?? AUTO_TEXT_CONTEXT_LINE_THRESHOLD
    return text.length >= characterThreshold
        || countTextLines(text) > lineThreshold
}

export function getCollapsedUserMessage(
    text: string,
    lineLimit: number = USER_MESSAGE_COLLAPSED_LINE_LIMIT,
): { collapsible: boolean; preview: string } {
    const lines = splitTextLines(text)
    if (lines.length <= lineLimit) {
        return { collapsible: false, preview: text }
    }
    return {
        collapsible: true,
        preview: lines.slice(0, lineLimit).join('\n'),
    }
}

export function insertTextAtSelection(
    currentText: string,
    selection: { start: number; end: number },
    insertedText: string,
): { text: string; selection: { start: number; end: number } } {
    const start = Math.max(0, Math.min(selection.start, currentText.length))
    const end = Math.max(start, Math.min(selection.end, currentText.length))
    const text = `${currentText.slice(0, start)}${insertedText}${currentText.slice(end)}`
    const cursor = start + insertedText.length
    return {
        text,
        selection: { start: cursor, end: cursor },
    }
}

function padDatePart(value: number): string {
    return String(value).padStart(2, '0')
}

function defaultTextContextFilename(now: number): string {
    const date = new Date(now)
    return [
        'context-',
        date.getFullYear(),
        padDatePart(date.getMonth() + 1),
        padDatePart(date.getDate()),
        '-',
        padDatePart(date.getHours()),
        padDatePart(date.getMinutes()),
        padDatePart(date.getSeconds()),
        '.txt',
    ].join('')
}

export function buildTextContextFilename(requestedName: string, now: number = Date.now()): string {
    const sanitized = requestedName
        .trim()
        .replace(/[\\/:*?"<>|\r\n]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 120)
        .replace(/\.+$/g, '')

    if (!sanitized) {
        return defaultTextContextFilename(now)
    }
    return sanitized.toLowerCase().endsWith('.txt')
        ? sanitized
        : `${sanitized}.txt`
}

export function createTextContextFile(
    text: string,
    requestedName: string = '',
    now: number = Date.now(),
): File {
    return new File(
        [text],
        buildTextContextFilename(requestedName, now),
        {
            type: 'text/plain;charset=utf-8',
            lastModified: now,
        },
    )
}

/**
 * assistant-ui resolves addAttachment even for an incomplete upload. Read the
 * live runtime (the UI snapshot batches updates) and only inspect this File.
 */
export async function addTextContextAttachment(
    composer: ComposerRuntime | undefined,
    file: File,
    failureMessage: string,
): Promise<void> {
    if (!composer) throw new Error(failureMessage)
    const findAttachmentIndex = () => composer.getState().attachments.findIndex(
        (attachment) => attachment.file === file,
    )
    try {
        await composer.addAttachment(file)
        const attachment = composer.getState().attachments[findAttachmentIndex()]
        if (attachment?.status.type === 'incomplete' && attachment.status.reason === 'error') {
            throw new Error(failureMessage)
        }
        // A cancelled pick is absent; a successful cross-session handoff can
        // leave a running chip on the retiring composer. Neither is a failure.
    } catch (error) {
        const index = findAttachmentIndex()
        const attachment = composer.getState().attachments[index]
        if (attachment?.status.type === 'incomplete' && attachment.status.reason === 'error') {
            await composer.getAttachmentByIndex(index).remove()
        }
        throw error
    }
}
