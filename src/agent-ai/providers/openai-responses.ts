import OpenAI from "openai"
import type {
    Tool as OpenAITool,
    ResponseReasoningItem,
    ResponseOutputMessage,
    ResponseFunctionToolCall,
    ResponseCreateParamsStreaming,
    ResponseInput,
    ResponseInputContent,
    ResponseInputText,
    ResponseInputImage,
    ResponseFunctionCallOutputItemList,
} from "openai/resources/responses/responses"
import {
    ThinkingContent,
    TextContent,
    ToolCall,
    AssistantMessage,
    StopReason,
    StreamFunction,
    StreamOptions,
    Model,
    Context,
    Api,
    Tool,
    ImageContent,
    TextSignatureV1,
    CacheRetention,
    SimpleStreamOptions,
} from "../types.ts"
import { AssistantMessageEventStream } from "../../utils/event-stream.ts"
import { parseStreamingJson } from "../../utils/json-parse.ts"
import { getEnvApiKey } from "../env-api-keys.ts"
import { shortHash } from "../../utils/hash.ts"
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts"
import { transformMessages } from "./transform-messages.ts"
import { headersToRecord } from "../../utils/headers.ts"
import { OpenAIResponsesCompat } from "./provider_types.ts"
import { buildBaseOptions } from "./simple-options.ts"
import { clampThinkingLevel } from "../models.ts"

// 本项目使用 FunctionTool 类型, 因为OpenAI.Responses.Tool 是更广的通用类型
export type ChatTool = OpenAI.Responses.FunctionTool
export type ChatMessage = OpenAI.Responses.ResponseInputItem

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
    reasoningSummary?: "auto" | "detailed" | "concise" | null
    serviceTier?: ResponseCreateParamsStreaming["service_tier"]
}

export interface ConvertResponsesMessagesOptions {
    includeSystemPrompt?: boolean
}

export interface ConvertResponsesToolsOptions {
    strict?: boolean | null
}

/*  
response.created
│
├─ response.output_item.added (reasoning)
│    ├─ response.reasoning_text.delta
│    ├─ response.reasoning_text.delta
│    └─ response.output_item.done
│
├─ response.output_item.added (message)
│    ├─ response.content_part.added
│    ├─ response.output_text.delta
│    ├─ response.output_text.delta
│    └─ response.output_item.done
│
├─ response.output_item.added (function_call)
│    ├─ response.function_call_arguments.delta
│    ├─ response.function_call_arguments.delta
│    ├─ response.function_call_arguments.done
│    └─ response.output_item.done
│
└─ response.completed

| Event                                     | 业务含义         | 对应 stream.push       |
| ----------------------------------------- | ------------ | -------------------- |
| response.created                          | AI 开始响应      | 无                    |
| response.output_item.added(reasoning)     | 开始思考         | thinking_start       |
| response.reasoning_*                      | 思考流式输出       | thinking_delta       |
| response.output_item.done(reasoning)      | 思考结束         | thinking_end         |
| response.output_item.added(message)       | 开始回答         | text_start           |
| response.output_text.delta                | 回答流式输出       | text_delta           |
| response.output_item.done(message)        | 回答结束         | text_end             |
| response.output_item.added(function_call) | 开始工具调用       | toolcall_start       |
| response.function_call_arguments.delta    | 参数流式生成       | toolcall_delta       |
| response.function_call_arguments.done     | 参数生成完成       | toolcall_delta（补齐尾部） |
| response.output_item.done(function_call)  | Tool Call 完成 | toolcall_end         |
| response.completed                        | 整个请求结束       | done                 |
| response.failed / error                   | 整个请求失败       | error                |
*/

type ProviderErrorEvent = {
    code: string
    message: string
    request_id?: string
}

