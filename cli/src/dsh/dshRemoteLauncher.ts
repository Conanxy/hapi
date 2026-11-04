import React from 'react'
import { RPC_METHODS } from '@hapi/protocol'
import { logger } from '@/ui/logger'
import { buildHapiMcpBridge } from '@/codex/utils/buildHapiMcpBridge'
import { convertAgentMessage } from '@/agent/messageConverter'
import type { AgentMessage, McpServerStdio, PromptContent } from '@/agent/types'
import {
    RemoteLauncherBase,
    type RemoteLauncherDisplayContext,
    type RemoteLauncherExitReason
} from '@/modules/common/remote/RemoteLauncherBase'
import { RemoteModeDisplay } from '@/ui/ink/RemoteModeDisplay'
import { AcpPermissionHandler } from '@/modules/common/permission/AcpPermissionHandler'
import { createDshBackend } from './utils/dshBackend'
import type { DshSession } from './session'

export class DshRemoteLauncher extends RemoteLauncherBase {
    private static readonly SHUTDOWN_GRACE_MS = 2_000

    private backend: ReturnType<typeof createDshBackend> | null = null
    private backendSessionId: string | null = null
    private happyServer: { stop: () => void } | null = null
    private permissionHandler: AcpPermissionHandler | null = null
    private abortController = new AbortController()
    private launchPromise: Promise<RemoteLauncherExitReason> | null = null
    private killPromise: Promise<void> | null = null
    private cleanupPromise: Promise<void> | null = null
    private closeSessionPromise: Promise<void> | null = null
    private currentBackendModel: string | null = null
    /** Server default captured at session creation, before any override. */
    private initialBackendModel: string | null = null

    constructor(
        private readonly session: DshSession,
        private readonly opts: {
            /** Spawn-time model override (opaque ACP config-option value). */
            model?: string
            onModelRollback?: (model: string | null) => void
            onConfigDiscovered?: (model: string | null) => void
        } = {}
    ) {
        super(process.env.DEBUG ? session.logPath : undefined)
    }

    launch(): Promise<RemoteLauncherExitReason> {
        this.launchPromise ??= this.start({ onExit: () => this.handleExitFromUi() })
        return this.launchPromise
    }

    kill(): Promise<void> {
        this.killPromise ??= this.stop()
        return this.killPromise
    }

    private async stop(): Promise<void> {
        if (!this.launchPromise) {
            await this.requestExit('exit', () => this.handleAbort())
            return
        }
        if (this.cleanupPromise) {
            await this.cleanupPromise
            return
        }
        const exit = this.requestExit('exit', () => this.handleAbort())
        let timer: ReturnType<typeof setTimeout> | undefined
        const completed = await Promise.race([
            Promise.allSettled([exit, this.launchPromise]).then(() => true),
            new Promise<false>((resolve) => {
                timer = setTimeout(() => resolve(false), DshRemoteLauncher.SHUTDOWN_GRACE_MS)
            })
        ])
        if (timer) clearTimeout(timer)
        if (!completed) {
            logger.warn('[dsh-acp] Timed out waiting for prompt shutdown; closing the backend')
            await this.cleanup()
        }
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(RemoteModeDisplay, {
            ...context,
            agentLabel: 'DeepSeek Harness'
        })
    }

