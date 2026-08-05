import { AgentManager } from "../agent-runtime/agent-manager.ts"
import { AgentTool } from "../types.ts"
import { Type } from "typebox"

const delegateTaskSchema = Type.Object({
    name: Type.String({
        description:
            "Subagent definition name from <available_agents>. Must exactly match one of the provided agent names.",
    }),
    propmpt: Type.String({ description: "Clear task description for the subagent" }),
})

export const createDelegateTaskTool = (options: {
    cwd: string
    agentManager: AgentManager
}): AgentTool<typeof delegateTaskSchema, undefined> => ({
    name: "delegate_task",
    description:
        "Delegate a complex task to a specialized subagent. The subagent will execute the task independently and return only the final conclusion",
    parameters: delegateTaskSchema,

    async execute(_toolCallId: string, { name, propmpt }, signal?: AbortSignal, onUpdate?) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error("Operation aborted"))
                return
            }
            const onAbort = () => reject(new Error("Operation aborted"))
            signal?.addEventListener("abort", onAbort, { once: true })
            ;(async () => {
                try {
                    const result = await options.agentManager.createSubagentExcute(name, propmpt)
                    signal?.removeEventListener("abort", onAbort)
                    resolve({
                        content: [{ type: "text", text: result.text }],
                        details: undefined,
                    })
                } catch (error) {
                    reject(error)
                } finally {
                    signal?.removeEventListener("abort", onAbort)
                }
            })()
        })
    },
})