export const streamOpenAIResponses: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
    model: Model<"openai-responses">,
    context: Context,
    options?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
    const stream = new AssistantMessageEventStream()
    ;(async () => {
        const output: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api as Api,
            provider: model.provider,
            model: model.id,
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
        }
        let currentItem:
            | ResponseReasoningItem
            | ResponseOutputMessage
            | ResponseFunctionToolCall
            | null = null
        let currentBlock:
            | ThinkingContent
            | TextContent
            | (ToolCall & { partialJson: string })
            | null = null
        const blocks = output.content
        const blockIndex = () => blocks.length - 1

        try {
            const apiKey = options?.apiKey || getEnvApiKey(model.provider) || ""
            const cacheRetention = resolveCacheRetention(options?.cacheRetention)
            const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId
            const client = createClient(model, apiKey, options?.headers, cacheSessionId)
            let params = buildParams(model, context, options)
            const nextParams = await options?.onPayload?.(params, model)
            if (nextParams !== undefined) {
                params = nextParams as ResponseCreateParamsStreaming
            }
            const requestOptions = {
                ...(options?.signal ? { signal: options.signal } : {}),
                ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
                maxRetries: options?.maxRetries ?? 0,
            }
            const { data: openaiStream, response } = await client.responses
                .create(params, requestOptions)
                .withResponse()
            await options?.onResponse?.(
                { status: response.status, headers: headersToRecord(response.headers) },
                model,
            )

            stream.push({
                type: "start",
                partial: output,
            })

            for await (const event of openaiStream) {
                // 兼容百炼返回的非标准错误
                if (isProviderErrorEvent(event)) {
                    throw new Error(`${event.code}: ${event.message}`)
                }

                switch (event.type) {
                    case "response.created":
                        break

                    // 开始输出一个新的 item（reasoning / message / function_call）
                    case "response.output_item.added": {
                        const item = event.item
                        if (item.type === "reasoning") {
                            currentItem = item
                            currentBlock = { type: "thinking", thinking: "" }
                            output.content.push(currentBlock)
                            stream.push({
                                type: "thinking_start",
                                contentIndex: blockIndex(),
                                partial: output,
                            })
                        } else if (item.type === "message") {
                            currentItem = item
                            currentBlock = { type: "text", text: "" }
                            output.content.push(currentBlock)
                            stream.push({
                                type: "text_start",
                                contentIndex: blockIndex(),
                                partial: output,
                            })
                        } else if (item.type === "function_call") {
                            currentItem = item
                            currentBlock = {
                                type: "toolCall",
                                id: item.call_id,
                                name: item.name,
                                arguments: {},
                                partialJson: item.arguments || "",
                            }
                            output.content.push(currentBlock)
                            stream.push({
                                type: "toolcall_start",
                                contentIndex: blockIndex(),
                                partial: output,
                            })
                        }
                        break
                    }

                    // reasoning 摘要文本增量(推理总结) 会逐步返回 summary 内容
                    case "response.reasoning_summary_text.delta": {
                        if (
                            currentItem?.type === "reasoning" &&
                            currentBlock?.type === "thinking"
                        ) {
                            currentBlock.thinking += event.delta
                            stream.push({
                                type: "thinking_delta",
                                contentIndex: blockIndex(),
                                delta: event.delta,
                                partial: output,
                            })
                        }
                        break
                    }

                    // 一个 reasoning summary 分段结束
                    case "response.reasoning_summary_part.done": {
                        if (
                            currentItem?.type === "reasoning" &&
                            currentBlock?.type === "thinking"
                        ) {
                            currentBlock.thinking += "\n\n"
                            stream.push({
                                type: "thinking_delta",
                                contentIndex: blockIndex(),
                                delta: "\n\n",
                                partial: output,
                            })
                        }
                        break
                    }

                    // reasoning 原始推理文本增量 模型正在持续生成思考内容
                    case "response.reasoning_text.delta": {
                        if (
                            currentItem?.type === "reasoning" &&
                            currentBlock?.type === "thinking"
                        ) {
                            currentBlock.thinking += event.delta
                            stream.push({
                                type: "thinking_delta",
                                contentIndex: blockIndex(),
                                delta: event.delta,
                                partial: output,
                            })
                        }
                        break
                    }

                    // message 中新增一个 content part, 可能是 output_text、refusal 等
                    case "response.content_part.added": {
                        if (currentItem?.type === "message") {
                            currentItem.content = currentItem.content || []
                            // Filter out ReasoningText, only accept output_text and refusal
                            if (
                                event.part.type === "output_text" ||
                                event.part.type === "refusal"
                            ) {
                                currentItem.content.push(event.part)
                            }
                        }
                        break
                    }

                    // 普通文本内容增量 最终会看到的回答正文
                    case "response.output_text.delta": {
                        if (currentItem?.type === "message" && currentBlock?.type === "text") {
                            if (!currentItem.content || currentItem.content.length === 0) {
                                continue
                            }
                            const lastPart = currentItem.content[currentItem.content.length - 1]
                            if (lastPart?.type === "output_text") {
                                currentBlock.text += event.delta
                                lastPart.text += event.delta
                                stream.push({
                                    type: "text_delta",
                                    contentIndex: blockIndex(),
                                    delta: event.delta,
                                    partial: output,
                                })
                            }
                        }
                        break
                    }

                    // 拒绝回答内容增量 当模型触发安全策略时返回的拒绝文本
                    case "response.refusal.delta": {
                        if (currentItem?.type === "message" && currentBlock?.type === "text") {
                            if (!currentItem.content || currentItem.content.length === 0) {
                                continue
                            }
                            const lastPart = currentItem.content[currentItem.content.length - 1]
                            if (lastPart?.type === "refusal") {
                                currentBlock.text += event.delta
                                lastPart.refusal += event.delta
                                stream.push({
                                    type: "text_delta",
                                    contentIndex: blockIndex(),
                                    delta: event.delta,
                                    partial: output,
                                })
                            }
                        }
                        break
                    }

                    // Tool Call 参数增量 函数调用 JSON 正在流式生成
                    case "response.function_call_arguments.delta": {
                        if (
                            currentItem?.type === "function_call" &&
                            currentBlock?.type === "toolCall"
                        ) {
                            currentBlock.partialJson += event.delta
                            currentBlock.arguments = parseStreamingJson(currentBlock.partialJson)
                            stream.push({
                                type: "toolcall_delta",
                                contentIndex: blockIndex(),
                                delta: event.delta,
                                partial: output,
                            })
                        }
                        break
                    }

                    // Tool Call 参数生成完成 此时拿到完整 arguments JSON
                    case "response.function_call_arguments.done": {
                        if (
                            currentItem?.type === "function_call" &&
                            currentBlock?.type === "toolCall"
                        ) {
                            const previousPartialJson = currentBlock.partialJson
                            currentBlock.partialJson = event.arguments
                            currentBlock.arguments = parseStreamingJson(currentBlock.partialJson)

                            if (event.arguments.startsWith(previousPartialJson)) {
                                const delta = event.arguments.slice(previousPartialJson.length)
                                if (delta.length > 0) {
                                    stream.push({
                                        type: "toolcall_delta",
                                        contentIndex: blockIndex(),
                                        delta,
                                        partial: output,
                                    })
                                }
                            }
                        }
                        break
                    }

                    // 当前 output item 完成 reasoning/message/function_call 的结束事件
                    case "response.output_item.done": {
                        const item = event.item

                        if (item.type === "reasoning" && currentBlock?.type === "thinking") {
                            const summaryText = item.summary?.map((s) => s.text).join("\n\n") || ""
                            const contentText = item.content?.map((c) => c.text).join("\n\n") || ""
                            currentBlock.thinking =
                                summaryText || contentText || currentBlock.thinking
                            stream.push({
                                type: "thinking_end",
                                contentIndex: blockIndex(),
                                content: currentBlock.thinking,
                                partial: output,
                            })
                            currentBlock = null
                        } else if (item.type === "message" && currentBlock?.type === "text") {
                            currentBlock.text = item.content
                                .map((c) => (c.type === "output_text" ? c.text : c.refusal))
                                .join("")
                            stream.push({
                                type: "text_end",
                                contentIndex: blockIndex(),
                                content: currentBlock.text,
                                partial: output,
                            })
                            currentBlock = null
                        } else if (item.type === "function_call") {
                            const args =
                                currentBlock?.type === "toolCall" && currentBlock.partialJson
                                    ? parseStreamingJson(currentBlock.partialJson)
                                    : parseStreamingJson(item.arguments || "{}")

                            let toolCall: ToolCall
                            if (currentBlock?.type === "toolCall") {
                                // Finalize in-place and strip the scratch buffer so replay only
                                // carries parsed arguments.
                                currentBlock.arguments = args
                                delete (currentBlock as { partialJson?: string }).partialJson
                                toolCall = currentBlock
                            } else {
                                toolCall = {
                                    type: "toolCall",
                                    id: item.call_id,
                                    name: item.name,
                                    arguments: args,
                                }
                            }

                            currentBlock = null
                            stream.push({
                                type: "toolcall_end",
                                contentIndex: blockIndex(),
                                toolCall,
                                partial: output,
                            })
                        }
                        break
                    }

                    // 整个 response 完成 所有 item 已生成结束
                    case "response.completed": {
                        const response = event.response

                        // Map status to stop reason
                        output.stopReason = mapStopReason(response?.status)
                        if (
                            output.content.some((b) => b.type === "toolCall") &&
                            output.stopReason === "stop"
                        ) {
                            output.stopReason = "toolUse"
                        }
                        break
                    }

                    // 流式过程中出现错误 通常是服务端或网络错误
                    case "error": {
                        throw new Error(
                            `Error Code ${event.code}: ${event.message}` || "Unknown error",
                        )
                    }

                    //  Response 执行失败 status=failed，包含具体失败原因
                    case "response.failed": {
                        const error = event.response?.error
                        const details = event.response?.incomplete_details
                        const msg = error
                            ? `${error.code || "unknown"}: ${error.message || "no message"}`
                            : details?.reason
                              ? `incomplete: ${details.reason}`
                              : "Unknown error (no error details in response)"
                        throw new Error(msg)
                    }
                }
            }

            if (output.stopReason === "aborted" || output.stopReason === "error") {
                throw new Error("An unknown error occurred")
            }
            stream.push({ type: "done", reason: output.stopReason, message: output })
            stream.end()
        } catch (error) {
            for (const block of output.content) {
                delete (block as { index?: number }).index
                // partialJson is only a streaming scratch buffer; never persist it.
                delete (block as { partialJson?: string }).partialJson
            }
            output.stopReason = "error"
            output.errorMessage = formatOpenAIResponsesError(error)
            stream.push({ type: "error", reason: output.stopReason, error: output })
            stream.end()
        }
    })()

    return stream
}

