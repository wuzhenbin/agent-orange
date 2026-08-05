import { createAgentContextParams } from "./agent-core/agent-runtime/agent-context-builder.ts"
import { AgentContext } from "./agent-core/agent-runtime/agent-context.ts"
import { InteractiveMode } from "./client-tui/interact.ts"

const main = async () => {
    const cwd = process.argv[2] ?? process.cwd()
    const agentContextParams = await createAgentContextParams(cwd)
    const agentContext = new AgentContext(agentContextParams)
    const piClient = new InteractiveMode(agentContext)
    await piClient.run()
}

main()
