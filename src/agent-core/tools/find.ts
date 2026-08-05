import path from "path"
import { spawn } from "child_process"
import { createInterface } from "node:readline"
import { ensureTool } from "../../utils/global-tools.ts"
import { resolveToCwd } from "../../utils/path-utils.ts"
import {
    DEFAULT_MAX_BYTES,
    formatSize,
    truncateHead,
    TruncationResult,
} from "../../utils/truncate.ts"
import { Type } from "typebox"
import { AgentTool } from "../types.ts"

const DEFAULT_LIMIT = 1000

export interface FindToolDetails {
    truncation?: TruncationResult
    resultLimitReached?: number
}
/**
 * Pluggable operations for the find tool.
 * Override these to delegate file search to remote systems (for example SSH).
 */
export interface FindOperations {
    /** Check if path exists */
    exists: (absolutePath: string) => Promise<boolean> | boolean
    /** Find files matching glob pattern. Returns relative or absolute paths. */
    glob: (
        pattern: string,
        cwd: string,
        options: { ignore: string[]; limit: number },
    ) => Promise<string[]> | string[]
}

function toPosixPath(value: string): string {
    return value.split(path.sep).join("/")
}

const findSchema = Type.Object({
    pattern: Type.String({
        description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
    }),
    file_path: Type.Optional(Type.String({ description: "Directory to search in", default: "." })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of results", default: 1000 })),
})

export const createFindTool = (
    cwd: string,
): AgentTool<typeof findSchema, FindToolDetails | undefined> => ({
    name: "find",
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: findSchema,
    async execute(_toolCallId: string, { pattern, file_path, limit = 1000 }, signal?: AbortSignal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error("Operation aborted"))
                return
            }

            let settled = false
            let stopChild: (() => void) | undefined
            const settle = (fn: () => void) => {
                if (settled) return
                settled = true
                signal?.removeEventListener("abort", onAbort)
                stopChild = undefined
                fn()
            }
            const onAbort = () => {
                stopChild?.()
                settle(() => reject(new Error("Operation aborted")))
            }
            signal?.addEventListener("abort", onAbort, { once: true })
            ;(async () => {
                try {
                    const fdPath = await ensureTool("fd", true)
                    if (signal?.aborted) {
                        settle(() => reject(new Error("Operation aborted")))
                        return
                    }
                    if (!fdPath) {
                        settle(() =>
                            reject(new Error("fd is not available and could not be downloaded")),
                        )
                        return
                    }

                    // 搜索目录处理
                    const searchPath = resolveToCwd(file_path || ".", cwd)
                    const effectiveLimit = limit ?? DEFAULT_LIMIT

                    // Build fd arguments. --no-require-git makes fd apply hierarchical .gitignore
                    // semantics whether or not the search path is inside a git repository, without
                    // leaking sibling-directory rules the way --ignore-file (a global source) would.
                    const args: string[] = [
                        "--glob",
                        "--color=never",
                        "--hidden",
                        "--no-require-git",
                        "--max-results",
                        String(effectiveLimit),
                    ]

                    // fd --glob matches against the basename unless --full-path is set; in --full-path
                    // mode it matches against the absolute candidate path, so a path-containing
                    // pattern like 'src/**/*.spec.ts' needs a leading '**/' to match anything.
                    let effectivePattern = pattern
                    if (pattern.includes("/")) {
                        args.push("--full-path")
                        if (
                            !pattern.startsWith("/") &&
                            !pattern.startsWith("**/") &&
                            pattern !== "**"
                        ) {
                            effectivePattern = `**/${pattern}`
                        }
                    }
                    args.push("--", effectivePattern, searchPath)

                    const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"] })
                    const rl = createInterface({ input: child.stdout })
                    let stderr = ""
                    const lines: string[] = []

                    stopChild = () => {
                        if (!child.killed) {
                            child.kill()
                        }
                    }

                    const cleanup = () => {
                        rl.close()
                    }

                    child.stderr?.on("data", (chunk) => {
                        stderr += chunk.toString()
                    })

                    rl.on("line", (line) => {
                        lines.push(line)
                    })

                    child.on("error", (error) => {
                        cleanup()
                        settle(() => reject(new Error(`Failed to run fd: ${error.message}`)))
                    })

                    child.on("close", (code) => {
                        cleanup()
                        if (signal?.aborted) {
                            settle(() => reject(new Error("Operation aborted")))
                            return
                        }
                        const output = lines.join("\n")
                        if (code !== 0) {
                            const errorMsg = stderr.trim() || `fd exited with code ${code}`
                            if (!output) {
                                settle(() => reject(new Error(errorMsg)))
                                return
                            }
                        }
                        if (!output) {
                            settle(() =>
                                resolve({
                                    content: [
                                        {
                                            type: "text",
                                            text: "No files found matching pattern",
                                        },
                                    ],
                                    details: undefined,
                                }),
                            )
                            return
                        }

                        const relativized: string[] = []
                        for (const rawLine of lines) {
                            const line = rawLine.replace(/\r$/, "").trim()
                            if (!line) continue
                            const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\")
                            let relativePath = line
                            if (line.startsWith(searchPath)) {
                                relativePath = line.slice(searchPath.length + 1)
                            } else {
                                relativePath = path.relative(searchPath, line)
                            }
                            if (hadTrailingSlash && !relativePath.endsWith("/")) relativePath += "/"
                            relativized.push(toPosixPath(relativePath))
                        }

                        const resultLimitReached = relativized.length >= effectiveLimit
                        const rawOutput = relativized.join("\n")
                        const truncation = truncateHead(rawOutput, {
                            maxLines: Number.MAX_SAFE_INTEGER,
                        })
                        let resultOutput = truncation.content
                        const details: FindToolDetails = {}
                        const notices: string[] = []
                        if (resultLimitReached) {
                            notices.push(
                                `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
                            )
                            details.resultLimitReached = effectiveLimit
                        }
                        if (truncation.truncated) {
                            notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
                            details.truncation = truncation
                        }
                        if (notices.length > 0) {
                            resultOutput += `\n\n[${notices.join(". ")}]`
                        }
                        settle(() =>
                            resolve({
                                content: [{ type: "text", text: resultOutput }],
                                details: Object.keys(details).length > 0 ? details : undefined,
                            }),
                        )
                    })
                } catch (e) {
                    if (signal?.aborted) {
                        settle(() => reject(new Error("Operation aborted")))
                        return
                    }
                    const error = e instanceof Error ? e : new Error(String(e))
                    settle(() => reject(error))
                }
            })()
        })
    },
})
