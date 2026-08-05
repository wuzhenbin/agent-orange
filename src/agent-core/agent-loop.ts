import {
    AgentContext,
    AgentMessage,
    AgentLoopConfig,
    StreamFn,
    AgentEvent,
    AgentEventSink,
} from "./types.ts"
import { ToolResultMessage, AssistantMessage, Context } from "../agent-ai/types.ts"
import { executeToolCalls } from "./tool-execute.ts"
import { streamSimple } from "../agent-ai/stream.ts"
import { EventStream } from "../utils/event-stream.ts"

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
    return new EventStream<AgentEvent, AgentMessage[]>(
        (event: AgentEvent) => event.type === "agent_end",
        (event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
    )
}

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
    prompts: AgentMessage[],
    context: AgentContext,
    config: AgentLoopConfig,
    signal?: AbortSignal,
    streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
    const stream = createAgentStream()

    void runAgentLoop(
        prompts,
        context,
        config,
        async (event) => {
            stream.push(event)
        },
        signal,
        streamFn,
    ).then((messages) => {
        stream.end(messages)
    })

    return stream
}

export async function runAgentLoop(
    prompts: AgentMessage[],
    context: AgentContext,
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal?: AbortSignal,
    streamFn?: StreamFn,
): Promise<AgentMessage[]> {
    const newMessages: AgentMessage[] = [...prompts]
    const currentContext: AgentContext = {
        ...context,
        messages: [...context.messages, ...prompts],
    }

    await emit({ type: "agent_start" })
    await emit({ type: "turn_start" })
    for (const prompt of prompts) {
        await emit({ type: "message_start", message: prompt })
        await emit({ type: "message_end", message: prompt })
    }

    await runLoop(currentContext, newMessages, config, signal, emit, streamFn)
    return newMessages
}

