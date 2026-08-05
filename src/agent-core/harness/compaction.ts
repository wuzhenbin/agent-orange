import { SessionEntry, CompactionEntry, buildSessionContext } from "../session-manager-helper.ts"
import { AgentMessage, ThinkingLevel, StreamFn } from "../types.ts"
import {
    extractFileOpsFromMessage,
    type FileOperations,
    createFileOps,
    CompactionDetails,
    computeFileLists,
    formatFileOperations,
    serializeConversation,
} from "./utils.ts"
import { estimateContextTokens, estimateTokens } from "./calc-token.ts"
import { createCompactionSummaryMessage, convertToLlm } from "./message.ts"
import type { Model, SimpleStreamOptions, Context, AssistantMessage } from "../../agent-ai/types.ts"
import { completeSimple } from "../../agent-ai/stream.ts"
import {
    UPDATE_SUMMARIZATION_PROMPT,
    SUMMARIZATION_PROMPT,
    SUMMARIZATION_SYSTEM_PROMPT,
    TURN_PREFIX_SUMMARIZATION_PROMPT,
} from "./compaction-prompt.ts"

/** Result from compact() - SessionManager adds uuid/parentUuid when saving */
export interface CompactionResult<T = unknown> {
    summary: string
    firstKeptEntryId: string
    tokensBefore: number
    estimatedTokensAfter?: number
    /** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
    details?: T
}

export interface CutPointResult {
    /** Index of first entry to keep */
    firstKeptEntryIndex: number
    /** Index of user message that starts the turn being split, or -1 if not splitting */
    turnStartIndex: number
    /** Whether this cut splits a turn (cut point is not a user message) */
    isSplitTurn: boolean
}

export interface CompactionSettings {
    enabled: boolean
    reserveTokens: number
    keepRecentTokens: number
}

export interface CompactionPreparation {
    /** UUID of first entry to keep */
    firstKeptEntryId: string
    /** Messages that will be summarized and discarded */
    messagesToSummarize: AgentMessage[]
    /** Messages that will be turned into turn prefix summary (if splitting) */
    turnPrefixMessages: AgentMessage[]
    /** Whether this is a split turn (cut point in middle of turn) */
    isSplitTurn: boolean
    tokensBefore: number
    /** Summary from previous compaction, for iterative update */
    previousSummary?: string
    /** File operations extracted from messagesToSummarize */
    fileOps: FileOperations
    compactSettings: CompactionSettings
}

// 在执行上下文压缩之前，分析当前 Session 日志，
// 确定哪些历史消息需要总结、哪些消息保留，并生成压缩所需的准备数据
// olling compaction(滚动压缩) && incremental summarization(增量摘要)
export function prepareCompaction(
    pathEntries: SessionEntry[],
    compactSettings: CompactionSettings,
): CompactionPreparation | undefined {
    // 如果最后一条已经是CompactionEntry 防止重复压缩
    if (pathEntries.length > 0 && pathEntries[pathEntries.length - 1].type === "compaction") {
        return undefined
    }

    // 找最近一次压缩点
    let prevCompactionIndex = -1
    for (let i = pathEntries.length - 1; i >= 0; i--) {
        if (pathEntries[i].type === "compaction") {
            prevCompactionIndex = i
            break
        }
    }

    // 之前的压缩块
    let previousSummary: string | undefined
    // 从第0条开始压缩
    let boundaryStart = 0
    // 存在旧 compaction
    if (prevCompactionIndex >= 0) {
        const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry
        previousSummary = prevCompaction.summary
        // 寻找上次压缩留下来的第一条消息
        const firstKeptEntryIndex = pathEntries.findIndex(
            (entry) => entry.id === prevCompaction.firstKeptEntryId,
        )
        boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1
    }
    const boundaryEnd = pathEntries.length

    // 计算当前上下文 token
    const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages).tokens
    // 找切割点
    const { isSplitTurn, firstKeptEntryIndex, turnStartIndex } = findCutPoint(
        pathEntries,
        boundaryStart,
        boundaryEnd,
        compactSettings.keepRecentTokens,
    )

    // Get UUID of first kept entry
    // 获取保留区第一条 entry
    const firstKeptEntry = pathEntries[firstKeptEntryIndex]
    const firstKeptEntryId = firstKeptEntry.id

    // 判断是否切断一个turn
    const historyEnd = isSplitTurn ? turnStartIndex : firstKeptEntryIndex

    // 收集需要总结的消息
    const messagesToSummarize: AgentMessage[] = []
    for (let i = boundaryStart; i < historyEnd; i++) {
        // SessionEntry -> AgentMessage
        const msg = getMessageFromEntryForCompaction(pathEntries[i])
        if (msg) messagesToSummarize.push(msg)
    }

    // Messages for turn prefix summary (if splitting a turn)
    const turnPrefixMessages: AgentMessage[] = []
    if (isSplitTurn) {
        for (let i = turnStartIndex; i < firstKeptEntryIndex; i++) {
            const msg = getMessageFromEntryForCompaction(pathEntries[i])
            if (msg) turnPrefixMessages.push(msg)
        }
    }

    // 判断是否真的需要压缩
    if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) {
        return undefined
    }

    // 提取文件操作 保持代码状态 防止压缩后忘记文件变化
    const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex)

    // Also extract file ops from turn prefix if splitting
    if (isSplitTurn) {
        for (const msg of turnPrefixMessages) {
            extractFileOpsFromMessage(msg, fileOps)
        }
    }

    return {
        firstKeptEntryId,
        messagesToSummarize,
        turnPrefixMessages,
        isSplitTurn,
        tokensBefore,
        previousSummary,
        fileOps,
        compactSettings,
    }
}

