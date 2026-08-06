import { Agent } from "./agent.ts"
import {
    AgentMessage,
    AgentSessionEvent,
    AgentEvent,
    ContextUsage,
    AgentState,
    ThinkingLevel,
} from "./types.ts"
import {
    ImageContent,
    TextContent,
    AssistantMessage,
    Model,
    Message,
    getSupportedThinkingLevels,
    clampThinkingLevel,
} from "../agent-ai/index.ts"
import { isContextOverflow } from "../utils/overflow.ts"
import { sleep } from "../utils/sleep.ts"
import { SessionManager } from "./session-manager.ts"
import { SettingsManager } from "./settings-manager.ts"
import { getLatestCompactionEntry } from "./session-manager-helper.ts"
import {
    calculateContextTokens,
    estimateContextTokens,
    estimateMessagesTokens,
} from "./harness/calc-token.ts"
import {
    CompactionResult,
    prepareCompaction,
    compact,
    shouldCompact,
} from "./harness/compaction.ts"
import { ModelRegistry } from "./model-registry.ts"
import { noModelAvailable } from "./guide.ts"

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"]

export interface AgentSessionConfig {
    // cwd: string
    agent: Agent
    sessionManager: SessionManager
    settingsManager: SettingsManager
    modelRegistry: ModelRegistry
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
    /** Image attachments */
    images?: ImageContent[]
    /** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
    streamingBehavior?: "steer" | "followUp"
}

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void

export class AgentSession {
    readonly agent: Agent
    readonly sessionManager: SessionManager
    readonly settingsManager: SettingsManager
    // Model registry for API key resolution
    readonly modelRegistry: ModelRegistry

    // 消息队列
    /** Tracks pending steering messages for UI display. Removed when delivered. */
    private _steeringMessages: string[] = []
    /** Tracks pending follow-up messages for UI display. Removed when delivered. */
    private _followUpMessages: string[] = []

    // Track last assistant message for auto-compaction check
    private _lastAssistantMessage: AssistantMessage | undefined = undefined
    // Event subscription state
    private _unsubscribeAgent?: () => void
    private _eventListeners: AgentSessionEventListener[] = []

    // 重试状态
    private _retryAbortController: AbortController | undefined = undefined
    private _retryAttempt = 0

    // Compaction state
    private _compactionAbortController: AbortController | undefined = undefined
    private _autoCompactionAbortController: AbortController | undefined = undefined
    private _overflowRecoveryAttempted = false

    /** Whether agent is currently streaming a response */
    get isStreaming(): boolean {
        return this.agent.state.isStreaming
    }
    /** Current model (may be undefined if not yet selected) */
    get model(): Model<any> | undefined {
        return this.agent.state.model
    }
    /** All messages including custom types like BashExecutionMessage */
    get messages(): AgentMessage[] {
        return this.agent.state.messages
    }
    /** Full agent state */
    get state(): AgentState {
        return this.agent.state
    }
    /** Current thinking level */
    get thinkingLevel(): ThinkingLevel {
        return this.agent.state.thinkingLevel
    }