    protected async runMainLoop(): Promise<void> {
        if (this.shouldExit) return
        const { server, mcpServers } = await buildHapiMcpBridge(this.session.client, {
            skillLookup: { workingDirectory: this.session.path, flavor: 'dsh' }
        })
        if (this.shouldExit) {
            server.stop()
            return
        }
        this.happyServer = server
        const acpMcpServers = toAcpMcpServers(mcpServers)

        const backend = createDshBackend()
        this.backend = backend
        backend.onStderrError((error) => {
            logger.debug('[dsh-acp] stderr error', error)
            this.session.sendSessionEvent({ type: 'message', message: error.message })
            this.messageBuffer.addMessage(error.message, 'status')
        })

        // Register the catalog RPC before initialization: a client that opens
        // the model picker while initialize/session/new is still pending
        // would otherwise hit an unregistered-method rejection, and the
        // picker has no retry path — it would stay empty until remounted.
        // The handler parks on readiness and answers once the session exists
        // and model discovery has settled.
        let markReady!: (acpSessionId: string) => void
        let markFailed!: (error: unknown) => void
        const ready = new Promise<string>((resolve, reject) => {
            markReady = resolve
            markFailed = reject
        })
        void ready.catch(() => {})
        this.session.client.rpcHandlerManager.registerHandler(RPC_METHODS.ListDshModels, async () => {
            let acpSessionId: string
            try {
                acpSessionId = await ready
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                return { success: false, error: `DSH session is not available: ${message}` }
            }
            const metadata = backend.getSessionModelsMetadata(acpSessionId)
            if (!metadata) {
                return { success: false, error: 'DSH model metadata is not available' }
            }
            return {
                success: true,
                availableModels: metadata.availableModels,
                currentModelId: this.currentBackendModel ?? metadata.currentModelId
            }
        })

        let acpSessionId: string
        try {
            try {
                await backend.initialize()
            } finally {
                // A timed-out cleanup can run before initialize installs its transport.
                if (this.shouldExit && this.cleanupPromise) {
                    await this.cleanupPromise
                    await backend.disconnect()
                }
            }
            if (this.shouldExit) {
                markFailed(new Error('DSH session is stopping'))
                return
            }

            const resumeSessionId = this.session.sessionId
            if (resumeSessionId) {
                try {
                    // DSH's current ACP profile exposes the non-standard
                    // `session/resume` method rather than ACP's `session/load`.
                    // It restores model context but intentionally emits no history;
                    // HAPI's Hub remains the transcript source for the UI.
                    if (!backend.supportsSessionResume()) {
                        throw new Error('DSH ACP server does not advertise session/resume')
                    }
                    acpSessionId = await backend.resumeSession({
                        sessionId: resumeSessionId,
                        cwd: this.session.path,
                        mcpServers: acpMcpServers
                    })
                } catch (error) {
                    if (this.shouldExit) {
                        markFailed(error)
                        return
                    }
                    logger.warn('[dsh-acp] resume failed, starting a new session', error)
                    this.session.sendSessionEvent({
                        type: 'message',
                        message: 'DSH resume failed; starting a new session.'
                    })
                    acpSessionId = await backend.newSession({
                        cwd: this.session.path,
                        mcpServers: acpMcpServers
                    })
                }
            } else {
                acpSessionId = await backend.newSession({
                    cwd: this.session.path,
                    mcpServers: acpMcpServers
                })
            }
            this.backendSessionId = acpSessionId
            if (this.shouldExit && this.cleanupPromise) {
                markFailed(new Error('DSH session is stopping'))
                await this.cleanupPromise
                await this.closeBackendSession(backend, acpSessionId)
                return
            }
            this.session.onSessionFound(acpSessionId)
            if (this.shouldExit) {
                markFailed(new Error('DSH session is stopping'))
                return
            }
        } catch (error) {
            markFailed(error)
            if (this.shouldExit) return
            throw error
        }

        const modelOption = backend.getConfigOptionByCategory(acpSessionId, 'model')
        // Capture the server default BEFORE applying any override: an explicit
        // "Default" reset later in the session (queued as model: null) switches
        // back to this value; without it the reset would silently keep the
        // last explicitly-applied model.
        this.initialBackendModel = modelOption?.currentValue
            ?? backend.getSessionModelsMetadata(acpSessionId)?.currentModelId
            ?? null
        if (this.opts.model && modelOption) {
            this.currentBackendModel = await this.applyModelSwitch(backend, acpSessionId, this.opts.model)
        }
        if (this.shouldExit) {
            markFailed(new Error('DSH session is stopping'))
            return
        }
        if (!this.currentBackendModel) {
            this.currentBackendModel = this.initialBackendModel
        }
        this.opts.onConfigDiscovered?.(this.currentBackendModel)
        if (this.currentBackendModel) {
            this.messageBuffer.addMessage(`[MODEL:${this.currentBackendModel}]`, 'system')
        }
        markReady(acpSessionId)

        this.permissionHandler = new AcpPermissionHandler(
            this.session.client,
            backend,
            () => undefined
        )
        this.setupAbortHandlers(this.session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleExitFromUi()
        })

