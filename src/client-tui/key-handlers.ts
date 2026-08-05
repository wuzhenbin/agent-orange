import { InteractiveMode } from "./interact.ts"
import { killTrackedDetachedChildren } from "../utils/shell.ts"
import { isDeadTerminalError } from "./helper.ts"

export default class KeyHandlers {
    private app: InteractiveMode
    /**
     * Gracefully shutdown the agent.
     * Stops the TUI before emitting shutdown events so extension UI cleanup cannot
     * repaint the final frame while the process is exiting.
     */
    private isShuttingDown = false
    private lastSigintTime = 0
    private signalCleanupHandlers: Array<() => void> = []

    private get uiManager() {
        return this.app.uiManager
    }
    private get commandHandlers() {
        return this.app.commandHandlers
    }
    private get agentContext() {
        return this.app.agentContext
    }
    private get session() {
        return this.agentContext.session
    }
    private get selectorHandles() {
        return this.app.selectorHandles
    }
    private get settingsManager() {
        return this.agentContext.settingsManager
    }

    constructor(app: InteractiveMode) {
        this.app = app
    }

    setupKeyHandlers(): void {
        // Set up handlers on defaultEditor - they use this.editor for text access
        // so they work correctly regardless of which editor is active
        this.uiManager.editor.onEscape = () => {
            if (this.session.isStreaming) {
                this.uiManager.restoreQueuedMessagesToEditor({ abort: true })
            }
        }

        // Register app action handlers
        this.uiManager.editor.onAction("app.clear", () => this.handleCtrlC())
        this.uiManager.editor.onCtrlD = () => this.handleCtrlD()
        this.uiManager.editor.onChange = (text: string) => {}
    }

    setupEditorSubmitHandler(): void {
        this.uiManager.editor.onSubmit = async (text: string) => {
            text = text.trim()
            if (!text) return

            if (text === "/new") {
                this.uiManager.editor.setText("")
                await this.commandHandlers.handleClearCommand()
                return
            }

            if (text === "/model" || text.startsWith("/model ")) {
                const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined
                this.uiManager.editor.setText("")
                await this.selectorHandles.handleModelCommand(searchTerm)
                return
            }

            if (text === "/name" || text.startsWith("/name ")) {
                this.commandHandlers.handleNameCommand(text)
                this.uiManager.editor.setText("")
                return
            }

            if (text === "/resume") {
                this.selectorHandles.showSessionSelector()
                this.uiManager.editor.setText("")
                return
            }

            if (text === "/compact" || text.startsWith("/compact ")) {
                const instructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined
                this.uiManager.editor.setText("")
                await this.commandHandlers.handleCompactCommand(instructions)
                return
            }

            if (text === "/quit") {
                this.uiManager.editor.setText("")
                await this.shutdown()
                return
            }

            // If streaming, use prompt() with steer behavior
            if (this.session.isStreaming) {
                this.uiManager.editor.addToHistory?.(text)
                this.uiManager.editor.setText("")
                await this.session.prompt(text, { streamingBehavior: "steer" })
                this.uiManager.updatePendingMessagesDisplay()
                this.uiManager.ui.requestRender()
                return
            }

            if (this.app.onInputCallback) {
                this.app.onInputCallback(text)
            }
            this.uiManager.editor.addToHistory?.(text)
        }
    }

    private handleCtrlC(): void {
        const now = Date.now()
        if (now - this.lastSigintTime < 500) {
            void this.shutdown()
        } else {
            this.uiManager.clearEditor()
            this.lastSigintTime = now
        }
    }

    private handleCtrlD(): void {
        void this.shutdown()
    }

    async stop() {
        const terminalConfig = this.settingsManager.get("terminal")
        if (terminalConfig?.showTerminalProgress) {
            this.uiManager.ui.terminal.setProgress(false)
        }
        if (this.uiManager.loadingAnimation) {
            this.uiManager.loadingAnimation.stop()
            this.uiManager.loadingAnimation = undefined
        }
        if (this.uiManager.unsubscribe) {
            this.uiManager.unsubscribe()
        }
        if (this.uiManager.unsubscribeSubagent) {
            this.uiManager.unsubscribeSubagent()
        }
        if (this.uiManager.isInitialized) {
            this.uiManager.ui.stop()
            this.uiManager.isInitialized = false
        }
        //  Cleanup MCP connections
        await this.agentContext.dispose()

        this.unregisterSignalHandlers()
    }

