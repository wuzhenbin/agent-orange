import MCPClient from "../mcp-client.ts"
import MCPToolRouter from "../mcp-router.ts"
import { AgentTool } from "../types.ts"
import { Agent } from "../agent.ts"
import { SessionManager } from "../session-manager.ts"
import { AgentSession } from "../session.ts"

import { ResourceLoader } from "../resource-loader.ts"
import { buildSystemPrompt } from "../system-prompt.ts"
import { loadSkills } from "../skills.ts"
import { createTools } from "../tool-register.ts"
import { ModelRegistry } from "../model-registry.ts"
import { SettingsManager } from "../settings-manager.ts"
import {
    AgentDefinition,
    AgentInstance,
    CreateAgentOptions,
    AgentRuntime,
    AgentBuildContext,
} from "./types.ts"

function createAgentId(profileName: string) {
    return `${profileName}-${crypto.randomUUID().slice(0, 8)}`
}

export class AgentInstanceFactory {
    constructor(
        private cwd: string,
        private modelRegistry: ModelRegistry,
        private settingsManager: SettingsManager,
        private mcpRouter: MCPToolRouter,
        private resourceLoader: ResourceLoader,
    ) {}

    async buildDefinition(profile: string, options?: AgentBuildContext): Promise<AgentDefinition> {
        const profileConfig = await this.resourceLoader.getAgentProfileConfig(profile)
        const agentsConfig = options?.orchestrator
            ? await this.resourceLoader.getAllAgentProfiles()
            : {}
        const pluginConfig = await this.resourceLoader.getPluginConfig()
        const { developer_instructions, description, mcps, tools, skills } = profileConfig

        const useMcps = await this.initMcp(mcps ?? [], pluginConfig.mcpServers)
        const useSkills = this.getSkills(pluginConfig.skillsPaths, skills ?? [])
        let useTools = this.buildToolPool(tools ?? [], mcps ?? [])
        const contextFiles = this.resourceLoader.getContextRule(this.cwd)

        const systemPrompt = buildSystemPrompt({
            orchestrator: options?.orchestrator ?? false,
            agentsConfig,
            basePrompt: developer_instructions,
            cwd: this.cwd,
            contextFiles,
            skills: useSkills,
        })
        return {
            name: profile,
            description,
            systemPrompt,
            useTools,
            useSkills,
            useMcps,
            contextFiles,
        }
    }

    async createAgentInstance(
        definition: AgentDefinition,
        extraTools: AgentTool[] = [],
        sessionPersist: boolean,
    ): Promise<AgentInstance> {
        const sessionManager = SessionManager.create(this.cwd, undefined, {
            persist: sessionPersist,
        })
        const defaultModel = this.settingsManager.get("defaultModel")
        const tools = [...(definition.useTools ?? []), ...extraTools]
        const agent = this.createAgent({
            systemPrompt: definition.systemPrompt ?? "",
            tools,
            model: this.modelRegistry.getModel(defaultModel.provider, defaultModel.model),
            getApiKey: (provider) => this.modelRegistry.getApiKey(provider),
            sessionId: sessionManager.getSessionId(),
        })
        const session = new AgentSession({
            agent,
            sessionManager,
            settingsManager: this.settingsManager,
            modelRegistry: this.modelRegistry,
        })
        return {
            id: createAgentId(definition.name),
            definition,
            runtime: {
                agent,
                session,
                sessionManager,
            },
        }
    }

    async createRuntime(
        definition: AgentDefinition,
        sessionManager: SessionManager,
    ): Promise<AgentRuntime> {
        const defaultModel = this.settingsManager.get("defaultModel")
        const agent = this.createAgent({
            systemPrompt: definition.systemPrompt ?? "",
            tools: definition.useTools ?? [],
            model: this.modelRegistry.getModel(defaultModel.provider, defaultModel.model),
            getApiKey: (provider) => this.modelRegistry.getApiKey(provider),
            sessionId: sessionManager.getSessionId(),
        })
        const session = new AgentSession({
            agent,
            sessionManager,
            settingsManager: this.settingsManager,
            modelRegistry: this.modelRegistry,
        })
        return {
            agent,
            session,
            sessionManager,
        }
    }

    private buildToolPool(useTools: string[], useMcps: string[]): AgentTool[] {
        const tools = createTools(this.cwd, useTools)
        const useMcpTools = this.mcpRouter.getToolsByMcpNames(useMcps)
        const native = new Set(tools.map((t) => t.name))
        for (const mcpTool of useMcpTools) {
            if (!native.has(mcpTool.name)) {
                tools.push(mcpTool)
            }
        }
        return tools
    }

    getSkills(skillsPaths: string[], useSkills: string[]) {
        return loadSkills(skillsPaths).filter((skill) => useSkills.includes(skill.name))
    }

    private async initMcp(useMcps: string[], mcpServers: Record<string, any>): Promise<string[]> {
        if (!useMcps.length) {
            return []
        }
        let mcpResult = []
        for (const name of useMcps) {
            if (this.mcpRouter.hasClient(name)) {
                mcpResult.push(name)
                continue
            }
            const config = mcpServers[name as keyof typeof mcpServers]
            if (!config) {
                continue
            }
            const mcpClient = new MCPClient(name, config.command, config.args)
            try {
                await mcpClient.connectToServer()
                this.mcpRouter.registerClient(mcpClient)
                mcpResult.push(name)
            } catch (err) {
                console.error(`MCP ${name} failed`, err)
            }
        }
        return mcpResult
    }

    createAgent({
        getApiKey,
        systemPrompt = "",
        model,
        tools = [],
        sessionId,
    }: CreateAgentOptions): Agent {
        return new Agent({
            getApiKey,
            initialState: {
                systemPrompt,
                model,
                tools,
            },
            sessionId,
        })
    }
}
