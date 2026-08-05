import { Type } from "typebox"
import path from "path"
import { access as fsAccess, readFile as fsReadFile } from "fs/promises"
import { constants } from "fs"
import { resolveReadPathAsync } from "../../utils/path-utils.ts"
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    type TruncationResult,
    truncateHead,
} from "../../utils/truncate.ts"
import { AgentTool } from "../types.ts"
import { TextContent } from "../../agent-ai/types.ts"

export interface ReadToolDetails {
    truncation?: TruncationResult
}

/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (for example SSH).
 */
export interface ReadOperations {
    /** Read file contents as a Buffer */
    readFile: (absolutePath: string) => Promise<Buffer>
    /** Check if file is readable (throw if not) */
    access: (absolutePath: string) => Promise<void>
}

const readOperations: ReadOperations = {
    readFile: (path) => fsReadFile(path),
    access: (path) => fsAccess(path, constants.R_OK),
}

const readSchema = Type.Object({
    file_path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
    offset: Type.Optional(
        Type.Number({ description: "Line number to start reading from (1-indexed)" }),
    ),
    limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})

export const createReadTool = (
    cwd: string,
): AgentTool<typeof readSchema, ReadToolDetails | undefined> => ({
    name: "read",
    description: `Read the contents of a file. Supports text files. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    async execute(_toolCallId, { file_path, offset, limit }, signal?, _onUpdate?) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error("Operation aborted"))
                return
            }
            let aborted = false
            const onAbort = () => {
                aborted = true
                reject(new Error("Operation aborted"))
            }
            signal?.addEventListener("abort", onAbort, { once: true })
            ;(async () => {
                try {
                    const absolutePath = await resolveReadPathAsync(file_path, cwd)
                    if (aborted) return

                    // Check if file exists and is readable.
                    await readOperations.access(absolutePath)
                    if (aborted) return

                    let content: TextContent[]
                    let details: ReadToolDetails | undefined

                    // Read text content.
                    const buffer = await readOperations.readFile(absolutePath)
                    const textContent = buffer.toString("utf-8")
                    const allLines = textContent.split("\n")
                    const totalFileLines = allLines.length
                    // Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
                    const startLine = offset ? Math.max(0, offset - 1) : 0
                    const startLineDisplay = startLine + 1
                    // Check if offset is out of bounds.
                    if (startLine >= allLines.length) {
                        throw new Error(
                            `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
                        )
                    }
                    let selectedContent: string
                    let userLimitedLines: number | undefined
                    // If limit is specified by the user, honor it first. Otherwise truncateHead decides.
                    if (limit !== undefined) {
                        const endLine = Math.min(startLine + limit, allLines.length)
                        selectedContent = allLines.slice(startLine, endLine).join("\n")
                        userLimitedLines = endLine - startLine
                    } else {
                        selectedContent = allLines.slice(startLine).join("\n")
                    }
                    // Apply truncation, respecting both line and byte limits.
                    const truncation = truncateHead(selectedContent)
                    let outputText: string
                    if (truncation.firstLineExceedsLimit) {
                        // First line alone exceeds the byte limit. Point the model at a bash fallback.
                        const firstLineSize = formatSize(
                            Buffer.byteLength(allLines[startLine], "utf-8"),
                        )
                        outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`
                        details = { truncation }
                    } else if (truncation.truncated) {
                        // Truncation occurred. Build an actionable continuation notice.
                        const endLineDisplay = startLineDisplay + truncation.outputLines - 1
                        const nextOffset = endLineDisplay + 1
                        outputText = truncation.content
                        if (truncation.truncatedBy === "lines") {
                            outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`
                        } else {
                            outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`
                        }
                        details = { truncation }
                    } else if (
                        userLimitedLines !== undefined &&
                        startLine + userLimitedLines < allLines.length
                    ) {
                        // User-specified limit stopped early, but the file still has more content.
                        const remaining = allLines.length - (startLine + userLimitedLines)
                        const nextOffset = startLine + userLimitedLines + 1
                        outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`
                    } else {
                        // No truncation and no remaining user-limited content.
                        outputText = truncation.content
                    }
                    content = [{ type: "text", text: outputText }]

                    if (aborted) return
                    signal?.removeEventListener("abort", onAbort)
                    resolve({ content, details })
                } catch (error: any) {
                    signal?.removeEventListener("abort", onAbort)
                    if (!aborted) reject(error)
                }
            })()
        })
    },
})
