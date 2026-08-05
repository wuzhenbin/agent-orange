import { access as fsAccess } from "node:fs/promises"
import { constants } from "node:fs"
import { spawn } from "child_process"
import {
    DEFAULT_MAX_LINES,
    DEFAULT_MAX_BYTES,
    TruncationResult,
    formatSize,
} from "../../utils/truncate.ts"
import {
    getShellEnv,
    getShellConfig,
    trackDetachedChildPid,
    untrackDetachedChildPid,
    killProcessTree,
} from "../../utils/shell.ts"
import { OutputAccumulator } from "../../utils/output-accumulator.ts"
import { waitForChildProcess } from "../../utils/child-process.ts"
import { Type } from "typebox"
import { AgentTool } from "../types.ts"

export interface BashSpawnContext {
    command: string
    cwd: string
    env: NodeJS.ProcessEnv
}

export interface BashToolDetails {
    truncation?: TruncationResult
    fullOutputPath?: string
}

const BASH_UPDATE_THROTTLE_MS = 100

const bashSchema = Type.Object({
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
    ),
})

export const createBashTool = (
    cwd: string,
): AgentTool<typeof bashSchema, BashToolDetails | undefined> => ({
    name: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    parameters: bashSchema,
    async execute(_toolCallId: string, { command, timeout }, signal?: AbortSignal, onUpdate?) {
        const spawnContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } }
        const output = new OutputAccumulator({ tempFilePrefix: "agent-bash" })
        let updateTimer: NodeJS.Timeout | undefined
        let updateDirty = false
        let lastUpdateAt = 0

        const emitOutputUpdate = () => {
            if (!onUpdate || !updateDirty) return
            updateDirty = false
            lastUpdateAt = Date.now()
            const snapshot = output.snapshot({ persistIfTruncated: true })
            onUpdate({
                content: [{ type: "text", text: snapshot.content || "" }],
                details: {
                    truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
                    fullOutputPath: snapshot.fullOutputPath,
                },
            })
        }

        const clearUpdateTimer = () => {
            if (updateTimer) {
                clearTimeout(updateTimer)
                updateTimer = undefined
            }
        }

        const scheduleOutputUpdate = () => {
            if (!onUpdate) return
            updateDirty = true
            const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt)
            if (delay <= 0) {
                clearUpdateTimer()
                emitOutputUpdate()
                return
            }
            updateTimer ??= setTimeout(() => {
                updateTimer = undefined
                emitOutputUpdate()
            }, delay)
        }

        if (onUpdate) {
            onUpdate({ content: [], details: undefined })
        }

        const handleData = (data: Buffer) => {
            output.append(data)
            scheduleOutputUpdate()
        }

        const finishOutput = async () => {
            output.finish()
            clearUpdateTimer()
            emitOutputUpdate()
            const snapshot = output.snapshot({ persistIfTruncated: true })
            await output.closeTempFile()
            return snapshot
        }

        const formatOutput = (
            snapshot: Awaited<ReturnType<typeof finishOutput>>,
            emptyText = "(no output)",
        ) => {
            const truncation = snapshot.truncation
            let text = snapshot.content || emptyText
            let details: BashToolDetails | undefined
            if (truncation.truncated) {
                details = { truncation, fullOutputPath: snapshot.fullOutputPath }
                const startLine = truncation.totalLines - truncation.outputLines + 1
                const endLine = truncation.totalLines
                if (truncation.lastLinePartial) {
                    const lastLineSize = formatSize(output.getLastLineBytes())
                    text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`
                } else if (truncation.truncatedBy === "lines") {
                    text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`
                } else {
                    text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`
                }
            }
            return { text, details }
        }

        const appendStatus = (text: string, status: string) =>
            `${text ? `${text}\n\n` : ""}${status}`

        try {
            let exitCode: number | null
            try {
                const result = await execBashOperations(spawnContext.command, spawnContext.cwd, {
                    onData: handleData,
                    signal,
                    timeout,
                    env: spawnContext.env,
                })
                exitCode = result.exitCode
            } catch (err) {
                const snapshot = await finishOutput()
                const { text } = formatOutput(snapshot, "")
                if (err instanceof Error && err.message === "aborted") {
                    throw new Error(appendStatus(text, "Command aborted"))
                }
                if (err instanceof Error && err.message.startsWith("timeout:")) {
                    const timeoutSecs = err.message.split(":")[1]
                    throw new Error(
                        appendStatus(text, `Command timed out after ${timeoutSecs} seconds`),
                    )
                }
                throw err
            }

            const snapshot = await finishOutput()
            const { text: outputText, details } = formatOutput(snapshot)
            if (exitCode !== 0 && exitCode !== null) {
                throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`))
            }
            return { content: [{ type: "text", text: outputText }], details }
        } finally {
            clearUpdateTimer()
        }
    },
})

const execBashOperations = async (
    command: string,
    cwd: string,
    options: {
        onData: (data: Buffer) => void
        signal?: AbortSignal
        timeout?: number
        env?: NodeJS.ProcessEnv
    },
) => {
    const { shell, args } = getShellConfig()
    try {
        await fsAccess(cwd, constants.F_OK)
    } catch {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`)
    }
    if (options.signal?.aborted) {
        throw new Error("aborted")
    }
    // 生成子进程执行命令
    const child = spawn(shell, [...args, command], {
        cwd: cwd, // 工作目录
        detached: process.platform !== "win32", // 非 Windows 平台使用分离模式
        env: options.env ?? getShellEnv(), // 环境变量
        stdio: ["ignore", "pipe", "pipe"], // stdin 忽略，stdout/stderr 管道
        windowsHide: true, // Windows 上隐藏窗口
    })

    // 跟踪分离的子进程 PID
    if (child.pid) trackDetachedChildPid(child.pid)

    let timedOut = false // 超时标志
    let timeoutHandle: NodeJS.Timeout | undefined // 超时定时器句柄

    // 中止处理函数：杀死整个进程树
    const onAbort = () => {
        if (child.pid) killProcessTree(child.pid)
    }

    try {
        const timeout = options.timeout
        // 如果提供了超时时间，设置定时器
        if (timeout !== undefined && timeout > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true
                if (child.pid) killProcessTree(child.pid)
            }, timeout * 1000)
        }

        // 流式传输 stdout 和 stderr 到 onData 回调
        child.stdout?.on("data", options.onData)
        child.stderr?.on("data", options.onData)

        // 处理中止信号，杀死整个进程树
        if (options.signal) {
            if (options.signal.aborted) onAbort()
            else options.signal.addEventListener("abort", onAbort, { once: true })
        }

        // 等待子进程完成，处理 shell 生成错误 避免因分离的后代持有继承的 stdio 句柄而挂起
        const exitCode = await waitForChildProcess(child)
        // 检查是否被中止
        if (options.signal?.aborted) {
            throw new Error("aborted")
        }
        // 检查是否超时
        if (timedOut) {
            throw new Error(`timeout:${timeout}`)
        }
        return { exitCode }
    } finally {
        // 清理资源
        if (child.pid) untrackDetachedChildPid(child.pid)
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (options.signal) options.signal.removeEventListener("abort", onAbort)
    }
}
