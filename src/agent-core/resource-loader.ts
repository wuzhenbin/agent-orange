import { promises as fs } from "node:fs"
import TOML from "@iarna/toml"
import { getPluginPath, getSkillsPath, getAgentsDir } from "../config/path-config.ts"
import {
    PluginConfig,
    loadContextFiles,
    defaultAgentProfile,
    AgentProfileSchema,
    AgentProfileConfig,
    AgentConfig,
} from "./resource-loader-helper.ts"
import { dirname, join } from "node:path"
import { Value } from "typebox/value"

const defaultPluginManifest: PluginConfig = {
    skillsPaths: [getSkillsPath()],
    mcpServers: {},
}

export class ResourceLoader {
    readonly pluginPath = getPluginPath()
    readonly agentsDir = getAgentsDir()

    getContextRule(cwd: string): Array<{ path: string; content: string }> {
        return loadContextFiles(cwd)
    }

    async getPluginConfig(): Promise<PluginConfig> {
        try {
            await this.ensurePluginConfig(this.pluginPath, defaultPluginManifest)
            const raw = await fs.readFile(this.pluginPath, "utf-8")
            const manifest = JSON.parse(raw)
            return {
                skillsPaths: manifest?.skillsPaths ?? [],
                mcpServers: manifest?.mcpServers ?? {},
            }
        } catch (e) {
            console.error(`[Plugin] Failed to load ${this.pluginPath}:`, e)
            return defaultPluginManifest
        }
    }

    private async ensurePluginConfig(configPath: string, defaultConfig: object) {
        try {
            await fs.access(configPath)
        } catch {
            await fs.mkdir(dirname(configPath), {
                recursive: true,
            })
            await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 4) + "\n", "utf-8")
        }
    }

    async getAgentProfileConfig(profile = "default"): Promise<AgentProfileConfig> {
        const agentPath = join(this.agentsDir, `${profile}.toml`)
        await this.ensureAgentProfile(agentPath, defaultAgentProfile)
        const raw = await fs.readFile(agentPath, "utf-8")
        const config = TOML.parse(raw)
        if (!Value.Check(AgentProfileSchema, config)) {
            throw new Error(`[Agent] Invalid config: ${agentPath}`)
        }
        return config
    }

    async getAllAgentProfiles(): Promise<AgentConfig> {
        await fs.mkdir(this.agentsDir, {
            recursive: true,
        })
        const files = await fs.readdir(this.agentsDir)
        const configs: AgentConfig = {}
        for (const file of files) {
            if (!file.endsWith(".toml") || file.endsWith("default.toml")) {
                continue
            }
            const profile = file.replace(/\.toml$/, "")
            configs[profile] = await this.getAgentProfileConfig(profile)
        }
        return configs
    }

    private async ensureAgentProfile(configPath: string, defaultConfig: AgentProfileConfig) {
        try {
            await fs.access(configPath)
            return
        } catch {
            await fs.mkdir(dirname(configPath), {
                recursive: true,
            })
            await fs.writeFile(configPath, TOML.stringify(defaultConfig), "utf-8")
        }
    }
}
