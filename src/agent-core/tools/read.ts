import { Type } from "typebox"
import { access as fsAccess, readFile as fsReadFile } from "fs/promises"
import { constants } from "fs"
import { resolveReadPathAsync } from "../../utils/path-utils.ts"
import { formatDimensionNote, resizeImage } from "../../utils/image-resize.ts"
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts"
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    type TruncationResult,
    truncateHead,
} from "../../utils/truncate.ts"
import { AgentTool } from "../types.ts"
import { TextContent, ImageContent, Model, Api } from "../../agent-ai/types.ts"

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
    /** Detect image MIME type, return null or undefined for non-images */
    detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>
}

const readOperations: ReadOperations = {
    readFile: (path) => fsReadFile(path),
    access: (path) => fsAccess(path, constants.R_OK),
    detectImageMimeType: detectSupportedImageMimeTypeFromFile,
}

const readSchema = Type.Object({
    file_path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
    offset: Type.Optional(
        Type.Number({ description: "Line number to start reading from (1-indexed)" }),
    ),
    limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})

export interface ReadToolOptions {
    /** Whether to auto-resize images to 2000x2000 max. Default: true */
    autoResizeImages?: boolean
    /** Custom operations for file reading. Default: local filesystem */
    operations?: ReadOperations
}

function getNonVisionImageNote(model: Model<Api> | undefined): string | undefined {
    if (!model || model.input.includes("image")) {
        return undefined
    }
    return "[Current model does not support images. The image will be omitted from this request.]"
}

export const createReadTool = (
    cwd: string,
    options?: ReadToolOptions,
): AgentTool<typeof readSchema, ReadToolDetails | undefined> => ({
    name: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    async execute(_toolCallId, { file_path, offset, limit }, signal?, _onUpdate?, ctx?) {
        const autoResizeImages = options?.autoResizeImages ?? true

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

                    const mimeType = readOperations.detectImageMimeType
                        ? await readOperations.detectImageMimeType(absolutePath)
                        : undefined

                    let content: (TextContent | ImageContent)[]
                    let details: ReadToolDetails | undefined
                    const nonVisionImageNote = getNonVisionImageNote(ctx?.model)

                    if (mimeType) {
                        // Read image as binary.
                        const buffer = await readOperations.readFile(absolutePath)
                        if (autoResizeImages) {
                            // Resize image if needed before sending it back to the model.
                            const resized = await resizeImage(buffer, mimeType)
                            if (!resized) {
                                let textNote = `Read image file [${mimeType}]\n[Image omitted: could not be resized below the inline image size limit.]`
                                if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`
                                content = [{ type: "text", text: textNote }]
                            } else {
                                const dimensionNote = formatDimensionNote(resized)
                                let textNote = `Read image file [${resized.mimeType}]`
                                if (dimensionNote) textNote += `\n${dimensionNote}`
                                if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`
                                content = [
                                    { type: "text", text: textNote },
                                    {
                                        type: "image",
                                        data: resized.data,
                                        mimeType: resized.mimeType,
                                    },
                                ]
                            }
                        } else {
                            let textNote = `Read image file [${mimeType}]`
                            if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`
                            content = [
                                { type: "text", text: textNote },
                                { type: "image", data: buffer.toString("base64"), mimeType },
                            ]
                        }
                    } else {
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
                            outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${absolutePath} | head -c ${DEFAULT_MAX_BYTES}]`
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
                    }

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