/**
 * Generate summaries for compaction using prepared data.
 * Returns CompactionResult - SessionManager adds uuid/parentUuid when saving.
 * 根据 preparation 准备好的消息范围生成摘要
 * 处理特殊的 split turn 情况
 * 收集文件操作信息附加到摘要
 * 返回压缩结果，供 session 替换旧上下文
 *
 * @param preparation - Pre-calculated preparation from prepareCompaction()
 * @param customInstructions - Optional custom focus for the summary
 */
export async function compact(
    model: Model<any>,
    apiKey: string | undefined,
    preparation: CompactionPreparation,
    customInstructions?: string,
    signal?: AbortSignal,
    thinkingLevel?: ThinkingLevel,
    streamFn?: StreamFn,
): Promise<CompactionResult> {
    const {
        firstKeptEntryId, // 压缩后保留的第一条消息 ID
        messagesToSummarize, // 需要总结的历史消息
        turnPrefixMessages, // 当前 turn 前半部分消息
        isSplitTurn, // 是否发生 turn 被切开的情况
        tokensBefore, // 压缩前 token 数
        previousSummary, // 上一次压缩产生的 summary
        fileOps, // 文件操作记录
        compactSettings,
    } = preparation

    // Generate summaries (can be parallel if both needed) and merge into one
    let summary: string

    if (isSplitTurn && turnPrefixMessages.length > 0) {
        // Generate both summaries in parallel
        // 并行生成两个 summary
        const [historyResult, turnPrefixResult] = await Promise.all([
            messagesToSummarize.length > 0
                ? generateSummary(
                      messagesToSummarize,
                      model,
                      apiKey,
                      compactSettings.reserveTokens,
                      signal,
                      customInstructions,
                      previousSummary,
                      thinkingLevel,
                      streamFn,
                  )
                : Promise.resolve("No prior history."),
            generateTurnPrefixSummary(
                model,
                apiKey,
                turnPrefixMessages,
                compactSettings.reserveTokens,
                signal,
                thinkingLevel,
                streamFn,
            ),
        ])
        // Merge into single summary
        summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`
    } else {
        // Just generate history summary
        summary = await generateSummary(
            messagesToSummarize,
            model,
            apiKey,
            compactSettings.reserveTokens,
            signal,
            customInstructions,
            previousSummary,
            thinkingLevel,
            streamFn,
        )
    }

    // Compute file lists and append to summary
    const { readFiles, modifiedFiles } = computeFileLists(fileOps)
    summary += formatFileOperations(readFiles, modifiedFiles)

    return {
        summary,
        firstKeptEntryId,
        tokensBefore,
        details: { readFiles, modifiedFiles } as CompactionDetails,
    }
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 *
 * Algorithm: Walk backwards from newest, accumulating estimated message sizes.
 * Stop when we've accumulated >= keepRecentTokens. Cut at that point.
 *
 * Can cut at user OR assistant messages (never tool results). When cutting at an
 * assistant message with tool calls, its tool results come after and will be kept.
 *
 * Returns CutPointResult with:
 * - firstKeptEntryIndex: the entry index to start keeping from
 * - turnStartIndex: if cutting mid-turn, the user message that started that turn
 * - isSplitTurn: whether we're cutting in the middle of a turn
 *
 * Only considers entries between `startIndex` and `endIndex` (exclusive).
 *
 * 在一段 SessionEntry 历史记录中，寻找一个合适的截断点，
 * 在决定压缩/裁剪上下文时从哪里开始保留最近消息
 * 核心目标：
 * - 保留最近 keepRecentTokens token 的消息
 * - 找到一个合法的切割位置
 * - 避免把一个完整对话 turn 从中间切断
 * - 保留一些非 message 类型的上下文信息
 */

export function findCutPoint(
    entries: SessionEntry[],
    startIndex: number,
    endIndex: number,
    keepRecentTokens: number,
): CutPointResult {
    // 合法安全位置
    const cutPoints = findValidCutPoints(entries, startIndex, endIndex)

    // 没有安全位置 直接从 startIndex 保留
    if (cutPoints.length === 0) {
        return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false }
    }

    // 从后往前累计token
    let accumulatedTokens = 0
    // 第一个合法点
    let cutIndex = cutPoints[0] // Default: keep from first message (not header)

    // 倒序扫描 最新消息 -> 旧消息
    for (let i = endIndex - 1; i >= startIndex; i--) {
        const entry = entries[i]
        // 只统计 message 类型的消息
        if (entry.type !== "message") continue

        // Estimate this message's size
        const messageTokens = estimateTokens(entry.message)
        accumulatedTokens += messageTokens

        // Check if we've exceeded the budget
        if (accumulatedTokens >= keepRecentTokens) {
            // Find the closest valid cut point at or after this entry
            for (let c = 0; c < cutPoints.length; c++) {
                if (cutPoints[c] >= i) {
                    cutIndex = cutPoints[c]
                    break
                }
            }
            break
        }
    }

    // 找最近的合法 cut point, 向前吸附非 message entry, 因为安全位置前可能还有其他非message的消息
    // Scan backwards from cutIndex to include any non-message entries (bash, settings, etc.)
    while (cutIndex > startIndex) {
        const prevEntry = entries[cutIndex - 1]
        // Stop at session header or compaction boundaries
        // 不能把 compaction 前面的东西拉进来
        if (prevEntry.type === "compaction") {
            break
        }
        // 不能把前一个 turn 拉进来
        if (prevEntry.type === "message") {
            break
        }
        // Include this non-message entry (bash, settings change, etc.)
        cutIndex--
    }

    // Determine if this is a split turn
    // 判断是否切断了一个 turn
    const cutEntry = entries[cutIndex]
    const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user"
    // 从user开始就是一个完整turn 否则就是被切开
    const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex)

    return {
        firstKeptEntryIndex: cutIndex,
        turnStartIndex,
        isSplitTurn: !isUserMessage && turnStartIndex !== -1,
    }
}

function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
    if (entry.type === "compaction") {
        return undefined
    }
    return getMessageFromEntry(entry)
}

/**
 * Find the user message (or bashExecution) that starts the turn containing the given entry index.
 * Returns -1 if no turn start found before the index.
 * BashExecutionMessage is treated like a user message for turn boundaries.
 */
export function findTurnStartIndex(
    entries: SessionEntry[],
    entryIndex: number,
    startIndex: number,
): number {
    for (let i = entryIndex; i >= startIndex; i--) {
        const entry = entries[i]
        if (entry.type === "message") {
            const role = entry.message.role
            if (role === "user") {
                return i
            }
        }
    }
    return -1
}

/**
 * Extract AgentMessage from an entry if it produces one.
 * Returns undefined for entries that don't contribute to LLM context.
 */
function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
    if (entry.type === "message") {
        return entry.message
    }

    if (entry.type === "compaction") {
        return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)
    }
    return undefined
}

/**
 * 查找有效的截断点：即 user、assistant 消息的索引。
 * 切勿在工具结果处截断 - 工具结果必须紧跟在其对应的工具调用之后
 * 若在包含工具调用的 assistant 消息处截断，其后续的工具结果将会被保留
 */
// 扫描 SessionEntry 可以作为安全切割点的index
function findValidCutPoints(
    entries: SessionEntry[],
    startIndex: number,
    endIndex: number,
): number[] {
    const cutPoints: number[] = []
    for (let i = startIndex; i < endIndex; i++) {
        const entry = entries[i]
        switch (entry.type) {
            case "message": {
                const role = entry.message.role
                switch (role) {
                    case "compactionSummary":
                    case "user":
                    case "assistant":
                        cutPoints.push(i)
                        break
                }
                break
            }
        }
    }
    return cutPoints
}

/**
 * Extract file operations from messages and previous compaction entries.
 */
function extractFileOperations(
    messages: AgentMessage[],
    entries: SessionEntry[],
    prevCompactionIndex: number,
): FileOperations {
    const fileOps = createFileOps()

    // Collect from previous compaction's details
    if (prevCompactionIndex >= 0) {
        const prevCompaction = entries[prevCompactionIndex] as CompactionEntry
        if (prevCompaction.details) {
            // fromHook field kept for session file compatibility
            const details = prevCompaction.details as CompactionDetails
            if (Array.isArray(details.readFiles)) {
                for (const f of details.readFiles) fileOps.read.add(f)
            }
            if (Array.isArray(details.modifiedFiles)) {
                for (const f of details.modifiedFiles) fileOps.edited.add(f)
            }
        }
    }

    // Extract from tool calls in messages
    for (const msg of messages) {
        extractFileOpsFromMessage(msg, fileOps)
    }

    return fileOps
}

/**
 * Generate a summary of the conversation using the LLM.
 * If previousSummary is provided, uses the update prompt to merge.
 */
export async function generateSummary(
    currentMessages: AgentMessage[],
    model: Model<any>,
    apiKey: string | undefined,
    reserveTokens: number,
    signal?: AbortSignal,
    customInstructions?: string,
    previousSummary?: string,
    thinkingLevel?: ThinkingLevel,
    streamFn?: StreamFn,
): Promise<string> {
    const maxTokens = Math.min(
        Math.floor(0.8 * reserveTokens),
        model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
    )

    // Use update prompt if we have a previous summary, otherwise initial prompt
    let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT
    if (customInstructions) {
        basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`
    }

    // Serialize conversation to text so model doesn't try to continue it
    // Convert to LLM messages first (handles custom types like bashExecution, custom, etc.)
    const llmMessages = convertToLlm(currentMessages)
    const conversationText = serializeConversation(llmMessages)

    // Build the prompt with conversation wrapped in tags
    let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`
    if (previousSummary) {
        promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`
    }
    promptText += basePrompt

    const summarizationMessages = [
        {
            role: "user" as const,
            content: [{ type: "text" as const, text: promptText }],
            timestamp: Date.now(),
        },
    ]

    const completionOptions = createSummarizationOptions(
        model,
        apiKey,
        maxTokens,
        signal,
        thinkingLevel,
    )
    const response = await completeSummarization(
        model,
        { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
        completionOptions,
        streamFn,
    )

    if (response.stopReason === "error") {
        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`)
    }

    const textContent = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")

    return textContent
}

/**
 * Generate a summary for a turn prefix (when splitting a turn).
 */
async function generateTurnPrefixSummary(
    model: Model<any>,
    apiKey: string | undefined,
    messages: AgentMessage[],
    reserveTokens: number,
    signal?: AbortSignal,
    thinkingLevel?: ThinkingLevel,
    streamFn?: StreamFn,
): Promise<string> {
    const maxTokens = Math.min(
        Math.floor(0.5 * reserveTokens),
        model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
    ) // Smaller budget for turn prefix
    const llmMessages = convertToLlm(messages)
    const conversationText = serializeConversation(llmMessages)
    const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`
    const summarizationMessages = [
        {
            role: "user" as const,
            content: [{ type: "text" as const, text: promptText }],
            timestamp: Date.now(),
        },
    ]

    const response = await completeSummarization(
        model,
        { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
        createSummarizationOptions(model, apiKey, maxTokens, signal, thinkingLevel),
        streamFn,
    )

    if (response.stopReason === "error") {
        throw new Error(
            `Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`,
        )
    }

    return response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
}

function createSummarizationOptions(
    model: Model<any>,
    apiKey: string | undefined,
    maxTokens: number,
    signal: AbortSignal | undefined,
    thinkingLevel: ThinkingLevel | undefined,
): SimpleStreamOptions {
    const options: SimpleStreamOptions = { maxTokens, signal, apiKey }
    if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
        options.reasoning = thinkingLevel
    }
    return options
}

async function completeSummarization(
    model: Model<any>,
    context: Context,
    options: SimpleStreamOptions,
    streamFn?: StreamFn,
): Promise<AssistantMessage> {
    if (!streamFn) {
        return completeSimple(model, context, options)
    }
    const stream = await streamFn(model, context, options)
    return stream.result()
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(
    contextTokens: number,
    contextWindow: number,
    settings: CompactionSettings,
): boolean {
    if (!settings.enabled) return false
    return contextTokens > contextWindow - settings.reserveTokens
}
