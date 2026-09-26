#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

const main = async () => {
    const { values } = parseArgs({
        options: {
            path: { type: "string" },
            version: { type: "boolean" },
        },
    })

    if (values.version) {
        const { version } = JSON.parse(
            readFileSync(new URL("../package.json", import.meta.url), "utf8"),
        ) as { version: string }
        console.log(version)
        return
    }

    const [{ createAgentContextParams }, { AgentContext }, { InteractiveMode }] = await Promise.all(
        [
            import("./agent-core/agent-runtime/agent-context-builder.ts"),
            import("./agent-core/agent-runtime/agent-context.ts"),
            import("./client-tui/interact.ts"),
        ],
    )
    const cwd = values.path ?? process.cwd()
    const agentContextParams = await createAgentContextParams(cwd)
    const agentContext = new AgentContext(agentContextParams)
    const piClient = new InteractiveMode(agentContext)
    await piClient.run()
}

main()
