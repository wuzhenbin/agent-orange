import * as path from "node:path"
import {
    TUI,
    Container,
    Loader,
    ProcessTerminal,
    setKeybindings,
    Text,
    Spacer,
    LoaderIndicatorOptions,
    TruncatedText,
} from "@earendil-works/pi-tui"
import { getEditorTheme } from "./theme/tui-helper.ts"
import { initTheme, theme } from "./theme/global-instance.ts"
import { KeybindingsManager } from "./core/keybindings.ts"
import { CustomEditor } from "./components/custom-editor.ts"
import { Welcome, CustomColor, APP_TITLE, AgentColor } from "../config/settings.ts"
import chalk from "chalk"
import { InteractiveMode } from "./interact.ts"
import { CountdownTimer } from "./components/countdown-timer.ts"
import type { AgentMessage, AgentSessionEvent } from "../agent-core/types.ts"
import type { Message } from "../agent-ai/types.ts"
import { MessageComponent } from "./components/stream-message.ts"
import { FooterComponent } from "./components/footer.ts"
import { CompactionQueuedMessage } from "./types.ts"
import { SessionContext } from "../agent-core/session-manager-helper.ts"
import { TextContent, ThinkingContent, AssistantMessage, ToolCall } from "../agent-ai/types.ts"
import { ensureTool } from "../utils/global-tools.ts"
import { keyText } from "./core/keybinding-hints.ts"
import { createCompactionSummaryMessage } from "../agent-core/harness/message.ts"
import { formatDisplayPath } from "./helper.ts"
import { noModelAvailable } from "../agent-core/guide.ts"

function isContentBlock(content: unknown): content is { type: string } {
    return typeof content === "object" && content !== null && "type" in content
}

function isTextContent(content: unknown): content is TextContent {
    return isContentBlock(content) && content.type === "text"
}

function isThinkingContent(content: unknown): content is ThinkingContent {
    return isContentBlock(content) && content.type === "thinking"
}

function isToolCall(content: unknown): content is ToolCall {
    return isContentBlock(content) && content.type === "toolCall"
}

export default class UIManager {
    private app: InteractiveMode
    ui: TUI

    headerContainer: Container
    chatContainer: Container
    pendingMessagesContainer: Container
    editorContainer: Container
    statusContainer: Container
    footer: FooterComponent

    editor: CustomEditor
    messageComponent: MessageComponent
    loadingAnimation: Loader | undefined = undefined

    isInitialized = false
    keybindings: KeybindingsManager

    // Auto-retry state
    private retryLoader: Loader | undefined = undefined
    private retryCountdown: CountdownTimer | undefined = undefined
    private retryEscapeHandler?: () => void

    // Messages queued while compaction is running
    private compactionQueuedMessages: CompactionQueuedMessage[] = []

    workingVisible = true
    readonly workingMessage = "Working..."
    private workingIndicatorOptions: LoaderIndicatorOptions | undefined = undefined

    // Agent subscription unsubscribe function
    unsubscribe?: () => void
    unsubscribeSubagent?: () => void

    fdPath: string | undefined

    // Auto-compaction state
    private autoCompactionLoader: Loader | undefined = undefined
    private autoCompactionEscapeHandler?: () => void

    private get keyHandles() {
        return this.app.keyHandles
    }
    private get autoComplete() {
        return this.app.autoComplete
    }
    private get agentContext() {
        return this.app.agentContext
    }
    private get definition() {
        return this.agentContext.definition
    }
    private get sessionManager() {
        return this.agentContext.sessionManager
    }
    private get settingsManager() {
        return this.agentContext.settingsManager
    }
    private get session() {
        return this.agentContext.session
    }
    private get agent() {
        return this.agentContext.agent
    }
    private get agentManager() {
        return this.agentContext.agentManager
    }
    get modelRegistry() {
        return this.agentContext.modelRegistry
    }

