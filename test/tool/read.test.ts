import { toolsRegister } from "../../src/agent-core/tool-register.ts"
import { validateToolArguments } from "../../src/utils/validation.ts"
import { ToolCall } from "../../src/agent-ai/index.ts"

const main = async () => {
    const cwd = process.cwd()
    const readTool = toolsRegister.read(cwd)
    const toolCall = {
        type: "toolCall" as const,
        id: "123",
        name: "read",
        arguments: { file_path: "password.txt", limit: 20, offset: 0 },
    }
    try {
        const validatedArgs = validateToolArguments(readTool, toolCall)
        console.log(validatedArgs)
    } catch (error) {
        console.log(error instanceof Error ? error.message : String(error))
    }

    // const result = await readTool(call.name, call.arguments, call.id)
    // console.log(result)
}

main()
