import { afterEach, describe, expect, it, vi } from 'vitest'
import { RPC_METHODS } from '@hapi/protocol'
import { MessageQueue2 } from '@/utils/MessageQueue2'
import type { DshMode } from './types'

const FLASH = '["deepseek-official","deepseek-flash"]'
const PRO = '["deepseek-official","deepseek-v4-pro"]'
const HAPI_MCP_SERVERS = [{
    name: 'hapi',
    command: 'hapi',
    args: ['mcp', '--url', 'http://127.0.0.1:1/mcp'],
    env: []
}]

const harness = vi.hoisted(() => ({
    backend: null as Record<string, ReturnType<typeof vi.fn>> | null,
    newSessionConfig: null as unknown,
    prompts: [] as unknown[][],
    resumeError: null as Error | null,
    resumeSupported: true,
    modelOption: null as { id: string; category?: string; currentValue?: string } | null,
    modelsMetadata: null as {
        availableModels: Array<{ modelId: string; name?: string }>
        currentModelId: string | null
    } | null,
    setConfigOptionCalls: [] as Array<{ sessionId: string; configId: string; value: string }>,
    configOptionError: null as Error | null,
    // When set, newSession() parks on this promise — lets tests query the
    // catalog RPC while session/new is still pending.
    newSessionBlocker: null as null | Promise<void>,
    initializeBlocker: null as null | Promise<void>,
    bridgeBlocker: null as null | Promise<void>,
    promptBlocker: null as null | Promise<void>,
    closeBlocker: null as null | Promise<void>,
    configOptionBlocker: null as null | Promise<void>,
    closeError: null as Error | null,
    cancelError: null as Error | null,
    updates: [] as unknown[],
    stopMcpBridge: vi.fn()
}))

vi.mock('@/codex/utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: vi.fn(async () => {
        if (harness.bridgeBlocker) await harness.bridgeBlocker
        return {
            server: { url: 'http://127.0.0.1:1/mcp', stop: harness.stopMcpBridge },
            mcpServers: {
                hapi: {
                    command: 'hapi',
                    args: ['mcp', '--url', 'http://127.0.0.1:1/mcp'],
                    tools: {}
                }
            }
        }
    })
}))

vi.mock('./utils/dshBackend', () => ({
    createDshBackend: vi.fn(() => {
        const backend = {
            initialize: vi.fn(async () => {
                if (harness.initializeBlocker) await harness.initializeBlocker
            }),
            supportsSessionResume: vi.fn(() => harness.resumeSupported),
            newSession: vi.fn(async (config: unknown) => {
                harness.newSessionConfig = config
                if (harness.newSessionBlocker) {
                    await harness.newSessionBlocker
                }
                return 'dsh-session-1'
            }),
            resumeSession: vi.fn(async (config: { sessionId: string }) => {
                if (harness.resumeError) throw harness.resumeError
                return config.sessionId
            }),
            prompt: vi.fn(async (_sessionId: string, content: unknown[], onUpdate: (message: unknown) => void) => {
                harness.prompts.push(content)
                if (harness.promptBlocker) await harness.promptBlocker
                for (const update of harness.updates.length > 0
                    ? harness.updates
                    : [{ type: 'text', text: 'answer' }]) {
                    onUpdate(update)
                }
            }),
            cancelPrompt: vi.fn(async () => {
                if (harness.cancelError) throw harness.cancelError
            }),
            getConfigOptionByCategory: vi.fn(() => harness.modelOption),
            getSessionModelsMetadata: vi.fn(() => harness.modelsMetadata),
            setConfigOption: vi.fn(async (sessionId: string, configId: string, value: string) => {
                harness.setConfigOptionCalls.push({ sessionId, configId, value })
                if (harness.configOptionBlocker) await harness.configOptionBlocker
                if (harness.configOptionError) throw harness.configOptionError
                return {}
            }),
            closeSession: vi.fn(async () => {
                if (harness.closeBlocker) await harness.closeBlocker
                if (harness.closeError) throw harness.closeError
            }),
            onStderrError: vi.fn(),
            onPermissionRequest: vi.fn(),
            disconnect: vi.fn(async () => {})
        }
        harness.backend = backend
        return backend
    })
}))

