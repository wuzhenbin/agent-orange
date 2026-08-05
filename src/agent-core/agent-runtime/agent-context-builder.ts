import MCPToolRouter from "../mcp-router.ts"
import { ResourceLoader } from "../resource-loader.ts"
import { ModelRegistry } from "../model-registry.ts"
import { SettingsManager } from "../settings-manager.ts"
import { AgentManager } from "./agent-manager.ts"
import { AgentInstanceFactory } from "./agent-instance-factory.ts"

export interface AgentServices {
    settingsManager: SettingsManager
    modelRegistry: ModelRegistry
    mcpRouter: MCPToolRouter
}

export interface AgentContextParams {
    cwd: string
    agentManager: AgentManager
    activeAgentId: string
    services: AgentServices
}

export async function createAgentContextParams(cwd: string): Promise<AgentContextParams> {
    const settingsManager = new SettingsManager()
    const modelRegistry = new ModelRegistry()
    const mcpRouter = new MCPToolRouter()
    const resourceLoader = new ResourceLoader()
    const factory = new AgentInstanceFactory(
        cwd,
        modelRegistry,
        settingsManager,
        mcpRouter,
        resourceLoader,
    )
    const agentManager = new AgentManager(cwd, factory)
    const defaultAgent = await agentManager.create("default", {
        orchestrator: true,
        sessionPersist: true,
    })

    return {
        cwd,
        agentManager,
        activeAgentId: defaultAgent.id,
        services: {
            settingsManager,
            modelRegistry,
            mcpRouter,
        },
    }
}