    constructor(config: AgentSessionConfig) {
        this.agent = config.agent
        this.sessionManager = config.sessionManager
        this.settingsManager = config.settingsManager
        this.modelRegistry = config.modelRegistry

        // 始终订阅 Agent 事件以进行内部处理
        this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent)
    }

    /**
     * Subscribe to agent events.
     * Session persistence is handled internally (saves messages on message_end).
     * Multiple listeners can be added. Returns unsubscribe function for this listener.
     */
    subscribe(listener: AgentSessionEventListener): () => void {
        this._eventListeners.push(listener)

        // Return unsubscribe function for this specific listener
        return () => {
            const index = this._eventListeners.indexOf(listener)
            if (index !== -1) {
                this._eventListeners.splice(index, 1)
            }
        }
    }

    /**
     * Set a display name for the current session.
     */
    setSessionName(name: string): void {
        this.sessionManager.appendSessionInfo(name)
        this._emit({ type: "session_info_changed", name: this.sessionManager.getSessionName() })
    }

    getContextUsage(): ContextUsage | undefined {
        const model = this.model
        if (!model) return undefined

        const contextWindow = model.contextWindow ?? 0
        if (contextWindow <= 0) return undefined

        // After compaction, the last assistant usage reflects pre-compaction context size.
        // We can only trust usage from an assistant that responded after the latest compaction.
        // If no such assistant exists, context token count is unknown until the next LLM response.
        const branchEntries = this.sessionManager.getBranch()
        const latestCompaction = getLatestCompactionEntry(branchEntries)

        if (latestCompaction) {
            // Check if there's a valid assistant usage after the compaction boundary
            const compactionIndex = branchEntries.lastIndexOf(latestCompaction)
            let hasPostCompactionUsage = false
            for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
                const entry = branchEntries[i]
                if (entry.type === "message" && entry.message.role === "assistant") {
                    const assistant = entry.message
                    // 过滤 aborted/error 没有统计完成 不能用于 Context
                    if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
                        const contextTokens = calculateContextTokens(assistant.usage)
                        if (contextTokens > 0) {
                            hasPostCompactionUsage = true
                        }
                        break
                    }
                }
            }

            if (!hasPostCompactionUsage) {
                return { tokens: null, contextWindow, percent: null }
            }
        }

        const estimate = estimateContextTokens(this.messages)
        const percent = (estimate.tokens / contextWindow) * 100

        return {
            tokens: estimate.tokens,
            contextWindow,
            percent,
        }
    }

    /**
     * Remove all listeners and disconnect from agent.
     * Call this when completely done with the session.
     */
    dispose(): void {
        try {
            this.abortRetry()
            this.abortCompaction()
            this.agent.abort()
        } catch {
            // Dispose must succeed even if an abort hook throws.
        }
        this._disconnectFromAgent()
        this._eventListeners = []
    }

    /**
     * Temporarily disconnect from agent events.
     * User listeners are preserved and will receive events again after resubscribe().
     * Used internally during operations that need to pause event processing.
     */
    private _disconnectFromAgent(): void {
        if (this._unsubscribeAgent) {
            this._unsubscribeAgent()
            this._unsubscribeAgent = undefined
        }
    }

    /**
     * Reconnect to agent events after _disconnectFromAgent().
     * Preserves all existing listeners.
     */
    private _reconnectToAgent(): void {
        if (this._unsubscribeAgent) return // Already connected
        this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent)
    }

    /** Get pending steering messages (read-only) */
    getSteeringMessages(): readonly string[] {
        return this._steeringMessages
    }

    /** Get pending follow-up messages (read-only) */
    getFollowUpMessages(): readonly string[] {
        return this._followUpMessages
    }

    /**
     * Abort current operation and wait for agent to become idle.
     */
    async abort(): Promise<void> {
        this.abortRetry()
        this.agent.abort()
        await this.agent.waitForIdle()
    }

    /**
     * Clear all queued messages and return them.
     * Useful for restoring to editor when user aborts.
     * @returns Object with steering and followUp arrays
     */
    clearQueue(): { steering: string[]; followUp: string[] } {
        const steering = [...this._steeringMessages]
        const followUp = [...this._followUpMessages]
        this._steeringMessages = []
        this._followUpMessages = []
        this.agent.clearAllQueues()
        this._emitQueueUpdate()
        return { steering, followUp }
    }

    async prompt(text: string, options?: PromptOptions) {
        let messages: AgentMessage[] | undefined
        try {
            let currentImages = options?.images

            if (this.isStreaming) {
                if (!options?.streamingBehavior) {
                    throw new Error(
                        "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
                    )
                }
                if (options.streamingBehavior === "followUp") {
                    await this._queueFollowUp(text, currentImages)
                } else {
                    await this._queueSteer(text, currentImages)
                }
                return
            }

            // Validate model 检查 Model
            if (!this.model) {
                throw new Error(noModelAvailable)
            }

            // Check if we need to compact before sending (catches aborted responses)
            const lastAssistant = this._findLastAssistantMessage()
            // 上下文是不是太长了
            if (lastAssistant && (await this._checkCompaction(lastAssistant, false))) {
                try {
                    await this.agent.continue()
                    while (await this._handlePostAgentRun()) {
                        await this.agent.continue()
                    }
                } finally {
                }
            }

            // Build messages array (custom message if any, then user message)
            messages = []
            // Add user message
            const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: text }]
            if (currentImages) {
                userContent.push(...currentImages)
            }
            messages.push({
                role: "user",
                content: userContent,
                timestamp: Date.now(),
            })
        } catch (error) {
            throw error
        }
        if (!messages) {
            return
        }
        await this._runAgentPrompt(messages)
    }

    /**
     * Internal: Queue a steering message (already expanded, no extension command check).
     */
    private async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
        this._steeringMessages.push(text)
        this._emitQueueUpdate()
        const content: (TextContent | ImageContent)[] = [{ type: "text", text }]
        if (images) {
            content.push(...images)
        }
        this.agent.steer({
            role: "user",
            content,
            timestamp: Date.now(),
        })
    }

    /**
     * Internal: Queue a follow-up message (already expanded, no extension command check).
     */
    private async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
        this._followUpMessages.push(text)
        this._emitQueueUpdate()
        const content: (TextContent | ImageContent)[] = [{ type: "text", text }]
        if (images) {
            content.push(...images)
        }
        this.agent.followUp({
            role: "user",
            content,
            timestamp: Date.now(),
        })
    }

    // =========================================================================
    // Event Subscription
    // =========================================================================

    /** agent事件的内部处理程序——由订阅和重连操作共用 */
    private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
        // When a user message starts, check if it's from either queue and remove it BEFORE emitting
        // This ensures the UI sees the updated queue state
        // 当用户消息开始时 检查是否来自任一队列 并在发出前移除
        // 可能有些消息不是用户实时输入，而是来自steering或者followUp队列
        if (event.type === "message_start" && event.message.role === "user") {
            const messageText = this._getUserMessageText(event.message)
            if (messageText) {
                // Check steering queue first
                const steeringIndex = this._steeringMessages.indexOf(messageText)
                if (steeringIndex !== -1) {
                    this._steeringMessages.splice(steeringIndex, 1)
                    this._emitQueueUpdate()
                } else {
                    // Check follow-up queue
                    const followUpIndex = this._followUpMessages.indexOf(messageText)
                    if (followUpIndex !== -1) {
                        this._followUpMessages.splice(followUpIndex, 1)
                        this._emitQueueUpdate()
                    }
                }
            }
        }

        // 处理需要持久化的消息
        if (event.type === "message_end") {
            if (
                event.message.role === "user" ||
                event.message.role === "assistant" ||
                event.message.role === "toolResult"
            ) {
                // Regular LLM message - persist as SessionMessageEntry
                this.sessionManager.appendMessage(event.message)
            }

            // Track assistant message for auto-compaction (checked on agent_end)
            if (event.message.role === "assistant") {
                this._lastAssistantMessage = event.message

                const assistantMsg = event.message as AssistantMessage
                // Reset retry counter immediately on successful assistant response
                // This prevents accumulation across multiple LLM calls within a turn
                if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
                    this._emit({
                        type: "auto_retry_end",
                        success: true,
                        attempt: this._retryAttempt,
                    })
                    this._retryAttempt = 0
                }
            }
        }

        // Notify all listeners
        // agent_end 数据增强
        this._emit(
            event.type === "agent_end"
                ? { ...event, willRetry: this._willRetryAfterAgentEnd(event) }
                : event,
        )
    }

    /** Extract text content from a message */
    private _getUserMessageText(message: Message): string {
        if (message.role !== "user") return ""
        const content = message.content
        if (typeof content === "string") return content
        const textBlocks = content.filter((c) => c.type === "text")
        return textBlocks.map((c) => (c as TextContent).text).join("")
    }

    /** Find the last assistant message in agent state (including aborted ones) */
    private _findLastAssistantMessage(): AssistantMessage | undefined {
        const messages = this.agent.state.messages
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            if (msg.role === "assistant") {
                return msg as AssistantMessage
            }
        }
        return undefined
    }

    private _willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: "agent_end" }>): boolean {
        const retrySetting = this.settingsManager.get("retry")
        if (!retrySetting.enabled || this._retryAttempt >= retrySetting.maxRetries) {
            return false
        }

        for (let i = event.messages.length - 1; i >= 0; i--) {
            const message = event.messages[i]
            if (message.role === "assistant") {
                return this._isRetryableError(message as AssistantMessage)
            }
        }
        return false
    }

    /** Emit an event to all listeners */
    private _emit(event: AgentSessionEvent): void {
        for (const l of this._eventListeners) {
            l(event)
        }
    }

    private _emitQueueUpdate(): void {
        this._emit({
            type: "queue_update",
            steering: [...this._steeringMessages],
            followUp: [...this._followUpMessages],
        })
    }

    // =========================================================================
    // Model Management
    // =========================================================================
    /**
     * Set model directly.
     * Validates that auth is configured, saves to session and settings.
     * @throws Error if no auth is configured for the model
     */
    async setModel(model: Model<any>): Promise<void> {
        const defaultModel = this.settingsManager.get("defaultModel")
        defaultModel.provider = model.provider
        defaultModel.model = model.id

        const thinkingLevel = this._getThinkingLevelForModelSwitch()

        // Set thinking level. Re-clamp thinking level for new model's capabilities
        const availableLevels = !this.model
            ? THINKING_LEVELS
            : (getSupportedThinkingLevels(this.model) as ThinkingLevel[])
        const thinklevel = this.model
            ? (clampThinkingLevel(this.model, thinkingLevel) as ThinkingLevel)
            : "off"
        const effectiveLevel = availableLevels.includes(thinkingLevel) ? thinkingLevel : thinklevel
        // Only persist if actually changing
        const previousLevel = this.agent.state.thinkingLevel
        const isChanging = effectiveLevel !== previousLevel
        if (isChanging) {
            if (this.supportsThinking() || effectiveLevel !== "off") {
                defaultModel.thinkingLevel = effectiveLevel
            }
        }

        this.agent.state.model = model
        this.agent.state.thinkingLevel = effectiveLevel
        this.settingsManager.set("defaultModel", defaultModel)
    }

    private _getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel {
        if (explicitLevel !== undefined) {
            return explicitLevel
        }
        if (!this.supportsThinking()) {
            return "medium"
        }
        return this.thinkingLevel
    }

    /**
     * Check if current model supports thinking/reasoning.
     */
    supportsThinking(): boolean {
        return !!this.model?.reasoning
    }

    // =========================================================================
    // Prompting
    // =========================================================================

    private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
        try {
            await this.agent.prompt(messages)
            while (await this._handlePostAgentRun()) {
                await this.agent.continue()
            }
        } finally {
        }
    }

    private async _handlePostAgentRun(): Promise<boolean> {
        const msg = this._lastAssistantMessage
        this._lastAssistantMessage = undefined
        if (!msg) {
            return false
        }

        if (this._isRetryableError(msg) && (await this._prepareRetry(msg))) {
            return true
        }

        if (msg.stopReason === "error" && this._retryAttempt > 0) {
            this._emit({
                type: "auto_retry_end",
                success: false,
                attempt: this._retryAttempt,
                finalError: msg.errorMessage,
            })
            this._retryAttempt = 0
        }

        if (await this._checkCompaction(msg)) {
            return true
        }

        // The agent loop drains both queues before emitting agent_end. Any messages
        // here were queued by agent_end extension handlers and need a continuation.
        return this.agent.hasQueuedMessages()
    }

    // =========================================================================
    // Retry
    // =========================================================================
    /** Current retry attempt (0 if not retrying) */
    get retryAttempt(): number {
        return this._retryAttempt
    }

    private _isNonRetryableProviderLimitError(errorMessage: string): boolean {
        return /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i.test(
            errorMessage,
        )
    }

    /**
     * Check if an error is retryable (overloaded, rate limit, server errors).
     * Context overflow errors are NOT retryable (handled by compaction instead).
     */
    private _isRetryableError(message: AssistantMessage): boolean {
        if (message.stopReason !== "error" || !message.errorMessage) return false

        // Context overflow is handled by compaction, not retry
        const contextWindow = this.model?.contextWindow ?? 0
        if (isContextOverflow(message, contextWindow)) return false

        const err = message.errorMessage
        if (this._isNonRetryableProviderLimitError(err)) return false
        // Match: overloaded_error, provider returned error, rate limit, 429, 500, 502, 503, 504, service unavailable, network/connection errors (including connection lost), WebSocket transport closes/errors, fetch failed, premature stream endings, HTTP/2 closed before response, terminated, retry delay exceeded
        return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
            err,
        )
    }
    /**
     * Prepare a retryable error for continuation with exponential backoff.
     * @returns true if the caller should continue the agent, false otherwise
     */
    private async _prepareRetry(message: AssistantMessage): Promise<boolean> {
        const retrySetting = this.settingsManager.get("retry")
        if (!retrySetting.enabled) {
            return false
        }

        this._retryAttempt++

        if (this._retryAttempt > retrySetting.maxRetries) {
            // Preserve the completed attempt count so post-run handling can emit the final failure.
            this._retryAttempt--
            return false
        }

        const delayMs = retrySetting.baseDelayMs * 2 ** (this._retryAttempt - 1)

        this._emit({
            type: "auto_retry_start",
            attempt: this._retryAttempt,
            maxAttempts: retrySetting.maxRetries,
            delayMs,
            errorMessage: message.errorMessage || "Unknown error",
        })

        // Remove error message from agent state (keep in session for history)
        const messages = this.agent.state.messages
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
            this.agent.state.messages = messages.slice(0, -1)
        }

        // Wait with exponential backoff (abortable)
        this._retryAbortController = new AbortController()
        try {
            await sleep(delayMs, this._retryAbortController.signal)
        } catch {
            // Aborted during sleep - emit end event so UI can clean up
            const attempt = this._retryAttempt
            this._retryAttempt = 0
            this._emit({
                type: "auto_retry_end",
                success: false,
                attempt,
                finalError: "Retry cancelled",
            })
            return false
        } finally {
            this._retryAbortController = undefined
        }

        return true
    }

    /**
     * Cancel in-progress retry.
     */
    abortRetry(): void {
        this._retryAbortController?.abort()
    }

    /**
     * Cancel in-progress compaction (manual or auto).
     */
    abortCompaction(): void {
        this._compactionAbortController?.abort()
        this._autoCompactionAbortController?.abort()
    }

    /** Whether auto-retry is currently in progress */
    get isRetrying(): boolean {
        return this._retryAbortController !== undefined
    }

    // =========================================================================
    // Compaction
    // =========================================================================

    /**
     * Manually compact the session context.
     * Aborts current agent operation first.
     * @param customInstructions Optional instructions for the compaction summary
     */
    async compact(customInstructions?: string): Promise<CompactionResult> {
        const compactSettings = this.settingsManager.get("compaction")
        // 中断agent
        this._disconnectFromAgent()
        await this.abort()
        // 取消控制器
        this._compactionAbortController = new AbortController()
        // 发出开始事件
        this._emit({ type: "compaction_start", reason: "manual" })

        try {
            if (!this.model) {
                throw new Error("No model selected")
            }

            const pathEntries = this.sessionManager.getBranch()
            // 判断是否可以压缩
            const preparation = prepareCompaction(pathEntries, compactSettings)
            if (!preparation) {
                // Check why we can't compact
                const lastEntry = pathEntries[pathEntries.length - 1]
                if (lastEntry?.type === "compaction") {
                    throw new Error("Already compacted")
                }
                throw new Error("Nothing to compact (session too small)")
            }

            const defaultModel = this.settingsManager.get("defaultModel")
            const provider = defaultModel.provider
            const apiKey = this.modelRegistry.getApiKey(provider)
            if (!apiKey) {
                throw new Error("Please provider apikey for this model")
            }
            // Generate compaction result
            const result = await compact(
                this.model,
                apiKey,
                preparation,
                customInstructions,
                this._compactionAbortController.signal,
                this.thinkingLevel,
                this.agent.streamFn,
            )

            let summary = result.summary
            let firstKeptEntryId = result.firstKeptEntryId
            let tokensBefore = result.tokensBefore
            let details = result.details

            // 检查是否取消
            if (this._compactionAbortController.signal.aborted) {
                throw new Error("Compaction cancelled")
            }
            // 保存压缩结果
            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details)

            // 重建 Agent Context
            const sessionContext = this.sessionManager.buildSessionContext()
            this.agent.state.messages = sessionContext.messages
            // 计算压缩后token
            const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages)
            const compactionResult: CompactionResult = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                estimatedTokensAfter,
                details,
            }
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: compactionResult,
                aborted: false,
                willRetry: false,
            })
            return compactionResult
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const aborted =
                message === "Compaction cancelled" ||
                (error instanceof Error && error.name === "AbortError")
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: undefined,
                aborted,
                willRetry: false,
                errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
            })
            throw error
        } finally {
            this._compactionAbortController = undefined
            this._reconnectToAgent()
        }
    }

    /**
     * Internal: Run auto-compaction with events.
     */
    private async _runAutoCompaction(
        reason: "overflow" | "threshold",
        willRetry: boolean,
    ): Promise<boolean> {
        const compactSettings = this.settingsManager.get("compaction")
        let started = false

        try {
            if (!this.model) {
                return false
            }

            const pathEntries = this.sessionManager.getBranch()
            const preparation = prepareCompaction(pathEntries, compactSettings)
            if (!preparation) {
                return false
            }

            this._emit({ type: "compaction_start", reason })
            this._autoCompactionAbortController = new AbortController()
            started = true

            let summary: string
            let firstKeptEntryId: string
            let tokensBefore: number
            let details: unknown

            const defaultModel = this.settingsManager.get("defaultModel")
            const provider = defaultModel.provider
            const apiKey = this.modelRegistry.getApiKey(provider)
            if (!apiKey) {
                return false
            }

            // Generate compaction result
            const compactResult = await compact(
                this.model,
                apiKey,
                preparation,
                undefined,
                this._autoCompactionAbortController.signal,
                this.thinkingLevel,
                this.agent.streamFn,
            )
            summary = compactResult.summary
            firstKeptEntryId = compactResult.firstKeptEntryId
            tokensBefore = compactResult.tokensBefore
            details = compactResult.details

            if (this._autoCompactionAbortController.signal.aborted) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: true,
                    willRetry: false,
                })
                return false
            }

            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details)
            const newEntries = this.sessionManager.getEntries()
            const sessionContext = this.sessionManager.buildSessionContext()
            this.agent.state.messages = sessionContext.messages
            const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages)

            const result: CompactionResult = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                estimatedTokensAfter,
                details,
            }
            this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry })

            if (willRetry) {
                const messages = this.agent.state.messages
                const lastMsg = messages[messages.length - 1]
                if (
                    lastMsg?.role === "assistant" &&
                    (lastMsg as AssistantMessage).stopReason === "error"
                ) {
                    this.agent.state.messages = messages.slice(0, -1)
                }
                return true
            }

            // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
            // Continue once so queued messages are delivered.
            return this.agent.hasQueuedMessages()
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "compaction failed"
            if (started) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage:
                        reason === "overflow"
                            ? `Context overflow recovery failed: ${errorMessage}`
                            : `Auto-compaction failed: ${errorMessage}`,
                })
            }
            return false
        } finally {
            this._autoCompactionAbortController = undefined
        }
    }

    /**
     * Check if compaction is needed and run it.
     * Called after agent_end and before prompt submission.
     *
     * Two cases:
     * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
     * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
     *
     * @param assistantMessage The assistant message to check
     * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
     */
    private async _checkCompaction(
        assistantMessage: AssistantMessage,
        skipAbortedCheck = true,
    ): Promise<boolean> {
        const compactSettings = this.settingsManager.get("compaction")
        if (!compactSettings.enabled) return false

        // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
        if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false

        const contextWindow = this.model?.contextWindow ?? 0

        // Skip overflow check if the message came from a different model.
        // This handles the case where user switched from a smaller-context model (e.g. opus)
        // to a larger-context model (e.g. codex) - the overflow error from the old model
        // shouldn't trigger compaction for the new model.
        const sameModel =
            this.model &&
            assistantMessage.provider === this.model.provider &&
            assistantMessage.model === this.model.id

        // Skip compaction checks if this assistant message is older than the latest
        // compaction boundary. This prevents a stale pre-compaction usage/error
        // from retriggering compaction on the first prompt after compaction.
        const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch())
        const assistantIsFromBeforeCompaction =
            compactionEntry !== null &&
            assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime()
        if (assistantIsFromBeforeCompaction) {
            return false
        }

        // Case 1: Overflow - LLM returned context overflow error, or reported usage exceeded
        // the configured window. A successful response over the configured window should compact
        // but must not retry: the assistant answer already completed and agent.continue() cannot
        // continue from an assistant message.
        if (sameModel && isContextOverflow(assistantMessage, contextWindow)) {
            const willRetry = assistantMessage.stopReason !== "stop"

            if (!willRetry) {
                return await this._runAutoCompaction("overflow", false)
            }

            if (this._overflowRecoveryAttempted) {
                this._emit({
                    type: "compaction_end",
                    reason: "overflow",
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage:
                        "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
                })
                return false
            }

            this._overflowRecoveryAttempted = true
            // Remove the error message from agent state (it IS saved to session for history,
            // but we don't want it in context for the retry)
            const messages = this.agent.state.messages
            if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
                this.agent.state.messages = messages.slice(0, -1)
            }
            return await this._runAutoCompaction("overflow", willRetry)
        }

        // Case 2: Threshold - context is getting large
        // For error messages (no usage data), estimate from last successful response.
        // This ensures sessions that hit persistent API errors (e.g. 529) can still compact.
        let contextTokens: number
        if (assistantMessage.stopReason === "error") {
            const messages = this.agent.state.messages
            const estimate = estimateContextTokens(messages)
            if (estimate.lastUsageIndex === null) return false // No usage data at all
            // Verify the usage source is post-compaction. Kept pre-compaction messages
            // have stale usage reflecting the old (larger) context and would falsely
            // trigger compaction right after one just finished.
            const usageMsg = messages[estimate.lastUsageIndex]
            if (
                compactionEntry &&
                usageMsg.role === "assistant" &&
                (usageMsg as AssistantMessage).timestamp <=
                    new Date(compactionEntry.timestamp).getTime()
            ) {
                return false
            }
            contextTokens = estimate.tokens
        } else {
            contextTokens = calculateContextTokens(assistantMessage.usage)
        }
        if (shouldCompact(contextTokens, contextWindow, compactSettings)) {
            return await this._runAutoCompaction("threshold", false)
        }
        return false
    }
}