export async function runAgentLoopContinue(
    context: AgentContext,
    config: AgentLoopConfig,
    emit: AgentEventSink,
    signal?: AbortSignal,
    streamFn?: StreamFn,
): Promise<AgentMessage[]> {
    if (context.messages.length === 0) {
        throw new Error("Cannot continue: no messages in context")
    }

    if (context.messages[context.messages.length - 1].role === "assistant") {
        throw new Error("Cannot continue from message role: assistant")
    }

    const newMessages: AgentMessage[] = []
    const currentContext: AgentContext = { ...context }

    await emit({ type: "agent_start" })
    await emit({ type: "turn_start" })

    await runLoop(currentContext, newMessages, config, signal, emit, streamFn)
    return newMessages
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 * 两层循环 + 一个状态机
 * Inner Loop = 一次 Agent 连续思考
 * Outer Loop = Agent 已经结束，又收到新的消息，继续工作
 */
export async function runLoop(
    initialContext: AgentContext,
    newMessages: AgentMessage[],
    initialConfig: AgentLoopConfig,
    signal: AbortSignal | undefined,
    emit: AgentEventSink,
    streamFn?: StreamFn,
): Promise<void> {
    let currentContext = initialContext
    let config = initialConfig
    let firstTurn = true
    // Check for steering messages at start (user may have typed while waiting)
    // 开始之前先看看用户有没有插话
    let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || []

    // Outer loop: continues when queued follow-up messages arrive after agent would stop
    while (true) {
        let hasMoreToolCalls = true

        // Inner loop: process tool calls and steering messages
        // 内层循环: 只要有工具调用 or 有新的 Steering Message
        while (hasMoreToolCalls || pendingMessages.length > 0) {
            // 第一轮没有 turn_start 因为 AgentLoop 本身就是第一轮
            if (!firstTurn) {
                await emit({ type: "turn_start" })
            } else {
                firstTurn = false
            }

            // Process pending messages (inject before next assistant response)
            // 把用户插话真正加入 Conversation
            if (pendingMessages.length > 0) {
                for (const message of pendingMessages) {
                    await emit({ type: "message_start", message })
                    await emit({ type: "message_end", message })
                    currentContext.messages.push(message)
                    newMessages.push(message)
                }
                pendingMessages = []
            }

            // Stream assistant response
            const message = await streamAssistantResponse(
                currentContext,
                config,
                signal,
                emit,
                streamFn,
            )
            // 大模型返回结果插入 Conversation
            newMessages.push(message)

            // 网络错误 / AbortSignal 直接结束
            if (message.stopReason === "error" || message.stopReason === "aborted") {
                await emit({ type: "turn_end", message, toolResults: [] })
                await emit({ type: "agent_end", messages: newMessages })
                return
            }

            // Check for tool calls 检查工具调用消息
            const toolCalls = message.content.filter((c) => c.type === "toolCall")
            const toolResults: ToolResultMessage[] = []
            hasMoreToolCalls = false
            if (toolCalls.length > 0) {
                const executedToolBatch = await executeToolCalls(
                    currentContext,
                    message,
                    config,
                    signal,
                    emit,
                )
                toolResults.push(...executedToolBatch.messages)
                // 是否有还有工具调用
                hasMoreToolCalls = !executedToolBatch.terminate

                // ToolResults 被加入 Conversation
                for (const result of toolResults) {
                    currentContext.messages.push(result)
                    newMessages.push(result)
                }
            }
            // 一次完整 Turn 结束
            await emit({ type: "turn_end", message, toolResults })

            const nextTurnContext = {
                message,
                toolResults,
                context: currentContext,
                newMessages,
            }
            // hook - 允许下一轮修改 Context、Model、Reasoning
            const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext)
            if (nextTurnSnapshot) {
                currentContext = nextTurnSnapshot.context ?? currentContext
                config = {
                    ...config,
                    model: nextTurnSnapshot.model ?? config.model,
                    reasoning:
                        nextTurnSnapshot.thinkingLevel === undefined
                            ? config.reasoning
                            : nextTurnSnapshot.thinkingLevel === "off"
                              ? undefined
                              : nextTurnSnapshot.thinkingLevel,
                }
            }

            if (
                // hook - 已经回答完 / 达到最大轮数 / 用户取消 都可以结束
                await config.shouldStopAfterTurn?.({
                    message,
                    toolResults,
                    context: currentContext,
                    newMessages,
                })
            ) {
                await emit({ type: "agent_end", messages: newMessages })
                return
            }

            pendingMessages = (await config.getSteeringMessages?.()) || []
        }

        // Agent would stop here. Check for follow-up messages.
        const followUpMessages = (await config.getFollowUpMessages?.()) || []
        if (followUpMessages.length > 0) {
            // Set as pending so inner loop processes them
            pendingMessages = followUpMessages
            continue
        }

        // No more messages, exit
        break
    }

    await emit({ type: "agent_end", messages: newMessages })
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
    context: AgentContext,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    emit: AgentEventSink,
    streamFn?: StreamFn,
): Promise<AssistantMessage> {
    // Apply context transform if configured (AgentMessage[] → AgentMessage[])
    let messages = context.messages
    // 上下文转换
    if (config.transformContext) {
        messages = await config.transformContext(messages, signal)
    }
    // Convert to LLM-compatible messages (AgentMessage[] → Message[])
    const llmMessages = await config.convertToLlm(messages)

    // Build LLM context
    const llmContext: Context = {
        systemPrompt: context.systemPrompt,
        messages: llmMessages,
        tools: context.tools,
    }

    const streamFunction = streamFn || streamSimple

    // Resolve API key (important for expiring tokens)
    const resolvedApiKey =
        (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) ||
        config.apiKey

    const response = await streamFunction(config.model, llmContext, {
        ...config,
        apiKey: resolvedApiKey,
        signal,
    })

    let partialMessage: AssistantMessage | null = null
    let addedPartial = false

    for await (const event of response) {
        switch (event.type) {
            case "start":
                partialMessage = event.partial
                context.messages.push(partialMessage)
                addedPartial = true
                await emit({ type: "message_start", message: { ...partialMessage } })
                break

            case "text_start":
            case "text_delta":
            case "text_end":
            case "thinking_start":
            case "thinking_delta":
            case "thinking_end":
            case "toolcall_start":
            case "toolcall_delta":
            case "toolcall_end":
                if (partialMessage) {
                    partialMessage = event.partial
                    // 替换最后一条消息 Context 永远只有 一条正在生成的 assistant message
                    context.messages[context.messages.length - 1] = partialMessage
                    await emit({
                        type: "message_update",
                        assistantMessageEvent: event,
                        message: { ...partialMessage },
                    })
                }
                break

            case "done":
            case "error": {
                const finalMessage = await response.result()
                if (addedPartial) {
                    context.messages[context.messages.length - 1] = finalMessage
                } else {
                    context.messages.push(finalMessage)
                }
                if (!addedPartial) {
                    await emit({ type: "message_start", message: { ...finalMessage } })
                }
                await emit({ type: "message_end", message: finalMessage })
                return finalMessage
            }
        }
    }

    const finalMessage = await response.result()
    if (addedPartial) {
        context.messages[context.messages.length - 1] = finalMessage
    } else {
        context.messages.push(finalMessage)
        await emit({ type: "message_start", message: { ...finalMessage } })
    }
    await emit({ type: "message_end", message: finalMessage })
    return finalMessage
}
