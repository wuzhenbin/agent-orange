import { SessionManager } from "../session-manager.ts"
import { Agent } from "../agent.ts"
import { Model } from "../../agent-ai/types.ts"
import { AgentTool } from "../types.ts"
import { Skill } from "../skills.ts"
import { AgentSession } from "../session.ts"

export interface AgentBuildContext {
    orchestrator?: boolean
    sessionPersist?: boolean
}

export interface CreateAgentOptions {
    getApiKey: (provider: string) => Promise<string | undefined> | string | undefined
    systemPrompt: string
    model: Model<any> | undefined
    tools: AgentTool<any, any>[]
    sessionId: string
}

export interface AgentRuntime {
    agent: Agent
    session: AgentSession
    sessionManager: SessionManager
}

export interface AgentDefinition {
    name: string
    description: string
    systemPrompt?: string
    model?: Model<any>
    useTools?: AgentTool[]
    useSkills?: Skill[]
    useMcps?: string[]
    contextFiles?: Array<{ path: string; content: string }>
}

export interface AgentInstance {
    id: string
    definition: AgentDefinition
    runtime: AgentRuntime
}

export interface SubAgentEvents {
    start: {
        agentId: string
        agentName: string
        task: string
    }

    tool_call: {
        agentId: string
        tool: string
        arguments: string
    }

    tool_result: {
        agentId: string
        result: string
    }

    end: {
        agentId: string
        message: string
    }
}
