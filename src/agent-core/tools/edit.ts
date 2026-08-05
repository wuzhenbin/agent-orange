import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises"
import { constants } from "fs"
import {
    applyEditsToNormalizedContent,
    detectLineEnding,
    generateDiffString,
    generateUnifiedPatch,
    normalizeToLF,
    restoreLineEndings,
    stripBom,
} from "../../utils/edit-diff.ts"
import { withFileMutationQueue } from "../../utils/file-mutation-queue.ts"
import { resolveToCwd } from "../../utils/path-utils.ts"
import { type Static, Type } from "typebox"
import { AgentTool } from "../types.ts"

export interface Edit {
    oldText: string
    newText: string
}

export interface EditToolDetails {
    /** Display-oriented diff of the changes made */
    diff: string
    /** Standard unified patch of the changes made */
    patch: string
    /** Line number of the first change in the new file (for editor navigation) */
    firstChangedLine?: number
}

/**
 * Pluggable operations for the edit tool.
 * Override these to delegate file editing to remote systems (for example SSH).
 */
export interface EditOperations {
    /** Read file contents as a Buffer */
    readFile: (absolutePath: string) => Promise<Buffer>
    /** Write content to a file */
    writeFile: (absolutePath: string, content: string) => Promise<void>
    /** Check if file is readable and writable (throw if not) */
    access: (absolutePath: string) => Promise<void>
}

const editOperations: EditOperations = {
    readFile: (path) => fsReadFile(path),
    writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
    access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
}

const replaceEditSchema = Type.Object(
    {
        oldText: Type.String({
            description:
                "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
        }),
        newText: Type.String({ description: "Replacement text for this targeted edit." }),
    },
    { additionalProperties: false },
)

const editSchema = Type.Object(
    {
        file_path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
        edits: Type.Array(replaceEditSchema, {
            description:
                "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
        }),
    },
    { additionalProperties: false },
)

export type EditToolInput = Static<typeof editSchema>

export const createEditTool = (
    cwd: string,
): AgentTool<typeof editSchema, EditToolDetails | undefined> => ({
    name: "edit",
    description:
        "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    parameters: editSchema,
    async execute(_toolCallId: string, input: EditToolInput, signal?: AbortSignal) {
        const { file_path, edits } = validateEditInput(input)
        const absolutePath = resolveToCwd(file_path, cwd)

        return withFileMutationQueue(absolutePath, async () => {
            // Do not reject from an abort event listener here: that would release the
            // mutation queue while an in-flight filesystem operation may still finish.
            // Checking signal.aborted after each await observes the same aborts while
            // keeping the queue locked until the current operation has settled.
            const throwIfAborted = (): void => {
                if (signal?.aborted) throw new Error("Operation aborted")
            }

            throwIfAborted()

            // Check if file exists.
            try {
                await editOperations.access(absolutePath)
            } catch (error: unknown) {
                throwIfAborted()
                const errorMessage =
                    error instanceof Error && "code" in error
                        ? `Error code: ${error.code}`
                        : String(error)
                throw new Error(`Could not edit file: ${file_path}. ${errorMessage}.`)
            }
            throwIfAborted()

            // Read the file.
            const buffer = await editOperations.readFile(absolutePath)
            const rawContent = buffer.toString("utf-8")
            throwIfAborted()

            // Strip BOM before matching. The model will not include an invisible BOM in oldText.
            const { bom, text: content } = stripBom(rawContent)
            const originalEnding = detectLineEnding(content)
            const normalizedContent = normalizeToLF(content)
            const { baseContent, newContent } = applyEditsToNormalizedContent(
                normalizedContent,
                edits,
                file_path,
            )
            throwIfAborted()

            const finalContent = bom + restoreLineEndings(newContent, originalEnding)
            await editOperations.writeFile(absolutePath, finalContent)
            throwIfAborted()

            const diffResult = generateDiffString(baseContent, newContent)
            const patch = generateUnifiedPatch(file_path, baseContent, newContent)
            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully replaced ${edits.length} block(s) in ${file_path}.`,
                    },
                ],
                details: {
                    diff: diffResult.diff,
                    patch,
                    firstChangedLine: diffResult.firstChangedLine,
                },
            }
        })
    },
})

/**
 * 验证编辑输入
 * 确保 edits 数组非空
 */
function validateEditInput(input: EditToolInput): { file_path: string; edits: Edit[] } {
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
        throw new Error("Edit tool input is invalid. edits must contain at least one replacement.")
    }
    return { file_path: input.file_path, edits: input.edits }
}
