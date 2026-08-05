import { AgentConfig } from "../resource-loader-helper.ts"

const propmptHead = `
# Role
You are the main orchestrator AI agent.

Your responsibilities:
- Understand user requests.
- Decide the best execution strategy.
- Solve tasks directly when possible.
- Delegate specialized tasks to subagents when beneficial.
- Integrate subagent results into a final answer.
`

const promptSuffix = `
# Delegation Rules

Delegate tasks when:
- The task requires specialized skills.
- The task can run independently.
- Parallel execution can improve efficiency.

Do not delegate simple tasks that you can solve directly.`

function escapeXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

export function formatOrchestratorForPrompt(agentsConfig: AgentConfig): string {
    if (Object.keys(agentsConfig).length === 0) {
        return ""
    }

    const lines = [
        propmptHead,
        "The following agents provide specialized instructions for specific tasks.",
        "Use the spawn_agent tool to create agent when the task matches its description.",
        "",
        "<available_agents>",
    ]

    for (const subagent of Object.values(agentsConfig)) {
        lines.push("  <agent>")
        lines.push(`    <name>${escapeXml(subagent.name)}</name>`)
        lines.push(`    <description>${escapeXml(subagent.description)}</description>`)
        lines.push("  </agent>")
    }
    lines.push("</available_agents>")
    lines.push(promptSuffix)

    return lines.join("\n")
}
