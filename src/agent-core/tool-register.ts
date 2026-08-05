import { createReadTool } from "./tools/read.ts"
import { AgentTool } from "./types.ts"
import { createFindTool } from "./tools/find.ts"
import { createLsTool } from "./tools/ls.ts"
import { createWriteTool } from "./tools/write.ts"
import { createEditTool } from "./tools/edit.ts"
import { createGrepTool } from "./tools/grep.ts"
import { createBashTool } from "./tools/bash.ts"
import { createDelegateTaskTool } from "./tools/agent.ts"
import { AgentManager } from "./agent-runtime/agent-manager.ts"

export const toolsRegister = {
    read: createReadTool,
    find: createFindTool,
    ls: createLsTool,
    write: createWriteTool,
    edit: createEditTool,
    grep: createGrepTool,
    bash: createBashTool,
} as const

export const createTools = (cwd: string, selectTools: string[]): AgentTool[] => {
    return selectTools
        .map((name) => toolsRegister[name as keyof typeof toolsRegister](cwd))
        .filter(Boolean)
}

export const createAgentTools = (cwd: string, agentManager: AgentManager): AgentTool[] => {
    const delegateTaskTool = createDelegateTaskTool({ cwd, agentManager })
    return [delegateTaskTool]
}

export const builtTools = Object.keys(toolsRegister) as Array<keyof typeof toolsRegister>
