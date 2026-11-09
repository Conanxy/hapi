import type { PendingSchedule } from '@/components/AssistantChat/ScheduleTimePicker'
import type { AttachmentDraftInput } from '@/lib/composer-attachment-drafts'
import { isFileUploadReady, markFileAsUploadReady } from '@/lib/imageCompression'
import type { MessageDeliveryMode } from '@hapi/protocol'

const DB_NAME = 'hapi-send-recovery'
const STORE = 'messages'
const inFlight = new Set<string>()
const listeners = new Map<string, Set<() => void>>()

export type SendRecoveryStatus = 'pending' | 'too_large' | 'not_sent' | 'unknown'

export type SendRecoveryAttachment = {
    id: string
    name: string
    type: string
    lastModified: number
    blob: Blob
    uploadReady: boolean
}

export type SendRecovery = {
    id: string
    sessionId: string
    text: string
    attachments: SendRecoveryAttachment[]
    pendingSchedule: PendingSchedule | null
    deliveryMode: MessageDeliveryMode
    createdAt: number
    status: SendRecoveryStatus
    replacesId?: string
}

export type NewSendRecovery = {
    id: string
    sessionId: string
    text: string
    attachments: AttachmentDraftInput[]
    pendingSchedule: PendingSchedule | null
    deliveryMode?: MessageDeliveryMode
    replacesId?: string
}

function notify(sessionId: string): void {
    for (const listener of listeners.get(sessionId) ?? []) listener()
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is unavailable'))
            return
        }
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) {
                request.result.createObjectStore(STORE, { keyPath: 'id' })
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Failed to open recovery storage'))
        request.onblocked = () => reject(new Error('Recovery storage is blocked'))
    })
}

async function putRecovery(record: SendRecovery): Promise<void> {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite')
        transaction.objectStore(STORE).put(record)
        transaction.oncomplete = () => {
            db.close()
            resolve()
        }
        transaction.onerror = () => {
            db.close()
            reject(transaction.error ?? new Error('Failed to save message recovery'))
        }
        transaction.onabort = transaction.onerror
    })
}

export async function saveSendRecovery(input: NewSendRecovery): Promise<void> {
    const record: SendRecovery = {
        id: input.id,
        sessionId: input.sessionId,
        text: input.text,
        attachments: input.attachments.map(({ id, file }) => ({
            id,
            name: file.name,
            type: file.type,
            lastModified: file.lastModified,
            blob: file,
            uploadReady: isFileUploadReady(file),
        })),
        pendingSchedule: input.pendingSchedule,
        deliveryMode: input.deliveryMode ?? 'queue',
        createdAt: Date.now(),
        status: 'pending',
        replacesId: input.replacesId,
    }
    await putRecovery(record)
    inFlight.add(record.id)
    notify(record.sessionId)
}

export async function listSendRecoveries(sessionId: string): Promise<SendRecovery[]> {
    const db = await openDb()
    const records = await new Promise<SendRecovery[]>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readonly')
        const request = transaction.objectStore(STORE).getAll()
        transaction.oncomplete = () => {
            db.close()
            resolve(request.result as SendRecovery[])
        }
        transaction.onerror = () => {
            db.close()
            reject(transaction.error ?? new Error('Failed to list message recoveries'))
        }
        transaction.onabort = transaction.onerror
    })
    return records
        .filter((record) => record.sessionId === sessionId)
        .map((record) => {
            if (inFlight.has(record.id)) return { ...record, status: 'pending' as const }
            return record.status === 'pending' ? { ...record, status: 'unknown' as const } : record
        })
        .sort((a, b) => a.createdAt - b.createdAt)
}

async function updateRecoveryStatus(
    id: string,
    status: SendRecoveryStatus,
    sessionId?: string,
): Promise<boolean> {
    const db = await openDb()
    const affectedSessions = new Set<string>()
    let found = false
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        const request = store.get(id)
        request.onsuccess = () => {
            const record = request.result as SendRecovery | undefined
            if (!record) return
            found = true
            affectedSessions.add(record.sessionId)
            if (sessionId) record.sessionId = sessionId
            record.status = status
            affectedSessions.add(record.sessionId)
            store.put(record)
        }
        transaction.oncomplete = () => {
            db.close()
            resolve()
        }
        transaction.onerror = () => {
            db.close()
            reject(transaction.error ?? new Error('Failed to update message recovery'))
        }
        transaction.onabort = transaction.onerror
    })
    for (const affectedSessionId of affectedSessions) notify(affectedSessionId)
    return found
}

