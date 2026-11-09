import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function installIndexedDb() {
    const records = new Map<string, unknown>()
    const db = {
        objectStoreNames: { contains: () => true },
        close() {},
        transaction() {
            const tx: {
                oncomplete: null | (() => void)
                onerror: null | (() => void)
                onabort: null | (() => void)
                error: null
                objectStore: () => {
                    put: (value: { id: string }) => void
                    delete: (id: string) => void
                    get: (id: string) => { result: unknown; onsuccess: null | (() => void) }
                    getAll: () => { result: unknown[]; onsuccess: null | (() => void) }
                }
            } = {
                oncomplete: null,
                onerror: null,
                onabort: null,
                error: null,
                objectStore: () => ({
                    put: (value) => { records.set(value.id, value) },
                    delete: (id) => { records.delete(id) },
                    get: (id) => {
                        const request = { result: records.get(id), onsuccess: null as null | (() => void) }
                        queueMicrotask(() => request.onsuccess?.())
                        return request
                    },
                    getAll: () => {
                        const request = { result: [...records.values()], onsuccess: null as null | (() => void) }
                        queueMicrotask(() => request.onsuccess?.())
                        return request
                    },
                }),
            }
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()))
            return tx
        },
    }
    vi.stubGlobal('indexedDB', {
        open: () => {
            const request = {
                result: db,
                onsuccess: null as null | (() => void),
                onerror: null as null | (() => void),
                onupgradeneeded: null as null | (() => void),
            }
            queueMicrotask(() => request.onsuccess?.())
            return request
        },
    })
}

describe('send recovery', () => {
    beforeEach(() => {
        vi.resetModules()
        installIndexedDb()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('keeps message text and file bytes across a reload', async () => {
        const store = await import('./send-recovery')
        await store.saveSendRecovery({
            id: 'local-1',
            sessionId: 'session-1',
            text: 'unsent text',
            attachments: [{ id: 'file-1', file: new File(['document'], 'notes.txt', { type: 'text/plain' }) }],
            pendingSchedule: null,
        })

        vi.resetModules()
        const reloaded = await import('./send-recovery')
        const [recovery] = await reloaded.listSendRecoveries('session-1')
        expect(recovery).toMatchObject({ id: 'local-1', text: 'unsent text', status: 'unknown' })
        expect(recovery?.attachments[0]?.name).toBe('notes.txt')
        expect(recovery?.attachments[0]?.blob.size).toBe(8)
    })

    it('keeps the original recovery until an edited send succeeds', async () => {
        const store = await import('./send-recovery')
        await store.saveSendRecovery({
            id: 'original', sessionId: 's', text: 'first', attachments: [], pendingSchedule: null,
        })
        await store.saveSendRecovery({
            id: 'edited', sessionId: 's', text: 'edited', attachments: [], pendingSchedule: null,
            replacesId: 'original',
        })
        await store.markSendRecoveryFailed('edited', 'too_large')
        expect((await store.listSendRecoveries('s')).map((entry) => entry.id)).toEqual(['original', 'edited'])

        await store.completeSendRecovery('edited')
        expect(await store.listSendRecoveries('s')).toEqual([])
    })

    it('refuses to discard the composer when durable storage is unavailable', async () => {
        vi.stubGlobal('indexedDB', undefined)
        const store = await import('./send-recovery')
        await expect(store.saveSendRecovery({
            id: 'local-1', sessionId: 's', text: 'keep me', attachments: [], pendingSchedule: null,
        })).rejects.toThrow()
    })

    it('refuses to start a retry when durable storage is unavailable', async () => {
        vi.stubGlobal('indexedDB', undefined)
        const store = await import('./send-recovery')
        await expect(store.markSendRecoveryRetryStarted('local-1', 's')).rejects.toThrow()
    })

    it('moves failed backups and their attachments to the reopened session', async () => {
        const store = await import('./send-recovery')
        await store.saveSendRecovery({
            id: 'local-move',
            sessionId: 'old-session',
            text: 'keep this',
            attachments: [{ id: 'file', file: new File(['payload'], 'data.txt') }],
            pendingSchedule: null,
        })
        await store.markSendRecoveryFailed('local-move', 'too_large')
        await store.moveSendRecoveries('old-session', 'new-session')

        expect(await store.listSendRecoveries('old-session')).toEqual([])
        const [record] = await store.listSendRecoveries('new-session')
        expect(record).toMatchObject({ id: 'local-move', text: 'keep this', status: 'too_large' })
        expect(record?.attachments[0]?.blob.size).toBe(7)
    })

    it('deletes only the explicitly selected backup', async () => {
        const store = await import('./send-recovery')
        await store.saveSendRecovery({
            id: 'original', sessionId: 's', text: 'first', attachments: [], pendingSchedule: null,
        })
        await store.saveSendRecovery({
            id: 'edited', sessionId: 's', text: 'second', attachments: [], pendingSchedule: null,
            replacesId: 'original',
        })
        await store.discardSendRecovery('edited')

        expect((await store.listSendRecoveries('s')).map((entry) => entry.id)).toEqual(['original'])
    })

    it('marks a retry as unknown after reload until its result is confirmed', async () => {
        const store = await import('./send-recovery')
        await store.saveSendRecovery({
            id: 'retry', sessionId: 's', text: 'message', attachments: [], pendingSchedule: null,
        })
        await store.markSendRecoveryFailed('retry', 'too_large')
        await store.markSendRecoveryRetryStarted('retry', 's')
        expect((await store.listSendRecoveries('s'))[0]?.status).toBe('pending')

        vi.resetModules()
        const reloaded = await import('./send-recovery')
        expect((await reloaded.listSendRecoveries('s'))[0]?.status).toBe('unknown')
    })
})