    registerSignalHandlers(): void {
        this.unregisterSignalHandlers()

        const signals: NodeJS.Signals[] = ["SIGTERM"]
        if (process.platform !== "win32") {
            signals.push("SIGHUP")
        }

        for (const signal of signals) {
            const handler = () => {
                // SIGHUP no longer hard-exits: graceful shutdown emits session_shutdown
                // first, then attempts terminal restore. A genuinely dead terminal
                // surfaces as an EIO on the restore writes, which the stdout/stderr
                // error handler converts into emergencyTerminalExit (see #4144, #5080).
                killTrackedDetachedChildren()
                void this.shutdown({ fromSignal: true })
            }
            process.prependListener(signal, handler)
            this.signalCleanupHandlers.push(() => process.off(signal, handler))
        }

        const terminalErrorHandler = (error: Error) => {
            if (isDeadTerminalError(error)) {
                this.emergencyTerminalExit()
            }
            throw error
        }
        process.stdout.on("error", terminalErrorHandler)
        process.stderr.on("error", terminalErrorHandler)
        this.signalCleanupHandlers.push(() => process.stdout.off("error", terminalErrorHandler))
        this.signalCleanupHandlers.push(() => process.stderr.off("error", terminalErrorHandler))

        // Restore the terminal before the process dies on any uncaught throw.
        // Without this, an unhandled exception from extension code (or anywhere
        // in pi) leaves the terminal in raw mode with no cursor.
        const uncaughtExceptionHandler = (error: Error) => this.uncaughtCrash(error)
        process.prependListener("uncaughtException", uncaughtExceptionHandler)
        this.signalCleanupHandlers.push(() =>
            process.off("uncaughtException", uncaughtExceptionHandler),
        )
    }

    /**
     * Last-resort handler for uncaught exceptions. The TUI puts stdin into raw
     * mode and hides the cursor; without this handler, an uncaught throw from
     * anywhere (e.g. an extension's async `ChildProcess.on("exit")` callback)
     * tears down the process while leaving the terminal in raw mode with no
     * cursor, requiring `stty sane && reset` to recover.
     *
     * Unlike emergencyTerminalExit, the terminal is still alive here, so we
     * call ui.stop() to restore cooked mode, the cursor, and disable bracketed
     * paste / Kitty / modifyOtherKeys sequences.
     */
    private uncaughtCrash(error: Error): never {
        if (this.isShuttingDown) {
            process.exit(1)
        }
        this.isShuttingDown = true
        try {
            this.unregisterSignalHandlers()
        } catch {}
        try {
            killTrackedDetachedChildren()
        } catch {}
        try {
            this.uiManager.ui.stop()
        } catch {}
        console.error("pi exiting due to uncaughtException:")
        console.error(error)
        process.exit(1)
    }

    private unregisterSignalHandlers(): void {
        for (const cleanup of this.signalCleanupHandlers) {
            cleanup()
        }
        this.signalCleanupHandlers = []
    }

    private emergencyTerminalExit(): never {
        this.isShuttingDown = true
        this.unregisterSignalHandlers()
        killTrackedDetachedChildren()
        // The terminal is gone. Do not run normal shutdown because TUI and
        // extension cleanup can write restore sequences and re-trigger EIO.
        process.exit(129)
    }

    async shutdown(options?: { fromSignal?: boolean }): Promise<void> {
        if (this.isShuttingDown) return
        this.isShuttingDown = true

        if (options?.fromSignal) {
            await this.uiManager.ui.terminal.drainInput(1000)
            this.stop()
            process.exit(0)
        }

        await this.uiManager.ui.terminal.drainInput(1000)

        this.stop()
        process.exit(0)
    }
}
