/**
 * System prompt construction and project context loading
 */

import { formatSkillsForPrompt, type Skill } from "./skills.ts"
import { getPythonRunDir } from "../config/path-config.ts"
import { formatOrchestratorForPrompt } from "./prompt/orchestrator.ts"
import { pythonProgramInstructions } from "./prompt/program.ts"
import { AgentConfig } from "./resource-loader-helper.ts"

export interface BuildSystemPromptOptions {
    agentsConfig: AgentConfig
    orchestrator: boolean
    /** Custom system prompt  */
    basePrompt: string
    /** Working directory. */
    cwd: string
    /** Pre-loaded skills. */
    skills?: Skill[]
    /** Pre-loaded context files. */
    contextFiles?: Array<{ path: string; content: string }>
    programs?: string[]
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
    const {
        orchestrator,
        agentsConfig,
        basePrompt,
        cwd,
        contextFiles: providedContextFiles,
        skills,
        programs,
    } = options

    const promptCwd = cwd.replace(/\\/g, "/")
    const contextFiles = providedContextFiles ?? []

    let prompt = basePrompt
    if (orchestrator) {
        prompt += `\n${formatOrchestratorForPrompt(agentsConfig)}`
    }

    // python执行环境说明
    if (programs?.includes("python")) {
        const pythonPath = getPythonRunDir()
        prompt += `\n${pythonProgramInstructions(pythonPath)}`
    }

    // Append project context files
    if (contextFiles.length > 0) {
        prompt += "\n\n<project_context>\n\n"
        prompt += "Project-specific instructions and guidelines:\n\n"
        for (const { path: filePath, content } of contextFiles) {
            prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`
        }
        prompt += "</project_context>\n"
    }

    // Append skills section (only if read tool is available)
    if (skills && skills?.length > 0) {
        prompt += formatSkillsForPrompt(skills)
    }

    // Add date and working directory last
    prompt += `\n\nCurrent working directory: ${promptCwd}`
    return prompt
}
