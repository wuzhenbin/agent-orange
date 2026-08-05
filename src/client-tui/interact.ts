import UIManager from "./ui-manager.ts"
import KeyHandlers from "./key-handlers.ts"
import AutoComplete from "./auto-complete.ts"
import CommandHandlers from "./command-handlers.ts"
import SelectorHandles from "./selector-handles.ts"
import { AgentContext } from "../agent-core/agent-runtime/agent-context.ts"

export class InteractiveMode {
    agentContext: AgentContext
    pendingUserInputs: string[] = []
    onInputCallback?: (text: string) => void
    private get session() {
        return this.agentContext.session
    }

    uiManager
    autoComplete
    keyHandles
    commandHandlers
    selectorHandles

    constructor(agentContext: AgentContext) {
        this.agentContext = agentContext
        this.uiManager = new UIManager(this)
        this.keyHandles = new KeyHandlers(this)
        this.autoComplete = new AutoComplete(this)
        this.commandHandlers = new CommandHandlers(this)
        this.selectorHandles = new SelectorHandles(this)
    }

    async run() {
        await this.uiManager.init()
        while (true) {
            const userInput = await this.getUserInput()
            try {
                await this.session.prompt(userInput)
            } catch (error: unknown) {
                const errorMessage =
                    error instanceof Error ? error.message : "Unknown error occurred"
                this.uiManager.messageComponent.writePart("error", errorMessage)
                this.uiManager.showError(errorMessage)
            }
        }
    }

    async getUserInput(): Promise<string> {
        const queuedInput = this.pendingUserInputs.shift()
        if (queuedInput !== undefined) {
            return queuedInput
        }

        return new Promise((resolve) => {
            this.onInputCallback = (text: string) => {
                this.onInputCallback = undefined
                resolve(text)
            }
        })
    }
}