vi.mock('@/modules/common/permission/AcpPermissionHandler', () => ({
    AcpPermissionHandler: class {
        async cancelAll(): Promise<void> {}
    }
}))

vi.mock('@/ui/ink/RemoteModeDisplay', () => ({ RemoteModeDisplay: () => null }))
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }))

import { DshRemoteLauncher } from './dshRemoteLauncher'

function createSessionWithBatches(batches: Array<[string, DshMode]>, sessionId: string | null = null) {
    const queue = new MessageQueue2<DshMode>((m) => JSON.stringify(m))
    for (const [message, mode] of batches) {
        queue.push(message, mode)
    }
    queue.close()

    const session = {
        path: '/tmp/dsh-test',
        logPath: '/tmp/dsh-test/hapi.log',
        client: { rpcHandlerManager: { registerHandler: vi.fn() } },
        queue,
        sessionId,
        getPermissionMode: () => 'default' as const,
        onThinkingChange: vi.fn(),
        onSessionFound: vi.fn((_sessionId: string) => {}),
        sendAgentMessage: vi.fn(),
        sendSessionEvent: vi.fn()
    }
    session.onSessionFound.mockImplementation((foundSessionId) => {
        session.sessionId = foundSessionId
    })
    return session
}

function createSession(mode?: DshMode, sessionId: string | null = null) {
    return createSessionWithBatches([['first', mode ?? {}]], sessionId)
}

