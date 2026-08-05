import { Type } from "typebox"
import { dirname } from "path"
import { withFileMutationQueue } from "../../utils/file-mutation-queue.ts"
import { mkdir, writeFile } from "fs/promises"
import { AgentTool } from "../types.ts"
import { resolveToCwd } from "../../utils/path-utils.ts"

const writeSchema = Type.Object({
    file_path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
    content: Type.String({ description: "Content to write to the file" }),
})

export const createWriteTool = (cwd: string): AgentTool<typeof writeSchema> => ({
    name: "write",
    description:
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeSchema,
    async execute(_toolCallId, { file_path, content }, signal?: AbortSignal) {
        const absolutePath = resolveToCwd(file_path, cwd)
        const dir = dirname(absolutePath)
        return withFileMutationQueue(absolutePath, async () => {
            // Do not reject from an abort event listener here: that would release the
            // mutation queue while an in-flight filesystem operation may still finish.
            // Checking signal.aborted after each await observes the same aborts while
            // keeping the queue locked until the current operation has settled.
            const throwIfAborted = (): void => {
                if (signal?.aborted) throw new Error("Operation aborted")
            }
            throwIfAborted()

            // Create parent directories if needed.
            await mkdir(dir, { recursive: true })
            throwIfAborted()

            // Write the file contents.
            await writeFile(absolutePath, content, "utf-8")
            throwIfAborted()

            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully wrote ${content.length} bytes to ${file_path}`,
                    },
                ],
                details: undefined,
            }
        })
    },
})