    constructor(app: InteractiveMode) {
        this.app = app

        initTheme("")

        this.ui = new TUI(new ProcessTerminal(), this.settingsManager.get("showHardwareCursor"))
        this.keybindings = KeybindingsManager.create()
        setKeybindings(this.keybindings)

        this.headerContainer = new Container()
        this.chatContainer = new Container()
        this.pendingMessagesContainer = new Container()
        this.statusContainer = new Container()
        this.editorContainer = new Container()
        this.footer = new FooterComponent(this.agentContext)

        this.messageComponent = new MessageComponent(this.chatContainer)
        this.editor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
            paddingX: 0,
            autocompleteMaxVisible: this.settingsManager.get("autocompleteMaxVisible"),
        })
        this.editorContainer.addChild(this.editor)
    }

    async init() {
        if (this.isInitialized) return

        this.keyHandles.registerSignalHandlers()

        // 初始化fd/rg
        const [fdPath] = await Promise.all([ensureTool("fd"), ensureTool("rg")])
        this.fdPath = fdPath

        // 添加各容器到 UI
        this.ui.addChild(this.headerContainer)
        this.ui.addChild(this.chatContainer)
        this.ui.addChild(this.pendingMessagesContainer)
        this.ui.addChild(this.statusContainer)
        this.ui.addChild(this.editorContainer)
        this.ui.addChild(this.footer)

        this.ui.setFocus(this.editor)
        this.keyHandles.setupKeyHandlers()
        this.keyHandles.setupEditorSubmitHandler()

        this.ui.start()
        this.isInitialized = true
        this.rebindCurrentSession()
        this.renderInitialMessages()
        this.subscribeToSubagent()
        this.autoComplete.setupAutocompleteProvider()
        this.initUIComponent()

        const defaultModel = this.settingsManager.get("defaultModel")
        const model = this.modelRegistry.getModel(defaultModel.provider, defaultModel.model)
        if (!model) {
            this.showWarning(noModelAvailable)
        }
    }

    subscribeToSubagent() {
        this.unsubscribeSubagent = this.agentManager.events.onAny(({ type, payload }) => {
            switch (type) {
                case "start":
                    this.messageComponent.writeLine(
                        "subagent",
                        `[${payload.agentId}] started: ${payload.task}`,
                    )
                    break

                case "tool_call":
                    this.messageComponent.writeLine(
                        "subagent",
                        `[${payload.agentId}] ${payload.tool} ${payload.arguments}`,
                    )
                    break

                case "end":
                    this.messageComponent.writeLine(
                        "subagent",
                        `[${payload.agentId}] finished (${payload.message})`,
                    )
                    break
            }
        })
    }

    rebindCurrentSession(): void {
        this.stopWorkingLoader()
        this.unsubscribe?.()
        this.unsubscribe = undefined
        this.subscribeToAgent()
        this.updateEditorBorderColor()
        this.updateTerminalTitle()
    }

    rebuildChatFromMessages(): void {
        this.chatContainer.clear()
        this.messageComponent = new MessageComponent(this.chatContainer)
        const context = this.sessionManager.buildSessionContext()
        this.renderSessionContext(context)
    }

    renderCurrentSessionState(): void {
        this.chatContainer.clear()
        this.messageComponent = new MessageComponent(this.chatContainer)
        this.pendingMessagesContainer.clear()
        this.compactionQueuedMessages = []
        this.renderInitialMessages()
    }

    renderInitialMessages(): void {
        // Get aligned messages and entries from session context
        const context = this.sessionManager.buildSessionContext()
        this.renderSessionContext(context)

        const allEntries = this.sessionManager.getEntries()
        const compactionCount = allEntries.filter((e) => e.type === "compaction").length
        if (compactionCount > 0) {
            const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`
            this.showTips(`Session compacted ${times}`)
        }
    }

    /**
     * Render session context to chat. Used for initial load and rebuild after compaction.
     * @param sessionContext Session context to render
     * @param options.updateFooter Update footer state
     * @param options.populateHistory Add user messages to editor history
     */
    private renderSessionContext(sessionContext: SessionContext): void {
        for (const message of sessionContext.messages) {
            // Assistant messages need special handling for tool calls
            if (
                message.role === "user" ||
                message.role === "assistant" ||
                message.role === "toolResult" ||
                message.role === "compactionSummary"
            ) {
                this.addMessageToChat(message)
            }
        }

        this.ui.requestRender()
    }

    initUIComponent() {
        // welcome
        this.headerContainer.addChild(new Text(Welcome, 0, 0, (text) => AgentColor.theme(text)))

        // mcps
        const useMcps = this.definition.useMcps ?? []
        if (useMcps.length) {
            this.headerContainer.addChild(
                new Text(`[MCP]`, 0, 0, (text) => CustomColor.title(text)),
            )
            this.headerContainer.addChild(
                new Text(useMcps.join(", "), 0, 0, (text) => CustomColor.gray(text)),
            )
            this.headerContainer.addChild(new Spacer(1))
        }

        // tools
        const useTools = this.definition.useTools ?? []
        if (useTools.length) {
            this.headerContainer.addChild(
                new Text(`[Tools]`, 0, 0, (text) => CustomColor.title(text)),
            )
            this.headerContainer.addChild(
                new Text(useTools.map((tool) => tool.name).join(","), 0, 0, (text) =>
                    CustomColor.gray(text),
                ),
            )
            this.headerContainer.addChild(new Spacer(1))
        }

        // skills
        const useSkills = this.definition.useSkills ?? []
        if (useSkills.length) {
            this.headerContainer.addChild(
                new Text(`[Skills]`, 0, 0, (text) => CustomColor.title(text)),
            )
            this.headerContainer.addChild(
                new Text(useSkills.map((skill) => skill.name).join(","), 0, 0, (text) =>
                    CustomColor.gray(text),
                ),
            )
            this.headerContainer.addChild(new Spacer(1))
        }

        // context rules
        const contextFiles = this.definition.contextFiles || []
        if (contextFiles.length) {
            this.headerContainer.addChild(
                new Text(`[Context]`, 0, 0, (text) => CustomColor.title(text)),
            )
            this.headerContainer.addChild(
                new Text(
                    contextFiles.map((f) => formatDisplayPath(f.path)).join("\n"),
                    0,
                    0,
                    (text) => CustomColor.gray(text),
                ),
            )
            this.headerContainer.addChild(new Spacer(1))
        }
        this.ui.requestRender()
    }

    async subscribeToAgent() {
        this.unsubscribe = this.session.subscribe(async (event) => {
            await this.handleEvent(event)
        })
    }

    /**
     * Update terminal title with session name and cwd.
     */
    updateTerminalTitle(): void {
        const cwdBasename = path.basename(this.sessionManager.getCwd())
        const sessionName = this.sessionManager.getSessionName()
        if (sessionName) {
            this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`)
        } else {
            this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`)
        }
    }

    private async handleEvent(event: AgentSessionEvent): Promise<void> {
        if (!this.isInitialized) {
            await this.init()
        }
        const terminalConfig = this.settingsManager.get("terminal")
        switch (event.type) {
            case "agent_start": {
                if (terminalConfig?.showTerminalProgress) {
                    this.ui.terminal.setProgress(true)
                }
                // Restore main escape handler if retry handler is still active
                // (retry success event fires later, but we need main handler now)
                if (this.retryEscapeHandler) {
                    this.editor.onEscape = this.retryEscapeHandler
                    this.retryEscapeHandler = undefined
                }
                if (this.retryCountdown) {
                    this.retryCountdown.dispose()
                    this.retryCountdown = undefined
                }
                if (this.retryLoader) {
                    this.retryLoader.stop()
                    this.retryLoader = undefined
                }
                this.stopWorkingLoader()
                if (this.workingVisible) {
                    this.loadingAnimation = this.createWorkingLoader()
                    this.statusContainer.addChild(this.loadingAnimation)
                }
                break
            }

            case "queue_update": {
                this.updatePendingMessagesDisplay()
                break
            }

            case "message_start": {
                if (event.message.role === "user") {
                    this.addMessageToChat(event.message)
                    this.updatePendingMessagesDisplay()
                }
                break
            }

            case "message_end": {
                if (event.message.role === "assistant" && event.message.errorMessage) {
                    this.showError(event.message.errorMessage)
                }
                break
            }

            case "message_update": {
                const e = event.assistantMessageEvent

                switch (e.type) {
                    case "thinking_start":
                        this.messageComponent.switchBlock("think")
                        break

                    case "thinking_delta":
                        this.messageComponent.writeText(e.delta)
                        break

                    case "thinking_end":
                        break

                    case "text_start":
                        this.messageComponent.switchBlock("text")
                        break

                    case "text_delta":
                        this.messageComponent.writeText(e.delta)
                        break

                    case "toolcall_end":
                        this.messageComponent.writeLine(
                            "toolcall",
                            `${e.toolCall.name}: ${JSON.stringify(e.toolCall.arguments)}`,
                        )
                        break

                    case "error":
                        this.messageComponent.writePart("error", `error: ${e.error}`)
                        break

                    case "done":
                        break
                }
                break
            }

            case "tool_execution_start": {
                break
            }

            case "tool_execution_end": {
                if (event.isError) {
                    this.messageComponent.writePart(
                        "error",
                        `error: ${JSON.stringify(event.result)}`,
                    )
                } else {
                    this.messageComponent.writeLine("tool_result", JSON.stringify(event.result))
                }
                break
            }

            case "compaction_start": {
                if (terminalConfig?.showTerminalProgress) {
                    this.ui.terminal.setProgress(true)
                }
                // Keep editor active; submissions are queued during compaction.
                this.autoCompactionEscapeHandler = this.editor.onEscape
                this.editor.onEscape = () => {
                    this.session.abortCompaction()
                }
                this.statusContainer.clear()
                const cancelHint = `(${keyText("app.interrupt")} to cancel)`
                const label =
                    event.reason === "manual"
                        ? `Compacting context... ${cancelHint}`
                        : `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`
                this.autoCompactionLoader = new Loader(
                    this.ui,
                    (spinner) => theme.fg("accent", spinner),
                    (text) => theme.fg("muted", text),
                    label,
                )
                this.statusContainer.addChild(this.autoCompactionLoader)
                break
            }

            case "compaction_end": {
                if (terminalConfig?.showTerminalProgress) {
                    this.ui.terminal.setProgress(false)
                }
                if (this.autoCompactionEscapeHandler) {
                    this.editor.onEscape = this.autoCompactionEscapeHandler
                    this.autoCompactionEscapeHandler = undefined
                }
                if (this.autoCompactionLoader) {
                    this.autoCompactionLoader.stop()
                    this.autoCompactionLoader = undefined
                    this.statusContainer.clear()
                }
                if (event.aborted) {
                    if (event.reason === "manual") {
                        this.showError("Compaction cancelled")
                    } else {
                        this.showStatus("Auto-compaction cancelled")
                    }
                } else if (event.result) {
                    this.rebuildChatFromMessages()
                    this.addMessageToChat(
                        createCompactionSummaryMessage(
                            event.result.summary,
                            event.result.tokensBefore,
                            new Date().toISOString(),
                        ),
                    )
                    this.footer.invalidate()
                } else if (event.errorMessage) {
                    this.showError(event.errorMessage)
                }
                break
            }

            case "auto_retry_start": {
                // Set up escape to abort retry
                this.retryEscapeHandler = this.editor.onEscape
                this.editor.onEscape = () => {
                    this.session.abortRetry()
                }
                // Show retry indicator
                this.statusContainer.clear()
                this.retryCountdown?.dispose()
                const retryMessage = (seconds: number) =>
                    `Retrying (${event.attempt}/${event.maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`
                this.retryLoader = new Loader(
                    this.ui,
                    (spinner) => theme.fg("warning", spinner),
                    (text) => theme.fg("muted", text),
                    retryMessage(Math.ceil(event.delayMs / 1000)),
                )
                this.retryCountdown = new CountdownTimer(
                    event.delayMs,
                    this.ui,
                    (seconds) => {
                        this.retryLoader?.setMessage(retryMessage(seconds))
                    },
                    () => {
                        this.retryCountdown = undefined
                    },
                )
                this.statusContainer.addChild(this.retryLoader)
                this.ui.requestRender()
                break
            }

            case "auto_retry_end": {
                // Restore escape handler
                if (this.retryEscapeHandler) {
                    this.editor.onEscape = this.retryEscapeHandler
                    this.retryEscapeHandler = undefined
                }
                if (this.retryCountdown) {
                    this.retryCountdown.dispose()
                    this.retryCountdown = undefined
                }
                // Stop loader
                if (this.retryLoader) {
                    this.retryLoader.stop()
                    this.retryLoader = undefined
                    this.statusContainer.clear()
                }
                // Show error only on final failure (success shows normal response)
                if (!event.success) {
                    this.showError(
                        `Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
                    )
                }
                break
            }

            case "agent_end": {
                if (terminalConfig?.showTerminalProgress) {
                    this.ui.terminal.setProgress(false)
                }
                this.stopWorkingLoader()
                break
            }
        }
        this.ui.requestRender()
    }

    private addMessageToChat(message: AgentMessage): void {
        switch (message.role) {
            case "user": {
                const textContent = this.getUserMessageText(message)
                if (textContent) {
                    this.messageComponent.writePart("prompt", textContent)
                }
                break
            }
            case "assistant": {
                this.renderAssistantContent(message as AssistantMessage)
                break
            }
            case "compactionSummary": {
                const tokenStr = message.tokensBefore.toLocaleString()
                const header = `**Compacted from ${tokenStr} tokens**\n\n`
                this.messageComponent.writePart("compact", header + message.summary)
                break
            }
            case "toolResult": {
                this.messageComponent.writeLine(
                    "tool_result",
                    typeof message.content === "string"
                        ? message.content
                        : JSON.stringify(message.content),
                )
                break
            }
        }
    }

    private renderAssistantContent(message: AssistantMessage) {
        for (const item of message.content) {
            if (isThinkingContent(item)) {
                this.messageComponent.switchBlock("think")
                this.messageComponent.writeText(item.thinking)
            } else if (isTextContent(item)) {
                this.messageComponent.switchBlock("text")
                this.messageComponent.writeText(item.text)
            } else if (isToolCall(item)) {
                this.messageComponent.writeLine(
                    "toolcall",
                    `${item.name}: ${JSON.stringify(item.arguments)}`,
                )
            }
        }
    }

    /** Extract text content from a user message */
    private getUserMessageText(message: Message): string {
        if (message.role !== "user") return ""
        const textBlocks =
            typeof message.content === "string"
                ? [{ type: "text", text: message.content }]
                : message.content.filter((c: { type: string }) => c.type === "text")
        return textBlocks.map((c) => (c as { text: string }).text).join("")
    }

    updatePendingMessagesDisplay(): void {
        this.pendingMessagesContainer.clear()
        const { steering: steeringMessages, followUp: followUpMessages } =
            this.getAllQueuedMessages()
        if (steeringMessages.length > 0 || followUpMessages.length > 0) {
            this.pendingMessagesContainer.addChild(new Spacer(1))
            for (const message of steeringMessages) {
                const text = theme.fg("dim", `Steering: ${message}`)
                this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0))
            }
            for (const message of followUpMessages) {
                const text = theme.fg("dim", `Follow-up: ${message}`)
                this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0))
            }
        }
    }

    /**
     * Get all queued messages (read-only).
     * Combines session queue and compaction queue.
     */
    private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
        return {
            steering: [
                ...this.session.getSteeringMessages(),
                ...this.compactionQueuedMessages
                    .filter((msg) => msg.mode === "steer")
                    .map((msg) => msg.text),
            ],
            followUp: [
                ...this.session.getFollowUpMessages(),
                ...this.compactionQueuedMessages
                    .filter((msg) => msg.mode === "followUp")
                    .map((msg) => msg.text),
            ],
        }
    }

    // 负责UI层 把这些消息重新放回输入框(Editor)，必要时中断当前 Agent
    restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
        const { steering, followUp } = this.clearAllQueues()
        const allQueued = [...steering, ...followUp]
        if (allQueued.length === 0) {
            this.updatePendingMessagesDisplay()
            if (options?.abort) {
                this.agent.abort()
            }
            return 0
        }
        const queuedText = allQueued.join("\n\n")
        const currentText = options?.currentText ?? this.editor.getText()
        const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n")
        this.editor.setText(combinedText)
        this.updatePendingMessagesDisplay()
        if (options?.abort) {
            this.agent.abort()
        }
        return allQueued.length
    }

    /**
     * Clear all queued messages and return their contents.
     * Clears both session queue and compaction queue.
     * 负责数据层 把所有待处理消息取出来并清空队列
     */
    clearAllQueues(): { steering: string[]; followUp: string[] } {
        const { steering, followUp } = this.session.clearQueue()
        const compactionSteering = this.compactionQueuedMessages
            .filter((msg) => msg.mode === "steer")
            .map((msg) => msg.text)
        const compactionFollowUp = this.compactionQueuedMessages
            .filter((msg) => msg.mode === "followUp")
            .map((msg) => msg.text)
        this.compactionQueuedMessages = []
        return {
            steering: [...steering, ...compactionSteering],
            followUp: [...followUp, ...compactionFollowUp],
        }
    }

    clearEditor(): void {
        this.editor.setText("")
        this.ui.requestRender()
    }

    stopWorkingLoader(): void {
        if (this.loadingAnimation) {
            this.loadingAnimation.stop()
            this.loadingAnimation = undefined
        }
        this.statusContainer.clear()
    }

    private createWorkingLoader(): Loader {
        return new Loader(
            this.ui,
            (spinner) => theme.fg("accent", spinner),
            (text) => theme.fg("muted", text),
            this.workingMessage,
            this.workingIndicatorOptions,
        )
    }

    updateEditorBorderColor(): void {
        const level = this.session.thinkingLevel || "off"
        this.editor.borderColor = theme.getThinkingBorderColor(level)
        this.ui.requestRender()
    }

    /**
     * Show a status message in the chat.
     *
     * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
     * we update the previous status line instead of appending new ones to avoid log spam.
     */
    showStatus(message: string): void {
        this.messageComponent.showStatus(message)
        this.ui.requestRender()
    }

    showError(errorMessage: string): void {
        this.messageComponent.showError(errorMessage)
        this.ui.requestRender()
    }

    showWarning(warnMessage: string): void {
        this.messageComponent.showWarning(warnMessage)
        this.ui.requestRender()
    }

    showTips(message: string): void {
        this.messageComponent.writePart("tips", message)
        this.ui.requestRender()
    }
}
