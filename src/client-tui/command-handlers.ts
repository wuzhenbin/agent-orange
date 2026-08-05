import { InteractiveMode } from "./interact.ts"

export default class CommandHandlers {
    private app: InteractiveMode

    private get uiManager() {
        return this.app.uiManager
    }
    private get keyHandles() {
        return this.app.keyHandles
    }
    private get agentContext() {
        return this.app.agentContext
    }
    private get sessionManager() {
        return this.agentContext.sessionManager
    }
    private get session() {
        return this.agentContext.session
    }

    constructor(app: InteractiveMode) {
        this.app = app
    }

    async handleClearCommand(): Promise<void> {
        try {
            await this.agentContext.newSession()
            this.uiManager.rebindCurrentSession()
            this.uiManager.renderCurrentSessionState()
            this.uiManager.showTips(`✓ New session started`)
        } catch (error: unknown) {
            await this.handleFatalRuntimeError("Failed to create session", error)
        }
    }

    handleNameCommand(text: string): void {
        const name = text.replace(/^\/name\s*/, "").trim()
        if (!name) {
            const currentName = this.sessionManager.getSessionName()
            if (currentName) {
                this.uiManager.showStatus(`Session name: ${currentName}`)
            } else {
                this.uiManager.showWarning("Usage: /name <name>")
            }
            return
        }

        this.session.setSessionName(name)
        this.uiManager.showStatus(`Session name set: ${name}`)
    }

    async handleCompactCommand(instructions?: string): Promise<void> {
        this.uiManager.stopWorkingLoader()
        try {
            await this.session.compact(instructions)
        } catch {
            // Ignore, will be emitted as an event
        }
    }

    async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
        const message = error instanceof Error ? error.message : String(error)
        this.uiManager.showError(`${prefix}: ${message}`)
        this.keyHandles.stop()
        process.exit(1)
    }
}