export const streamSimpleOpenAIResponses: StreamFunction<
    "openai-responses",
    SimpleStreamOptions
> = (
    model: Model<"openai-responses">,
    context: Context,
    options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
    const apiKey = options?.apiKey || getEnvApiKey(model.provider)
    if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`)
    }

    const base = buildBaseOptions(model, options, apiKey)
    const clampedReasoning = options?.reasoning
        ? clampThinkingLevel(model, options.reasoning)
        : undefined
    const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning

    return streamOpenAIResponses(model, context, {
        ...base,
        reasoningEffort,
    } satisfies OpenAIResponsesOptions)
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
    if (!status) return "stop"
    switch (status) {
        case "completed":
            return "stop"
        case "incomplete":
            return "length"
        case "failed":
        case "cancelled":
            return "error"
        case "in_progress":
        case "queued":
            return "stop"
        default: {
            const _exhaustive: never = status
            throw new Error(`Unhandled stop reason: ${_exhaustive}`)
        }
    }
}

function formatOpenAIResponsesError(error: unknown): string {
    if (error instanceof Error) {
        const status = (error as Error & { status?: unknown }).status
        const statusCode = typeof status === "number" ? status : undefined
        if (statusCode !== undefined) {
            return `OpenAI API error (${statusCode}): ${error.message}`
        }
        return error.message
    }
    try {
        return JSON.stringify(error)
    } catch {
        return String(error)
    }
}

export function convertResponsesMessages<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    allowedToolCallProviders: ReadonlySet<string>,
    options?: ConvertResponsesMessagesOptions,
): ResponseInput {
    const messages: ResponseInput = []

    const normalizeIdPart = (part: string): string => {
        const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_")
        const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized
        return normalized.replace(/_+$/, "")
    }

    const buildForeignResponsesItemId = (itemId: string): string => {
        const normalized = `fc_${shortHash(itemId)}`
        return normalized.length > 64 ? normalized.slice(0, 64) : normalized
    }

    const normalizeToolCallId = (
        id: string,
        _targetModel: Model<TApi>,
        source: AssistantMessage,
    ): string => {
        if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id)
        if (!id.includes("|")) return normalizeIdPart(id)
        const [callId, itemId] = id.split("|")
        const normalizedCallId = normalizeIdPart(callId)
        const isForeignToolCall = source.provider !== model.provider || source.api !== model.api
        let normalizedItemId = isForeignToolCall
            ? buildForeignResponsesItemId(itemId)
            : normalizeIdPart(itemId)
        // OpenAI Responses API requires item id to start with "fc"
        if (!normalizedItemId.startsWith("fc_")) {
            normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`)
        }
        return `${normalizedCallId}|${normalizedItemId}`
    }

    const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId)

    const includeSystemPrompt = options?.includeSystemPrompt ?? true
    if (includeSystemPrompt && context.systemPrompt) {
        const role = model.reasoning ? "developer" : "system"
        messages.push({
            role,
            content: sanitizeSurrogates(context.systemPrompt),
        })
    }

    let msgIndex = 0
    for (const msg of transformedMessages) {
        if (msg.role === "user") {
            if (typeof msg.content === "string") {
                messages.push({
                    role: "user",
                    content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
                })
            } else {
                const content: ResponseInputContent[] = msg.content.map(
                    (item): ResponseInputContent => {
                        if (item.type === "text") {
                            return {
                                type: "input_text",
                                text: sanitizeSurrogates(item.text),
                            } satisfies ResponseInputText
                        }
                        return {
                            type: "input_image",
                            detail: "auto",
                            image_url: `data:${item.mimeType};base64,${item.data}`,
                        } satisfies ResponseInputImage
                    },
                )
                if (content.length === 0) continue
                messages.push({
                    role: "user",
                    content,
                })
            }
        } else if (msg.role === "assistant") {
            const output: ResponseInput = []
            const assistantMsg = msg as AssistantMessage
            const isDifferentModel =
                assistantMsg.model !== model.id &&
                assistantMsg.provider === model.provider &&
                assistantMsg.api === model.api

            for (const block of msg.content) {
                if (block.type === "thinking") {
                    if (block.thinkingSignature) {
                        const reasoningItem = JSON.parse(
                            block.thinkingSignature,
                        ) as ResponseReasoningItem
                        output.push(reasoningItem)
                    }
                } else if (block.type === "text") {
                    const textBlock = block as TextContent
                    const parsedSignature = parseTextSignature(textBlock.textSignature)
                    // OpenAI requires id to be max 64 characters
                    let msgId = parsedSignature?.id
                    if (!msgId) {
                        msgId = `msg_${msgIndex}`
                    } else if (msgId.length > 64) {
                        msgId = `msg_${shortHash(msgId)}`
                    }
                    output.push({
                        type: "message",
                        role: "assistant",
                        content: [
                            {
                                type: "output_text",
                                text: sanitizeSurrogates(textBlock.text),
                                annotations: [],
                            },
                        ],
                        status: "completed",
                        id: msgId,
                        phase: parsedSignature?.phase,
                    } satisfies ResponseOutputMessage)
                } else if (block.type === "toolCall") {
                    const toolCall = block as ToolCall
                    const [callId, itemIdRaw] = toolCall.id.split("|")
                    let itemId: string | undefined = itemIdRaw

                    // For different-model messages, set id to undefined to avoid pairing validation.
                    // OpenAI tracks which fc_xxx IDs were paired with rs_xxx reasoning items.
                    // By omitting the id, we avoid triggering that validation (like cross-provider does).
                    if (isDifferentModel && itemId?.startsWith("fc_")) {
                        itemId = undefined
                    }

                    output.push({
                        type: "function_call",
                        id: itemId,
                        call_id: callId,
                        name: toolCall.name,
                        arguments: JSON.stringify(toolCall.arguments),
                    })
                }
            }
            if (output.length === 0) continue
            messages.push(...output)
        } else if (msg.role === "toolResult") {
            const textResult = msg.content
                .filter((c): c is TextContent => c.type === "text")
                .map((c) => c.text)
                .join("\n")
            const hasImages = msg.content.some((c): c is ImageContent => c.type === "image")
            const hasText = textResult.length > 0
            const [callId] = msg.toolCallId.split("|")

            let output: string | ResponseFunctionCallOutputItemList
            if (hasImages && model.input.includes("image")) {
                const contentParts: ResponseFunctionCallOutputItemList = []

                if (hasText) {
                    contentParts.push({
                        type: "input_text",
                        text: sanitizeSurrogates(textResult),
                    })
                }

                for (const block of msg.content) {
                    if (block.type === "image") {
                        contentParts.push({
                            type: "input_image",
                            detail: "auto",
                            image_url: `data:${block.mimeType};base64,${block.data}`,
                        })
                    }
                }

                output = contentParts
            } else {
                output = sanitizeSurrogates(hasText ? textResult : "(see attached image)")
            }

            messages.push({
                type: "function_call_output",
                call_id: callId,
                output,
            })
        }
        msgIndex++
    }

    return messages
}