describe('DshRemoteLauncher', () => {
    afterEach(() => {
        harness.backend = null
        harness.newSessionConfig = null
        harness.prompts = []
        harness.resumeError = null
        harness.resumeSupported = true
        harness.modelOption = null
        harness.modelsMetadata = null
        harness.setConfigOptionCalls = []
        harness.configOptionError = null
        harness.newSessionBlocker = null
        harness.initializeBlocker = null
        harness.bridgeBlocker = null
        harness.promptBlocker = null
        harness.closeBlocker = null
        harness.configOptionBlocker = null
        harness.closeError = null
        harness.cancelError = null
        harness.updates = []
        harness.stopMcpBridge.mockClear()
        vi.useRealTimers()
    })

    it('injects the HAPI MCP bridge, forwards prompts, and closes the ACP session', async () => {
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)

        await launcher.launch()

        expect(harness.backend?.newSession).toHaveBeenCalledWith({
            cwd: '/tmp/dsh-test',
            mcpServers: HAPI_MCP_SERVERS
        })
        expect(session.onSessionFound).toHaveBeenCalledWith('dsh-session-1')
        expect(harness.prompts).toEqual([[{ type: 'text', text: 'first' }]])
        expect(session.sendAgentMessage).toHaveBeenCalledWith({
            type: 'message',
            message: 'answer'
        })
        expect(session.sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' })
        expect(harness.backend?.closeSession).toHaveBeenCalledWith('dsh-session-1')
        expect(harness.backend?.disconnect).toHaveBeenCalled()
        expect(harness.stopMcpBridge).toHaveBeenCalled()
    })

    it('waits for the active prompt and ACP close before kill completes', async () => {
        let releasePrompt!: () => void
        let releaseClose!: () => void
        harness.promptBlocker = new Promise((resolve) => { releasePrompt = resolve })
        harness.closeBlocker = new Promise((resolve) => { releaseClose = resolve })
        const launcher = new DshRemoteLauncher(createSession() as never)
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.prompt).toHaveBeenCalledOnce())

        let stopped = false
        const killed = launcher.kill().then(() => { stopped = true })
        const killedAgain = launcher.kill()
        await vi.waitFor(() => expect(harness.backend?.cancelPrompt).toHaveBeenCalledWith('dsh-session-1'))
        expect(harness.backend?.closeSession).not.toHaveBeenCalled()

        releasePrompt()
        await vi.waitFor(() => expect(harness.backend?.closeSession).toHaveBeenCalledOnce())
        expect(stopped).toBe(false)
        releaseClose()
        await Promise.all([launched, killed, killedAgain])

        expect(harness.backend?.disconnect).toHaveBeenCalledOnce()
        expect(harness.stopMcpBridge).toHaveBeenCalledOnce()
    })

    it('does not report an abort when the session has already ended', async () => {
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)
        await launcher.launch()
        session.sendSessionEvent.mockClear()
        await launcher.kill()

        expect(session.sendSessionEvent).not.toHaveBeenCalled()
        expect(harness.backend?.cancelPrompt).not.toHaveBeenCalled()
    })

    it('waits for an already-started cleanup without aborting the completed session', async () => {
        let releaseClose!: () => void
        harness.closeBlocker = new Promise((resolve) => { releaseClose = resolve })
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.closeSession).toHaveBeenCalledOnce())
        session.sendSessionEvent.mockClear()
        const killed = launcher.kill()
        releaseClose()
        await Promise.all([launched, killed])

        expect(session.sendSessionEvent).not.toHaveBeenCalled()
        expect(harness.backend?.cancelPrompt).not.toHaveBeenCalled()
        expect(harness.backend?.disconnect).toHaveBeenCalledOnce()
    })

    it('closes a session created while shutdown was requested', async () => {
        let releaseNewSession!: () => void
        harness.newSessionBlocker = new Promise((resolve) => { releaseNewSession = resolve })
        const launcher = new DshRemoteLauncher(createSession() as never)
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.newSession).toHaveBeenCalledOnce())

        const killed = launcher.kill()
        releaseNewSession()
        await Promise.all([launched, killed])

        expect(harness.backend?.prompt).not.toHaveBeenCalled()
        expect(harness.backend?.closeSession).toHaveBeenCalledWith('dsh-session-1')
        expect(harness.backend?.disconnect).toHaveBeenCalledOnce()
    })

    it('forces cleanup when an active prompt does not finish after cancellation', async () => {
        let releasePrompt!: () => void
        harness.promptBlocker = new Promise((resolve) => { releasePrompt = resolve })
        const launcher = new DshRemoteLauncher(createSession() as never)
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.prompt).toHaveBeenCalledOnce())

        vi.useFakeTimers()
        const killed = launcher.kill()
        await vi.advanceTimersByTimeAsync(2_000)
        await killed
        expect(harness.backend?.closeSession).toHaveBeenCalledOnce()
        expect(harness.backend?.disconnect).toHaveBeenCalledOnce()
        expect(harness.stopMcpBridge).toHaveBeenCalledOnce()

        releasePrompt()
        await launched
        expect(harness.backend?.closeSession).toHaveBeenCalledOnce()
    })

    it('stops a bridge that finishes building after shutdown times out', async () => {
        let releaseBridge!: () => void
        harness.bridgeBlocker = new Promise((resolve) => { releaseBridge = resolve })
        const launcher = new DshRemoteLauncher(createSession() as never)
        const launched = launcher.launch()

        vi.useFakeTimers()
        const killed = launcher.kill()
        await vi.advanceTimersByTimeAsync(2_000)
        await killed
        releaseBridge()
        await launched

        expect(harness.backend).toBeNull()
        expect(harness.stopMcpBridge).toHaveBeenCalledOnce()
    })

    it.each(['resolve', 'reject'])('disconnects a backend whose initialization settles after shutdown: %s', async (result) => {
        let finishInitialize!: () => void
        let failInitialize!: (error: Error) => void
        harness.initializeBlocker = new Promise((resolve, reject) => {
            finishInitialize = resolve
            failInitialize = reject
        })
        const launcher = new DshRemoteLauncher(createSession() as never)
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.initialize).toHaveBeenCalledOnce())

        vi.useFakeTimers()
        const killed = launcher.kill()
        await vi.advanceTimersByTimeAsync(2_000)
        await killed
        expect(harness.backend?.disconnect).toHaveBeenCalledOnce()
        if (result === 'resolve') finishInitialize()
        else failInitialize(new Error('initialization failed'))
        await launched

        expect(harness.backend?.disconnect).toHaveBeenCalledTimes(2)
        expect(harness.backend?.newSession).not.toHaveBeenCalled()
        expect(harness.stopMcpBridge).toHaveBeenCalledOnce()
    })

    it('attempts to close a session that appears after forced cleanup', async () => {
        let releaseNewSession!: () => void
        harness.newSessionBlocker = new Promise((resolve) => { releaseNewSession = resolve })
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.newSession).toHaveBeenCalledOnce())

        vi.useFakeTimers()
        const killed = launcher.kill()
        await vi.advanceTimersByTimeAsync(2_000)
        await killed
        releaseNewSession()
        await launched

        expect(harness.backend?.closeSession).toHaveBeenCalledOnce()
        expect(harness.backend?.closeSession).toHaveBeenCalledWith('dsh-session-1')
        expect(session.onSessionFound).not.toHaveBeenCalled()
        expect(harness.backend?.prompt).not.toHaveBeenCalled()
    })

    it('disconnects and stops the bridge if session close fails', async () => {
        harness.closeError = new Error('close failed')
        const launcher = new DshRemoteLauncher(createSession() as never)
        await launcher.launch()

        expect(harness.backend?.closeSession).toHaveBeenCalledOnce()
        expect(harness.backend?.disconnect).toHaveBeenCalledOnce()
        expect(harness.stopMcpBridge).toHaveBeenCalledOnce()
    })

    it('continues shutdown if prompt cancellation fails', async () => {
        let releasePrompt!: () => void
        harness.promptBlocker = new Promise((resolve) => { releasePrompt = resolve })
        harness.cancelError = new Error('cancel failed')
        const launcher = new DshRemoteLauncher(createSession() as never)
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.prompt).toHaveBeenCalledOnce())
        const killed = launcher.kill()
        releasePrompt()
        await Promise.all([launched, killed])

        expect(harness.backend?.closeSession).toHaveBeenCalledOnce()
        expect(harness.backend?.disconnect).toHaveBeenCalledOnce()
    })

    it('does not start a prompt when shutdown occurs during model selection', async () => {
        let releaseSwitch!: () => void
        harness.configOptionBlocker = new Promise((resolve) => { releaseSwitch = resolve })
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        const launcher = new DshRemoteLauncher(createSession() as never, { model: PRO })
        const launched = launcher.launch()
        await vi.waitFor(() => expect(harness.backend?.setConfigOption).toHaveBeenCalledOnce())

        const killed = launcher.kill()
        releaseSwitch()
        await Promise.all([launched, killed])

        expect(harness.backend?.prompt).not.toHaveBeenCalled()
        expect(harness.backend?.closeSession).toHaveBeenCalledOnce()
    })

    it('keeps listening for messages after aborting an idle queue', async () => {
        const session = createSessionWithBatches([])
        session.queue = new MessageQueue2<DshMode>((mode) => JSON.stringify(mode))
        const launcher = new DshRemoteLauncher(session as never)
        const launched = launcher.launch()
        const registered = session.client.rpcHandlerManager.registerHandler
        await vi.waitFor(() => expect(registered.mock.calls.some(([method]) => method === RPC_METHODS.Abort)).toBe(true))
        const abort = registered.mock.calls.find(([method]) => method === RPC_METHODS.Abort)?.[1] as () => Promise<void>
        await abort()
        session.queue.push('after abort', {})
        await vi.waitFor(() => expect(harness.backend?.prompt).toHaveBeenCalledOnce())
        await launcher.kill()
        await launched
        expect(harness.prompts).toEqual([[{ type: 'text', text: 'after abort' }]])
    })

    it('forwards reasoning, tool, usage, and plan updates to the hub', async () => {
        harness.updates = [
            { type: 'reasoning', text: 'thinking' },
            { type: 'tool_call', id: 'tool-1', name: 'bash', input: { cmd: 'ls' }, status: 'in_progress' },
            { type: 'tool_result', id: 'tool-1', output: 'file.txt', status: 'completed' },
            { type: 'usage', inputTokens: 1, outputTokens: 2 },
            {
                type: 'plan',
                items: [{ content: 'step', priority: 'high', status: 'pending' }]
            }
        ]
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)

        await launcher.launch()

        expect(session.sendAgentMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'reasoning',
            'tool-call',
            'tool-call-result',
            'token_count',
            'plan'
        ])
    })

    it('resumes an existing DSH ACP session instead of creating a new one', async () => {
        const session = createSession(undefined, 'dsh-existing-1')
        const launcher = new DshRemoteLauncher(session as never)

        await launcher.launch()

        expect(harness.backend?.resumeSession).toHaveBeenCalledWith({
            sessionId: 'dsh-existing-1',
            cwd: '/tmp/dsh-test',
            mcpServers: HAPI_MCP_SERVERS
        })
        expect(harness.backend?.newSession).not.toHaveBeenCalled()
        expect(session.onSessionFound).toHaveBeenCalledWith('dsh-existing-1')
        expect(harness.backend?.closeSession).toHaveBeenCalledWith('dsh-existing-1')
    })

    it('falls back to a fresh DSH session when native resume fails', async () => {
        const session = createSession(undefined, 'dsh-existing-1')
        const launcher = new DshRemoteLauncher(session as never)
        harness.resumeError = new Error('method not found')

        await launcher.launch()

        expect(harness.backend?.resumeSession).toHaveBeenCalled()
        expect(harness.backend?.newSession).toHaveBeenCalledWith({ cwd: '/tmp/dsh-test', mcpServers: HAPI_MCP_SERVERS })
        expect(harness.backend?.closeSession).toHaveBeenCalledWith('dsh-session-1')
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'DSH resume failed; starting a new session.'
        })
    })

    it('falls back without probing session/resume when the server does not advertise it', async () => {
        const session = createSession(undefined, 'dsh-existing-1')
        const launcher = new DshRemoteLauncher(session as never)
        harness.resumeSupported = false

        await launcher.launch()

        expect(harness.backend?.resumeSession).not.toHaveBeenCalled()
        expect(harness.backend?.newSession).toHaveBeenCalledWith({ cwd: '/tmp/dsh-test', mcpServers: HAPI_MCP_SERVERS })
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'DSH resume failed; starting a new session.'
        })
    })

    it('discovers the current model from the model config option', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        const onConfigDiscovered = vi.fn()
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never, { onConfigDiscovered })

        await launcher.launch()

        // No override → no set_config_option call, only discovery.
        expect(harness.setConfigOptionCalls).toEqual([])
        expect(onConfigDiscovered).toHaveBeenCalledWith(FLASH)
    })

    it('applies a spawn model override through session/set_config_option', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        const onConfigDiscovered = vi.fn()
        const session = createSession({ model: PRO })
        const launcher = new DshRemoteLauncher(session as never, { model: PRO, onConfigDiscovered })

        await launcher.launch()

        expect(harness.setConfigOptionCalls).toEqual([{
            sessionId: 'dsh-session-1',
            configId: 'model',
            value: PRO
        }])
        expect(onConfigDiscovered).toHaveBeenCalledWith(PRO)
    })

    it('switches the model per-turn when the queued mode requests a different one', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        const session = createSession({ model: PRO })
        const launcher = new DshRemoteLauncher(session as never)

        await launcher.launch()

        expect(harness.setConfigOptionCalls).toEqual([{
            sessionId: 'dsh-session-1',
            configId: 'model',
            value: PRO
        }])
        // The prompt still ran after the switch.
        expect(harness.prompts).toEqual([[{ type: 'text', text: 'first' }]])
    })

    it('resets to the server default when Default is requested after a spawn-time override', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        const onConfigDiscovered = vi.fn()
        // Production sequence: spawn with an override, user later picks
        // "Default" in the picker, next message carries model: null.
        const session = createSessionWithBatches([['first', { model: null }]])
        const launcher = new DshRemoteLauncher(session as never, { model: PRO, onConfigDiscovered })

        await launcher.launch()

        expect(harness.setConfigOptionCalls.map((call) => call.value)).toEqual([PRO, FLASH])
        expect(onConfigDiscovered).toHaveBeenCalledWith(PRO)
        expect(harness.prompts).toEqual([[{ type: 'text', text: 'first' }]])
    })

    it('resets to the server default when Default is requested after a per-turn switch', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        const session = createSessionWithBatches([
            ['first', { model: PRO }],
            ['second', { model: null }]
        ])
        const launcher = new DshRemoteLauncher(session as never)

        await launcher.launch()

        expect(harness.setConfigOptionCalls.map((call) => call.value)).toEqual([PRO, FLASH])
        expect(harness.prompts).toEqual([
            [{ type: 'text', text: 'first' }],
            [{ type: 'text', text: 'second' }]
        ])
    })

    it('keeps the running model and reports back when Default is requested but no default was discovered', async () => {
        // No model config option and no metadata: the server never reported a
        // default to reset to.
        harness.modelOption = null
        harness.modelsMetadata = null
        const onModelRollback = vi.fn()
        const session = createSessionWithBatches([
            ['first', { model: PRO }],
            ['second', { model: null }]
        ])
        const launcher = new DshRemoteLauncher(session as never, { onModelRollback })

        await launcher.launch()

        expect(harness.setConfigOptionCalls).toEqual([])
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'Cannot reset the DSH model: the agent did not report a default model.'
        })
        // Both prompts still ran.
        expect(harness.prompts).toEqual([
            [{ type: 'text', text: 'first' }],
            [{ type: 'text', text: 'second' }]
        ])
    })

    it('keeps the previous model and rolls back when a per-turn switch fails', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        harness.configOptionError = new Error('unknown model option')
        const onModelRollback = vi.fn()
        const session = createSession({ model: PRO })
        const launcher = new DshRemoteLauncher(session as never, { onModelRollback })

        await launcher.launch()

        expect(harness.setConfigOptionCalls).toHaveLength(1)
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'Failed to switch DSH model: unknown model option'
        })
        expect(onModelRollback).toHaveBeenCalledWith(FLASH)
        // The prompt still ran with the unchanged model.
        expect(harness.prompts).toEqual([[{ type: 'text', text: 'first' }]])
    })

    it('does not treat an ordinary turn without model metadata as a reset request', async () => {
        // No model option and no metadata: the server never reported a model,
        // so a preference-less turn (mode {}) must run as an ordinary prompt
        // without emitting the reset-failure event.
        harness.modelOption = null
        harness.modelsMetadata = null
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)

        await launcher.launch()

        const events = (session.sendSessionEvent as ReturnType<typeof vi.fn>).mock.calls
        const resetFailures = events.filter((call) =>
            String((call[0] as { message?: string } | undefined)?.message ?? '').includes('Cannot reset'))
        expect(resetFailures).toEqual([])
        expect(harness.prompts).toEqual([[{ type: 'text', text: 'first' }]])
    })

    it('answers ListDshModels once a delayed session/new completes', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        harness.modelsMetadata = {
            availableModels: [{ modelId: FLASH, name: 'DeepSeek-V41-Flash' }],
            currentModelId: FLASH
        }
        // Park session/new: the picker's catalog query arrives while the ACP
        // session is still being created.
        let releaseNewSession!: () => void
        harness.newSessionBlocker = new Promise((resolve) => { releaseNewSession = resolve })
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)

        const done = launcher.launch()
        const registered = await vi.waitFor(() => {
            const call = (session.client.rpcHandlerManager.registerHandler as ReturnType<typeof vi.fn>).mock.calls
                .find((c) => c[0] === 'listDshModels')
            expect(call).toBeTruthy()
            return call!
        })

        // The handler is registered before initialization; invoking it while
        // session/new is pending must park on readiness, not fail.
        const pending = (registered[1] as () => Promise<unknown>)()
        releaseNewSession()
        await done

        await expect(pending).resolves.toEqual({
            success: true,
            availableModels: [{ modelId: FLASH, name: 'DeepSeek-V41-Flash' }],
            currentModelId: FLASH
        })
    })

    it('serves ListDshModels with the live current model', async () => {
        harness.modelOption = { id: 'model', category: 'model', currentValue: FLASH }
        harness.modelsMetadata = {
            availableModels: [
                { modelId: FLASH, name: 'DeepSeek-V41-Flash' },
                { modelId: PRO, name: 'DeepSeek-V4-Pro' }
            ],
            currentModelId: FLASH
        }
        const session = createSession()
        const launcher = new DshRemoteLauncher(session as never)

        await launcher.launch()

        const registered = (session.client.rpcHandlerManager.registerHandler as ReturnType<typeof vi.fn>).mock.calls
            .find((call) => call[0] === 'listDshModels')
        expect(registered).toBeTruthy()
        const handler = registered![1] as () => Promise<unknown>
        await expect(handler()).resolves.toEqual({
            success: true,
            availableModels: [
                { modelId: FLASH, name: 'DeepSeek-V41-Flash' },
                { modelId: PRO, name: 'DeepSeek-V4-Pro' }
            ],
            currentModelId: FLASH
        })
    })
})
