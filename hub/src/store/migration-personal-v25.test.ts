import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

describe('personal fork v25 to v28 migration', () => {
    it('preserves encrypted vivo registrations, session metadata, and queued text-context messages', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-personal-v25-'))
        const dbPath = join(directory, 'hapi.db')
        const namespace = 'personal'
        const pushKey = Buffer.alloc(32, 7).toString('base64')
        const metadata = { path: '/tmp/project', host: 'test-machine', flavor: 'dsh' }
        const content = {
            role: 'user',
            content: { type: 'text', text: 'Review this context', attachments: [{
                id: 'context-file', filename: 'context.txt', mimeType: 'text/plain',
                size: 32, path: '/tmp/context.txt'
            }] }
        }
        try {
            const original = new Store(dbPath)
            let sessionId: string
            let messageId: string
            try {
                const session = original.sessions.getOrCreateSession('personal-session', metadata, null, namespace)
                sessionId = session.id
                messageId = original.messages.addMessage(sessionId, content, 'local-context').id
                original.fcm.upsertDevice(namespace, {
                    token: 'vivo-registration', platform: 'vivo', deviceId: 'vivo-phone', pushKey
                })
            } finally {
                original.close()
            }

            // Reconstruct the v25 schema by removing each artifact added in v26-v28.
            const legacy = new Database(dbPath)
            try {
                legacy.exec(`
                    DROP TABLE session_turns;
                    DROP INDEX idx_messages_immediate_queued;
                    DROP INDEX idx_messages_future_scheduled_queued;
                    PRAGMA user_version = 25;
                `)
            } finally {
                legacy.close()
            }

            const migrated = new Store(dbPath)
            try {
                expect(migrated.sessions.getSession(sessionId)?.metadata).toEqual(metadata)
                expect(migrated.messages.getMessages(sessionId)).toEqual([
                    expect.objectContaining({ id: messageId, localId: 'local-context', content })
                ])
                expect(migrated.fcm.getDevicesByNamespace(namespace, ['vivo'])).toEqual([
                    expect.objectContaining({ token: 'vivo-registration', deviceId: 'vivo-phone', pushKey })
                ])
                expect(migrated.fcm.getDevicesByNamespace('other', ['vivo'])).toEqual([])
                expect(migrated.turns.open(sessionId, namespace, 1_000, 'agent')).toBe(true)
                expect(migrated.turns.list(namespace, 0, 2_000)).toHaveLength(1)
            } finally {
                migrated.close()
            }
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