export function convertResponsesTools(
    tools: Tool[],
    options?: ConvertResponsesToolsOptions,
): OpenAITool[] {
    const strict = options?.strict === undefined ? false : options.strict
    return tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as any, // TypeBox already generates JSON Schema
        strict,
    }))
}

function parseTextSignature(
    signature: string | undefined,
): { id: string; phase?: TextSignatureV1["phase"] } | undefined {
    if (!signature) return undefined
    if (signature.startsWith("{")) {
        try {
            const parsed = JSON.parse(signature) as Partial<TextSignatureV1>
            if (parsed.v === 1 && typeof parsed.id === "string") {
                if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
                    return { id: parsed.id, phase: parsed.phase }
                }
                return { id: parsed.id }
            }
        } catch {
            // Fall through to legacy plain-string handling.
        }
    }
    return { id: signature }
}

function isProviderErrorEvent(event: unknown): event is ProviderErrorEvent {
    return (
        typeof event === "object" &&
        event !== null &&
        "code" in event &&
        "message" in event &&
        typeof (event as any).code === "string" &&
        typeof (event as any).message === "string" &&
        !("type" in event)
    )
}

/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
    if (cacheRetention) {
        return cacheRetention
    }
    if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") {
        return "long"
    }
    return "short"
}

function getCompat(model: Model<"openai-responses">): Required<OpenAIResponsesCompat> {
    return {
        sendSessionIdHeader: model.compat?.sendSessionIdHeader ?? true,
        supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    }
}

