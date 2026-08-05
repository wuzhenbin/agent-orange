import chalk from "chalk"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { resolvePath } from "../utils/paths.ts"
import { getGlobalDir } from "../config/path-config.ts"
import { builtTools } from "./tool-register.ts"
import { Type, Static } from "typebox"

export interface PluginConfig {
    skillsPaths: string[]
    mcpServers: Record<string, any>
}

export const AgentProfileSchema = Type.Object({
    name: Type.String(),
    description: Type.String(),
    developer_instructions: Type.String(),
    tools: Type.Optional(Type.Array(Type.String())),
    mcps: Type.Optional(Type.Array(Type.String())),
    skills: Type.Optional(Type.Array(Type.String())),
    programs: Type.Optional(Type.Array(Type.String())),
})
export const AgentConfigSchema = Type.Record(Type.String(), AgentProfileSchema)

export type AgentProfileConfig = Static<typeof AgentProfileSchema>
export type AgentConfig = Static<typeof AgentConfigSchema>

const defaultAgentInstructions =
    "You are a general-purpose AI agent that assists users with software engineering, research, analysis, and problem-solving tasks."

export const defaultAgentProfile: AgentProfileConfig = {
    name: "default",
    description: "general-purpose fallback agent",
    developer_instructions: defaultAgentInstructions,
    tools: builtTools,
    mcps: [],
    skills: [],
    programs: [],
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
    const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]
    for (const filename of candidates) {
        const filePath = join(dir, filename)
        if (existsSync(filePath)) {
            try {
                return {
                    path: filePath,
                    content: readFileSync(filePath, "utf-8"),
                }
            } catch (error) {
                console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`))
            }
        }
    }
    return null
}

export function loadContextFiles(cwd: string): Array<{ path: string; content: string }> {
    const globalDir = getGlobalDir()
    const resolvedCwd = resolvePath(cwd)
    const resolvedGlobalDir = resolvePath(globalDir)

    const contextFiles: Array<{ path: string; content: string }> = []
    const seenPaths = new Set<string>()

    const globalContext = loadContextFileFromDir(resolvedGlobalDir)
    if (globalContext) {
        contextFiles.push(globalContext)
        seenPaths.add(globalContext.path)
    }

    const ancestorContextFiles: Array<{ path: string; content: string }> = []
    let currentDir = resolvedCwd
    const root = resolve("/")

    while (true) {
        const contextFile = loadContextFileFromDir(currentDir)
        if (contextFile && !seenPaths.has(contextFile.path)) {
            ancestorContextFiles.unshift(contextFile)
            seenPaths.add(contextFile.path)
        }
        if (currentDir === root) break
        const parentDir = resolve(currentDir, "..")
        if (parentDir === currentDir) break
        currentDir = parentDir
    }

    contextFiles.push(...ancestorContextFiles)
    return contextFiles
}
