import {
    AgentContext,
    AgentLoopConfig,
    AgentEventSink,
    AgentToolCall,
    AgentToolResult,
    AgentTool,
} from "./types.ts"
import { ToolResultMessage, AssistantMessage } from "../agent-ai/types.ts"
import { validateToolArguments } from "../utils/validation.ts"

/**
 * Execute tool calls from an assistant message.
 */
type ExecutedToolCallBatch = {
    messages: ToolResultMessage[]
    terminate: boolean
}

type FinalizedToolCallOutcome = {
    toolCall: AgentToolCall
    result: AgentToolResult<any>
    isError: boolean
}

type PreparedToolCall = {
    kind: "prepared"
    toolCall: AgentToolCall
    tool: AgentTool<any>
    args: unknown
}

type ImmediateToolCallOutcome = {
    kind: "immediate"
    result: AgentToolResult<any>
    isError: boolean
}

type ExecutedToolCallOutcome = {
    result: AgentToolResult<any>
    isError: boolean
}

type FinalizedToolCallEntry = FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>)

function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
    return (
        finalizedCalls.length > 0 &&
        finalizedCalls.every((finalized) => finalized.result.terminate === true)
    )
}

function createErrorToolResult(message: string): AgentToolResult<any> {
    return {
        content: [{ type: "text", text: message }],
        details: {},
    }
}

async function emitToolExecutionEnd(
    finalized: FinalizedToolCallOutcome,
    emit: AgentEventSink,
): Promise<void> {
    await emit({
        type: "tool_execution_end",
        toolCallId: finalized.toolCall.id,
        toolName: finalized.toolCall.name,
        result: finalized.result,
        isError: finalized.isError,
    })
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: finalized.toolCall.id,
        toolName: finalized.toolCall.name,
        content: finalized.result.content,
        details: finalized.result.details,
        isError: finalized.isError,
        timestamp: Date.now(),
    }
}

async function emitToolResultMessage(
    toolResultMessage: ToolResultMessage,
    emit: AgentEventSink,
): Promise<void> {
    await emit({ type: "message_start", message: toolResultMessage })
    await emit({ type: "message_end", message: toolResultMessage })
}

export async function executeToolCalls(
    currentContext: AgentContext,
    assistantMessage: AssistantMessage,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall")
    const hasSequentialToolCall = toolCalls.some(
        (tc) =>
            currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
    )
    // 按顺序调用工具
    if (config.toolExecution === "sequential" || hasSequentialToolCall) {
        return executeToolCallsSequential(
            currentContext,
            assistantMessage,
            toolCalls,
            config,
            signal,
            emit,
        )
    }
    // 并发调用工具
    return executeToolCallsParallel(
        currentContext,
        assistantMessage,
        toolCalls,
        config,
        signal,
        emit,
    )
}

// 按顺序调用工具
async function executeToolCallsSequential(
    currentContext: AgentContext,
    assistantMessage: AssistantMessage,
    toolCalls: AgentToolCall[],
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
    const finalizedCalls: FinalizedToolCallOutcome[] = []
    const messages: ToolResultMessage[] = []

    for (const toolCall of toolCalls) {
        await emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        })

        const preparation = await prepareToolCall(
            currentContext,
            assistantMessage,
            toolCall,
            config,
            signal,
        )
        let finalized: FinalizedToolCallOutcome
        if (preparation.kind === "immediate") {
            finalized = {
                toolCall,
                result: preparation.result,
                isError: preparation.isError,
            }
        } else {
            const executed = await executePreparedToolCall(preparation, signal, emit)
            finalized = await finalizeExecutedToolCall(
                currentContext,
                assistantMessage,
                preparation,
                executed,
                config,
                signal,
            )
        }

        await emitToolExecutionEnd(finalized, emit)
        const toolResultMessage = createToolResultMessage(finalized)
        await emitToolResultMessage(toolResultMessage, emit)
        finalizedCalls.push(finalized)
        messages.push(toolResultMessage)

        if (signal?.aborted) {
            break
        }
    }

    return {
        messages,
        terminate: shouldTerminateToolBatch(finalizedCalls),
    }
}