function createClient(
    model: Model<"openai-responses">,
    apiKey?: string,
    optionsHeaders?: Record<string, string>,
    sessionId?: string,
) {
    const compat = getCompat(model)
    const headers = { ...model.headers }

    if (sessionId) {
        if (compat.sendSessionIdHeader) {
            headers.session_id = sessionId
        }
        headers["x-client-request-id"] = sessionId
    }

    // Merge options headers last so they can override defaults
    if (optionsHeaders) {
        Object.assign(headers, optionsHeaders)
    }

    return new OpenAI({
        apiKey,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        defaultHeaders: headers,
    })
}

function buildParams(
    model: Model<"openai-responses">,
    context: Context,
    options?: OpenAIResponsesOptions,
) {
    const messages = convertResponsesMessages(
        model,
        context,
        new Set(["openai", "openai-codex", "opencode"]),
    )
    const params: ResponseCreateParamsStreaming = {
        model: model.id,
        input: messages,
        stream: true,
    }

    if (options?.maxTokens) {
        params.max_output_tokens = options?.maxTokens
    }

    if (options?.temperature !== undefined) {
        params.temperature = options?.temperature
    }

    if (options?.serviceTier !== undefined) {
        params.service_tier = options.serviceTier
    }

    if (context.tools && context.tools.length > 0) {
        params.tools = convertResponsesTools(context.tools)
    }

    if (model.reasoning) {
        if (options?.reasoningEffort || options?.reasoningSummary) {
            const effort = options?.reasoningEffort
                ? (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort)
                : "medium"
            params.reasoning = {
                effort: effort as NonNullable<typeof params.reasoning>["effort"],
                summary: options?.reasoningSummary || "auto",
            }
            params.include = ["reasoning.encrypted_content"]
        }
    }

    return params
}
