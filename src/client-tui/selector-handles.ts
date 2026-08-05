import { type Component } from "@earendil-works/pi-tui"
import { InteractiveMode } from "./interact.ts"
import { SessionManager } from "../agent-core/session-manager.ts"
import { SessionSelectorComponent } from "./components/session-selector.ts"
import { ModelSelectorComponent } from "./components/model-selector.ts"
import { Model } from "../agent-ai/index.ts"
import { findExactModelReferenceMatch } from "../agent-core/model-resolver.ts"

export default class SelectorHandles {
    private app: InteractiveMode

    private get uiManager() {
        return this.app.uiManager
    }
    private get commandHandlers() {
        return this.app.commandHandlers
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
    private get modelRegistry() {
        return this.agentContext.modelRegistry
    }

    constructor(app: InteractiveMode) {
        this.app = app
    }

    /**
     * Shows a selector component in place of the editor.
     * @param create Factory that receives a `done` callback and returns the component and focus target
     */
    private showSelector(
        create: (done: () => void) => { component: Component; focus: Component },
    ): void {
        const done = () => {
            this.uiManager.editorContainer.clear()
            this.uiManager.editorContainer.addChild(this.uiManager.editor)
            this.uiManager.ui.setFocus(this.uiManager.editor)
        }
        const { component, focus } = create(done)
        this.uiManager.editorContainer.clear()
        this.uiManager.editorContainer.addChild(component)
        this.uiManager.ui.setFocus(focus)
        this.uiManager.ui.requestRender()
    }

    showSessionSelector(): void {
        this.showSelector((done) => {
            const selector = new SessionSelectorComponent(
                (onProgress) => SessionManager.listAll(this.sessionManager.getCwd(), onProgress),
                (onProgress) => SessionManager.listAll("", onProgress),
                async (sessionPath) => {
                    done()
                    await this.handleResumeSession(sessionPath)
                },
                () => {
                    done()
                    this.uiManager.ui.requestRender()
                },
                () => {
                    void this.keyHandles.shutdown()
                },
                () => this.uiManager.ui.requestRender(),
                {
                    renameSession: async (
                        sessionFilePath: string,
                        nextName: string | undefined,
                    ) => {
                        const next = (nextName ?? "").trim()
                        if (!next) return
                        const mgr = SessionManager.open(sessionFilePath)
                        mgr.appendSessionInfo(next)
                    },
                    showRenameHint: true,
                    keybindings: this.uiManager.keybindings,
                },

                this.sessionManager.getSessionFile(),
            )
            return { component: selector, focus: selector }
        })
    }

    async handleResumeSession(sessionPath: string) {
        try {
            const result = await this.agentContext.switchSession(sessionPath)
            if (result.success) {
                this.uiManager.rebindCurrentSession()
                this.uiManager.renderCurrentSessionState()
                this.uiManager.showStatus("Resumed session")
            } else {
                this.uiManager.showError(`Resumed session failed, ${result.reason}`)
            }
        } catch (error: unknown) {
            return this.commandHandlers.handleFatalRuntimeError("Failed to resume session", error)
        }
    }

    async handleModelCommand(searchTerm?: string): Promise<void> {
        if (!searchTerm) {
            this.showModelSelector()
            return
        }

        const model = await this.findExactModelMatch(searchTerm)
        if (model) {
            try {
                await this.session.setModel(model)
                this.uiManager.updateEditorBorderColor()
                this.uiManager.showStatus(`Model: ${model.id}`)
            } catch (error) {
                this.uiManager.showError(error instanceof Error ? error.message : String(error))
            }
            return
        }

        this.showModelSelector(searchTerm)
    }

    private async findExactModelMatch(searchTerm: string): Promise<Model<any> | undefined> {
        this.modelRegistry.refresh()
        const models = this.modelRegistry.getAll()
        return findExactModelReferenceMatch(searchTerm, models)
    }

    showModelSelector(initialSearchInput?: string): void {
        this.showSelector((done) => {
            const selector = new ModelSelectorComponent(
                this.uiManager.ui,
                this.session.model,
                this.modelRegistry,
                async (model) => {
                    try {
                        await this.session.setModel(model)
                        this.uiManager.updateEditorBorderColor()
                        done()
                        this.uiManager.showStatus(`Model: ${model.id}`)
                    } catch (error) {
                        done()
                        this.uiManager.showError(
                            error instanceof Error ? error.message : String(error),
                        )
                    }
                },
                () => {
                    done()
                    this.uiManager.ui.requestRender()
                },
                initialSearchInput,
            )
            return { component: selector, focus: selector }
        })
    }
}
