import { SessionManager } from "../session-manager.ts"
import { existsSync } from "node:fs"
import { AgentContextParams } from "./agent-context-builder.ts"
import { AgentInstance } from "./types.ts"

export interface switchSessionResult {
    success: boolean
    reason?: string
}

export class AgentContext {
    get cwd() {
        return this.params.cwd
    }
    get agentManager() {
        return this.params.agentManager
    }
    get activeAgent() {
        return this.getActiveAgent()
    }
    get definition() {
        return this.activeAgent.definition
    }
    get agent() {
        return this.activeAgent.runtime.agent
    }
    get session() {
        return this.activeAgent.runtime.session
    }
    get sessionManager() {
        return this.activeAgent.runtime.sessionManager
    }
    get services() {
        return this.params.services
    }
    get modelRegistry() {
        return this.services.modelRegistry
    }
    get settingsManager() {
        return this.services.settingsManager
    }
    get mcpRouter() {
        return this.services.mcpRouter
    }

    constructor(private readonly params: AgentContextParams) {}

    getAgent(agentId: string): AgentInstance {
        const agent = this.agentManager.get(agentId)
        if (!agent) {
            throw new Error(`Agent not found: ${agentId}`)
        }
        return agent
    }

    getActiveAgent(): AgentInstance {
        return this.getAgent(this.params.activeAgentId)
    }

    async newSession() {
        const current = this.activeAgent
        const sessionManager = current.runtime.sessionManager.isPersisted()
            ? SessionManager.create(this.cwd, undefined, { persist: true })
            : SessionManager.inMemory(this.cwd)
        await this.agentManager.replaceAgentSession(current.id, sessionManager)
    }

    async switchSession(sessionPath: string): Promise<switchSessionResult> {
        const sessionManager = SessionManager.open(sessionPath)
        if (!sessionManager.getSessionFile()) {
            return {
                success: false,
                reason: "Session file not found",
            }
        }
        const sessionCwd = sessionManager.getCwd()
        if (!sessionCwd) {
            return {
                success: false,
                reason: "Session working directory is missing",
            }
        }
        if (!existsSync(sessionCwd)) {
            return {
                success: false,
                reason: `Session working directory does not exist: ${sessionCwd}`,
            }
        }
        await this.agentManager.replaceAgentSession(this.params.activeAgentId, sessionManager)
        return { success: true }
    }

    async dispose() {
        this.agentManager.clear()
        await Promise.allSettled([...this.mcpRouter.clients.values()].map((c) => c.close()))
    }
}