// 并发调用工具
async function executeToolCallsParallel(
    currentContext: AgentContext,
    assistantMessage: AssistantMessage,
    toolCalls: AgentToolCall[],
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
    emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
    const finalizedCalls: FinalizedToolCallEntry[] = []

    for (const toolCall of toolCalls) {
        await emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        })

        const preparation = await prepareToolCall(
            currentContext,
            assistantMessage,
            toolCall,
            config,
            signal,
        )
        if (preparation.kind === "immediate") {
            const finalized = {
                toolCall,
                result: preparation.result,
                isError: preparation.isError,
            } satisfies FinalizedToolCallOutcome
            await emitToolExecutionEnd(finalized, emit)
            finalizedCalls.push(finalized)
            if (signal?.aborted) {
                break
            }
            continue
        }

        finalizedCalls.push(async () => {
            const executed = await executePreparedToolCall(preparation, signal, emit)
            const finalized = await finalizeExecutedToolCall(
                currentContext,
                assistantMessage,
                preparation,
                executed,
                config,
                signal,
            )
            await emitToolExecutionEnd(finalized, emit)
            return finalized
        })
        if (signal?.aborted) {
            break
        }
    }

    const orderedFinalizedCalls = await Promise.all(
        finalizedCalls.map((entry) =>
            typeof entry === "function" ? entry() : Promise.resolve(entry),
        ),
    )
    const messages: ToolResultMessage[] = []
    for (const finalized of orderedFinalizedCalls) {
        const toolResultMessage = createToolResultMessage(finalized)
        await emitToolResultMessage(toolResultMessage, emit)
        messages.push(toolResultMessage)
    }

    return {
        messages,
        terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
    }
}

async function finalizeExecutedToolCall(
    currentContext: AgentContext,
    assistantMessage: AssistantMessage,
    prepared: PreparedToolCall,
    executed: ExecutedToolCallOutcome,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
): Promise<FinalizedToolCallOutcome> {
    let result = executed.result
    let isError = executed.isError

    if (config.afterToolCall) {
        try {
            const afterResult = await config.afterToolCall(
                {
                    assistantMessage,
                    toolCall: prepared.toolCall,
                    args: prepared.args,
                    result,
                    isError,
                    context: currentContext,
                },
                signal,
            )
            if (afterResult) {
                result = {
                    content: afterResult.content ?? result.content,
                    details: afterResult.details ?? result.details,
                    terminate: afterResult.terminate ?? result.terminate,
                }
                isError = afterResult.isError ?? isError
            }
        } catch (error) {
            result = createErrorToolResult(error instanceof Error ? error.message : String(error))
            isError = true
        }
    }

    return {
        toolCall: prepared.toolCall,
        result,
        isError,
    }
}

async function executePreparedToolCall(
    prepared: PreparedToolCall,
    signal: AbortSignal | undefined,
    emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
    const updateEvents: Promise<void>[] = []

    try {
        const result = await prepared.tool.execute(
            prepared.toolCall.id,
            prepared.args as never,
            signal,
            (partialResult) => {
                updateEvents.push(
                    Promise.resolve(
                        emit({
                            type: "tool_execution_update",
                            toolCallId: prepared.toolCall.id,
                            toolName: prepared.toolCall.name,
                            args: prepared.toolCall.arguments,
                            partialResult,
                        }),
                    ),
                )
            },
        )
        await Promise.all(updateEvents)
        return { result, isError: false }
    } catch (error) {
        await Promise.all(updateEvents)
        return {
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        }
    }
}

async function prepareToolCall(
    currentContext: AgentContext,
    assistantMessage: AssistantMessage,
    toolCall: AgentToolCall,
    config: AgentLoopConfig,
    signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
    const tool = currentContext.tools?.find((t) => t.name === toolCall.name)
    if (!tool) {
        return {
            kind: "immediate",
            result: createErrorToolResult(`Tool ${toolCall.name} not found`),
            isError: true,
        }
    }

    try {
        const validatedArgs = validateToolArguments(tool, toolCall)
        if (config.beforeToolCall) {
            const beforeResult = await config.beforeToolCall(
                {
                    assistantMessage,
                    toolCall,
                    args: validatedArgs,
                    context: currentContext,
                },
                signal,
            )
            if (signal?.aborted) {
                return {
                    kind: "immediate",
                    result: createErrorToolResult("Operation aborted"),
                    isError: true,
                }
            }
            if (beforeResult?.block) {
                return {
                    kind: "immediate",
                    result: createErrorToolResult(
                        beforeResult.reason || "Tool execution was blocked",
                    ),
                    isError: true,
                }
            }
        }
        if (signal?.aborted) {
            return {
                kind: "immediate",
                result: createErrorToolResult("Operation aborted"),
                isError: true,
            }
        }
        return {
            kind: "prepared",
            toolCall,
            tool,
            args: validatedArgs,
        }
    } catch (error) {
        return {
            kind: "immediate",
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        }
    }
}
