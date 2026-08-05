import { SessionManager } from "../session-manager.ts"
import { AgentInstanceFactory } from "./agent-instance-factory.ts"
import { AgentInstance, AgentBuildContext, SubAgentEvents } from "./types.ts"
import { createAgentTools } from "../tool-register.ts"
import { TypedEventEmitter } from "../../utils/event-emit.ts"

export interface AgentExecutionResult {
    text: string
}

export class AgentManager {
    private agents = new Map<string, AgentInstance>()
    readonly events = new TypedEventEmitter<SubAgentEvents>()

    constructor(
        private cwd: string,
        private factory: AgentInstanceFactory,
    ) {}

    emit<K extends keyof SubAgentEvents>(event: K, payload: SubAgentEvents[K]) {
        this.events.emit(event, payload)
    }

    async create(profile: string, agentBuildContext?: AgentBuildContext): Promise<AgentInstance> {
        const definition = await this.factory.buildDefinition(profile, agentBuildContext)
        const agentTools = agentBuildContext?.orchestrator ? createAgentTools(this.cwd, this) : []
        const instance = await this.factory.createAgentInstance(
            definition,
            agentTools,
            agentBuildContext?.sessionPersist ?? false,
        )
        this.agents.set(instance.id, instance)
        return instance
    }

    async createSubagentExcute(profile: string, task: string): Promise<AgentExecutionResult> {
        const instance = await this.create(profile)
        const agentId = instance.id

        return new Promise(async (resolve, reject) => {
            const session = instance.runtime.session
            let startTime = 0
            let toolCallCount = 0

            const unsubscribe = session.subscribe(async (event) => {
                switch (event.type) {
                    case "agent_start":
                        startTime = Date.now()
                        this.emit("start", {
                            agentId,
                            agentName: profile,
                            task,
                        })
                        break

                    case "message_update":
                        const e = event.assistantMessageEvent
                        switch (e.type) {
                            case "toolcall_end":
                                toolCallCount++
                                this.emit("tool_call", {
                                    agentId,
                                    tool: e.toolCall.name,
                                    arguments: JSON.stringify(e.toolCall.arguments),
                                })
                                break
                        }
                        break

                    case "tool_execution_end": {
                        this.emit("tool_result", {
                            agentId,
                            result: JSON.stringify(event.result),
                        })
                        break
                    }

                    case "agent_end":
                        const msg = event.messages.findLast((m) => m.role === "assistant")
                        const text =
                            msg?.content
                                .filter((x) => x.type === "text")
                                .map((x) => x.text)
                                .join("") ?? ""

                        const duration =
                            startTime > 0 ? Math.floor((Date.now() - startTime) / 1000) : 0
                        const totalTokens = msg?.usage?.totalTokens ?? 0

                        unsubscribe()
                        await session.dispose()
                        this.emit("end", {
                            agentId,
                            message: `${toolCallCount} tools use · ${totalTokens} tokens · ${duration}s`,
                        })
                        resolve({
                            text,
                        })
                        break
                }
            })

            try {
                await session.prompt(task)
            } catch (err) {
                unsubscribe()
                reject(err)
            }
        })
    }

    async replaceAgentSession(agentId: string, sessionManager: SessionManager) {
        const instance = this.get(agentId)
        if (!instance) {
            throw new Error(`Agent session not found: ${agentId}`)
        }
        const runtime = await this.factory.createRuntime(instance.definition, sessionManager)
        instance.runtime.session.dispose()
        instance.runtime = runtime
    }

    get(id: string): AgentInstance | undefined {
        return this.agents.get(id)
    }

    has(id: string): boolean {
        return this.agents.has(id)
    }

    dispose(id: string): boolean {
        const instance = this.agents.get(id)
        if (!instance) {
            return false
        }
        instance.runtime.session.dispose()
        return this.agents.delete(id)
    }

    list(): AgentInstance[] {
        return Array.from(this.agents.values())
    }

    clear() {
        for (const id of this.agents.keys()) {
            this.dispose(id)
        }
    }
}