export async function markSendRecoveryFailed(
    id: string,
    status: Exclude<SendRecoveryStatus, 'pending'>,
    sessionId?: string,
): Promise<void> {
    inFlight.delete(id)
    await updateRecoveryStatus(id, status, sessionId)
}

export async function markSendRecoveryRetryStarted(id: string, sessionId: string): Promise<void> {
    inFlight.add(id)
    notify(sessionId)
    try {
        if (!await updateRecoveryStatus(id, 'pending', sessionId)) inFlight.delete(id)
    } catch (error) {
        inFlight.delete(id)
        notify(sessionId)
        throw error
    }
}

export async function discardSendRecovery(id: string): Promise<void> {
    const db = await openDb()
    let affectedSessionId: string | undefined
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        const request = store.get(id)
        request.onsuccess = () => {
            const record = request.result as SendRecovery | undefined
            if (!record) return
            affectedSessionId = record.sessionId
            store.delete(id)
        }
        transaction.oncomplete = () => {
            db.close()
            resolve()
        }
        transaction.onerror = () => {
            db.close()
            reject(transaction.error ?? new Error('Failed to remove message recovery'))
        }
        transaction.onabort = transaction.onerror
    })
    inFlight.delete(id)
    if (affectedSessionId) notify(affectedSessionId)
}

export async function moveSendRecoveries(sourceSessionId: string, targetSessionId: string): Promise<void> {
    if (sourceSessionId === targetSessionId) return
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        const request = store.getAll()
        request.onsuccess = () => {
            for (const record of request.result as SendRecovery[]) {
                if (record.sessionId === sourceSessionId) {
                    store.put({ ...record, sessionId: targetSessionId })
                }
            }
        }
        transaction.oncomplete = () => {
            db.close()
            resolve()
        }
        transaction.onerror = () => {
            db.close()
            reject(transaction.error ?? new Error('Failed to move message recoveries'))
        }
        transaction.onabort = transaction.onerror
    })
    notify(sourceSessionId)
    notify(targetSessionId)
}

export async function completeSendRecovery(id: string): Promise<void> {
    inFlight.delete(id)
    const db = await openDb()
    const affectedSessions = new Set<string>()
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        const seen = new Set<string>()
        const remove = (currentId: string) => {
            if (seen.has(currentId)) return
            seen.add(currentId)
            const request = store.get(currentId)
            request.onsuccess = () => {
                const record = request.result as SendRecovery | undefined
                if (!record) return
                affectedSessions.add(record.sessionId)
                inFlight.delete(currentId)
                store.delete(currentId)
                if (record.replacesId) remove(record.replacesId)
            }
        }
        remove(id)
        transaction.oncomplete = () => {
            db.close()
            resolve()
        }
        transaction.onerror = () => {
            db.close()
            reject(transaction.error ?? new Error('Failed to remove message recovery'))
        }
        transaction.onabort = transaction.onerror
    })
    for (const sessionId of affectedSessions) notify(sessionId)
}

export function recoveryAttachmentFile(attachment: SendRecoveryAttachment): File {
    const file = new File([attachment.blob], attachment.name, {
        type: attachment.type,
        lastModified: attachment.lastModified,
    })
    if (attachment.uploadReady) markFileAsUploadReady(file)
    return file
}

export function subscribeSendRecoveries(sessionId: string, listener: () => void): () => void {
    const subscriptions = listeners.get(sessionId) ?? new Set<() => void>()
    subscriptions.add(listener)
    listeners.set(sessionId, subscriptions)
    return () => {
        subscriptions.delete(listener)
        if (subscriptions.size === 0) listeners.delete(sessionId)
    }
}
