import { isAbsolute, relative, resolve, sep } from "node:path"
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { AgentContext } from "../../agent-core/agent-runtime/agent-context.ts"
import { theme } from "../theme/global-instance.ts"

/**
 * Format token counts for compact footer display.
 * 格式化 token 计数，使其更适合紧凑的 footer 显示
 * 将大数字转换为更简洁的格式（如 k、M）
 * @param count - token 数量
 * @returns 格式化后的字符串
 *
 * @example
 * formatTokens(500)    // "500"
 * formatTokens(1500)    // "1.5k"
 * formatTokens(15000)   // "15k"
 * formatTokens(1500000) // "1.5M"
 */
function formatTokens(count: number): string {
    if (count < 1000) return count.toString()
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`
    if (count < 1000000) return `${Math.round(count / 1000)}k`
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
    return `${Math.round(count / 1000000)}M`
}

/**
 * 格式化当前工作目录路径用于 footer 显示
 * 将 home 目录替换为 ~ 符号，使路径更简洁
 *
 * @param cwd - 当前工作目录
 * @param home - 用户 home 目录路径
 * @returns 格式化后的路径字符串
 *
 * @example
 * formatCwdForFooter("/home/user/projects", "/home/user") // "~/projects"
 * formatCwdForFooter("/home/user", "/home/user")          // "~"
 * formatCwdForFooter("/other/path", "/home/user")         // "/other/path"
 */
export function formatCwdForFooter(cwd: string, home: string | undefined): string {
    if (!home) return cwd

    const resolvedCwd = resolve(cwd)
    const resolvedHome = resolve(home)
    const relativeToHome = relative(resolvedHome, resolvedCwd)
    const isInsideHome =
        relativeToHome === "" ||
        (relativeToHome !== ".." &&
            !relativeToHome.startsWith(`..${sep}`) &&
            !isAbsolute(relativeToHome))

    if (!isInsideHome) return cwd
    return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
    private autoCompactEnabled = true
    private agentContext: AgentContext

    get session() {
        return this.agentContext.session
    }
    get sessionManager() {
        return this.agentContext.sessionManager
    }

    constructor(agentContext: AgentContext) {
        this.agentContext = agentContext
    }

    /**
     * No-op: git branch caching now handled by provider.
     * Kept for compatibility with existing call sites in interactive-mode.
     */
    invalidate(): void {
        // No-op: git branch is cached/invalidated by provider
    }

    /**
     * Clean up resources.
     * Git watcher cleanup now handled by provider.
     */
    dispose(): void {
        // Git watcher cleanup handled by provider
    }

    render(width: number): string[] {
        const state = this.session.state

        // 计算所有会话条目的累计使用量
        // Calculate cumulative usage from ALL session entries (not just post-compaction messages)
        let totalInput = 0
        let totalOutput = 0
        let totalCacheRead = 0
        let totalCacheWrite = 0
        let totalCost = 0
        let latestCacheHitRate: number | undefined

        // 遍历所有会话条目，累加 assistant 消息的使用量
        for (const entry of this.session.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
                totalInput += entry.message.usage.input
                totalOutput += entry.message.usage.output
                totalCacheRead += entry.message.usage.cacheRead
                totalCacheWrite += entry.message.usage.cacheWrite
                totalCost += entry.message.usage.cost.total

                const latestPromptTokens =
                    entry.message.usage.input +
                    entry.message.usage.cacheRead +
                    entry.message.usage.cacheWrite
                latestCacheHitRate =
                    latestPromptTokens > 0
                        ? (entry.message.usage.cacheRead / latestPromptTokens) * 100
                        : undefined
            }
        }

        // 计算上下文使用率
        // Calculate context usage from session (handles compaction correctly).
        // After compaction, tokens are unknown until the next LLM response.
        const contextUsage = this.session.getContextUsage()
        const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0
        const contextPercentValue = contextUsage?.percent ?? 0
        const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?"

        // 格式化工作目录
        // Replace home directory with ~
        let pwd = formatCwdForFooter(
            this.sessionManager.getCwd(),
            process.env.HOME || process.env.USERPROFILE,
        )

        // 添加会话名称（如果已设置）
        // Add session name if set
        const sessionName = this.session.sessionManager.getSessionName()
        if (sessionName) {
            pwd = `${pwd} • ${sessionName}`
        }

        // Build stats line
        // 构建统计信息行
        const statsParts = []
        // 添加 token 统计（使用箭头符号表示输入/输出方向）
        if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`)
        if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`)
        if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`)
        if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`)
        if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
            statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`)
        }
        if (totalCost) {
            const costStr = `$${totalCost.toFixed(3)}}`
            statsParts.push(costStr)
        }

        // 格式化上下文百分比（带颜色）
        // Colorize context percentage based on usage
        let contextPercentStr: string
        const autoIndicator = this.autoCompactEnabled ? " (auto)" : ""
        const contextPercentDisplay =
            contextPercent === "?"
                ? `?/${formatTokens(contextWindow)}${autoIndicator}`
                : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`
        // 根据使用率设置不同颜色：>90% 红色，>70% 警告色，否则正常
        if (contextPercentValue > 90) {
            contextPercentStr = theme.fg("error", contextPercentDisplay)
        } else if (contextPercentValue > 70) {
            contextPercentStr = theme.fg("warning", contextPercentDisplay)
        } else {
            contextPercentStr = contextPercentDisplay
        }
        statsParts.push(contextPercentStr)

        let statsLeft = statsParts.join(" ")

        // 准备右侧模型信息
        // Add model name on the right side, plus thinking level if model supports it
        const modelName = state.model?.id || "no-model"
        let statsLeftWidth = visibleWidth(statsLeft)

        // If statsLeft is too wide, truncate it
        // 如果左侧统计信息过宽，进行截断
        if (statsLeftWidth > width) {
            statsLeft = truncateToWidth(statsLeft, width, "...")
            statsLeftWidth = visibleWidth(statsLeft)
        }

        let rightSide = `(${state.model!.provider}) ${modelName}`

        // 组装统计信息行
        const rightSideWidth = visibleWidth(rightSide)
        // Calculate available space for padding (minimum 2 spaces between stats and model)
        // 计算间距（左侧和右侧之间至少 2 个空格）
        const minPadding = 2
        const totalNeeded = statsLeftWidth + minPadding + rightSideWidth

        let statsLine: string
        if (totalNeeded <= width) {
            // Both fit - add padding to right-align model
            // 左右都能放下 - 添加填充使右侧对齐
            const padding = " ".repeat(width - statsLeftWidth - rightSideWidth)
            statsLine = statsLeft + padding + rightSide
        } else {
            // Need to truncate right side
            // 需要截断右侧
            const availableForRight = width - statsLeftWidth - minPadding
            if (availableForRight > 0) {
                const truncatedRight = truncateToWidth(rightSide, availableForRight, "")
                const truncatedRightWidth = visibleWidth(truncatedRight)
                const padding = " ".repeat(
                    Math.max(0, width - statsLeftWidth - truncatedRightWidth),
                )
                statsLine = statsLeft + padding + truncatedRight
            } else {
                // 空间不足，只显示左侧
                // Not enough space for right side at all
                statsLine = statsLeft
            }
        }

        // 应用样式
        // Apply dim to each part separately. statsLeft may contain color codes (for context %)
        // that end with a reset, which would clear an outer dim wrapper. So we dim the parts
        // before and after the colored section independently.
        const dimStatsLeft = theme.fg("dim", statsLeft)
        const remainder = statsLine.slice(statsLeft.length) // padding + rightSide
        const dimRemainder = theme.fg("dim", remainder)

        // 组装最终输出行
        // 第1行：pwd 路径
        const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."))
        const lines = [pwdLine, dimStatsLeft + dimRemainder]

        return lines
    }
}