        while (!this.shouldExit) {
            const abortSignal = this.abortController.signal
            const batch = await this.session.queue.waitForMessagesAndGetAsString(abortSignal)
            if (!batch) {
                if (abortSignal.aborted && !this.shouldExit) continue
                break
            }

            const requestedModel = batch.mode.model
            if (requestedModel === null) {
                // Explicit "Default": switch back to the server default captured
                // at session creation. The web picker resets the session model
                // to null and the next queued turn carries it here.
                if (this.initialBackendModel && this.initialBackendModel !== this.currentBackendModel) {
                    const applied = await this.applyModelSwitch(backend, acpSessionId, this.initialBackendModel)
                    if (applied) {
                        batch.mode.model = applied
                    } else {
                        batch.mode.model = this.currentBackendModel ?? undefined
                        this.opts.onModelRollback?.(this.currentBackendModel)
                    }
                } else if (!this.initialBackendModel) {
                    // Nothing captured to go back to — keep the running model and
                    // report it back so the picker does not claim "Default".
                    batch.mode.model = this.currentBackendModel ?? undefined
                    this.opts.onModelRollback?.(this.currentBackendModel)
                    this.session.sendSessionEvent({
                        type: 'message',
                        message: 'Cannot reset the DSH model: the agent did not report a default model.'
                    })
                } else {
                    // Already running the default.
                    batch.mode.model = this.currentBackendModel ?? undefined
                }
            } else if (requestedModel && requestedModel !== this.currentBackendModel) {
                const applied = await this.applyModelSwitch(backend, acpSessionId, requestedModel)
                if (applied) {
                    batch.mode.model = applied
                } else {
                    batch.mode.model = this.currentBackendModel ?? undefined
                    this.opts.onModelRollback?.(this.currentBackendModel)
                }
            }

            if (this.shouldExit) break
            this.session.onThinkingChange(true)
            this.messageBuffer.addMessage(batch.message, 'user')
            const prompt: PromptContent[] = [{ type: 'text', text: batch.message }]
            try {
                await backend.prompt(acpSessionId, prompt, (message) => this.handleAgentMessage(message))
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn('[dsh-acp] prompt failed', { message })
                this.session.sendSessionEvent({ type: 'message', message: `DSH prompt failed: ${message}` })
                this.messageBuffer.addMessage(`DSH prompt failed: ${message}`, 'status')
            } finally {
                this.session.onThinkingChange(false)
                await this.permissionHandler?.cancelAll('Prompt finished')
                if (this.session.queue.size() === 0 && !this.shouldExit) {
                    this.session.sendSessionEvent({ type: 'ready' })
                }
            }
        }
    }

    protected cleanup(): Promise<void> {
        this.cleanupPromise ??= this.cleanupResources()
        return this.cleanupPromise
    }

    private async cleanupResources(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager)
        const permissionHandler = this.permissionHandler
        const backend = this.backend
        this.permissionHandler = null
        try {
            await permissionHandler?.cancelAll('Session ended')
        } catch (error) {
            logger.warn('[dsh-acp] Failed to cancel pending permissions during cleanup', error)
        }
        try {
            if (backend && this.backendSessionId) {
                await this.closeBackendSession(backend, this.backendSessionId)
            }
        } catch (error) {
            logger.warn('[dsh-acp] Failed to close the session during cleanup', error)
        }
        try {
            await backend?.disconnect()
        } finally {
            this.backend = null
            this.backendSessionId = null
            this.happyServer?.stop()
            this.happyServer = null
        }
    }

    private closeBackendSession(backend: ReturnType<typeof createDshBackend>, sessionId: string): Promise<void> {
        this.closeSessionPromise ??= backend.closeSession(sessionId)
        return this.closeSessionPromise
    }

    private handleAgentMessage(message: AgentMessage): void {
        const converted = convertAgentMessage(message)
        if (converted) this.session.sendAgentMessage(converted)

        switch (message.type) {
            case 'text':
                // Interim idle snapshots; the settled text arrives at the
                // segment boundary, which is what belongs in the local log.
                if (message.live) break
                this.messageBuffer.addMessage(message.text, 'assistant')
                break
            case 'generated_image':
                this.messageBuffer.addMessage(`Generated image: ${message.fileName}`, 'assistant')
                break
            case 'error':
                this.messageBuffer.addMessage(message.message, 'status')
                break
            case 'turn_complete':
                this.messageBuffer.addMessage('Turn complete', 'status')
                break
            case 'usage':
            case 'reasoning':
            case 'tool_call':
            case 'tool_result':
            case 'plan':
                break
            default: {
                const _exhaustive: never = message
                return _exhaustive
            }
        }
    }

    /**
     * Switch the DSH model through `session/set_config_option` — dsh does not
     * implement `session/set_model` (verified against 0.2.0-rc.2: -32601).
     * Model ids are opaque config-option values (JSON provider+model tuples)
     * and are sent back verbatim; unknown ids fail loud with -32602.
     * Returns the applied model, or null when the switch failed (caller keeps
     * the previous model).
     */
    private async applyModelSwitch(
        backend: ReturnType<typeof createDshBackend>,
        acpSessionId: string,
        model: string
    ): Promise<string | null> {
        const option = backend.getConfigOptionByCategory(acpSessionId, 'model')
        if (!option) {
            logger.warn('[dsh-acp] Cannot switch model: agent exposes no model config option')
            this.session.sendSessionEvent({
                type: 'message',
                message: 'Cannot switch model: the DSH agent exposes no model config option.'
            })
            return null
        }
        try {
            await backend.setConfigOption(acpSessionId, option.id, model)
            this.currentBackendModel = model
            this.messageBuffer.addMessage(`[MODEL:${model}]`, 'system')
            return model
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn('[dsh-acp] model switch failed', { message })
            this.session.sendSessionEvent({
                type: 'message',
                message: `Failed to switch DSH model: ${message}`
            })
            return null
        }
    }

    private async handleAbort(): Promise<void> {
        this.session.queue.reset()
        this.session.onThinkingChange(false)
        this.abortController.abort()
        this.abortController = new AbortController()
        try {
            if (this.backend && this.backendSessionId) {
                await this.backend.cancelPrompt(this.backendSessionId)
            }
        } catch (error) {
            logger.warn('[dsh-acp] Failed to cancel the prompt', error)
        }
        await this.permissionHandler?.cancelAll('User aborted')
        this.session.sendSessionEvent({ type: 'message', message: 'Session aborted' })
        this.messageBuffer.addMessage('Turn aborted', 'status')
    }

    private async handleExitFromUi(): Promise<void> {
        await this.kill()
    }
}

function toAcpMcpServers(config: Record<string, { command: string; args: string[] }>): McpServerStdio[] {
    return Object.entries(config).map(([name, entry]) => ({
        name,
        command: entry.command,
        args: entry.args,
        env: []
    }))
}
