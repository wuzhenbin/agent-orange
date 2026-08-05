import type { AgentMessage, CompactionSummaryMessage } from "../types.ts"
import type { Message } from "../../agent-ai/types.ts"

export function createCompactionSummaryMessage(
    summary: string,
    tokensBefore: number,
    timestamp: string,
): CompactionSummaryMessage {
    return {
        role: "compactionSummary",
        summary: summary,
        tokensBefore,
        timestamp: new Date(timestamp).getTime(),
    }
}

/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 *
 * This is used by:
 * - Agent's transormToLlm option (for prompt calls and queued messages)
 * - Compaction's generateSummary (for summarization)
 * - Custom extensions and tools
 */
export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`
export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`
export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`

export function convertToLlm(messages: AgentMessage[]): Message[] {
    return messages
        .map((m): Message | undefined => {
            switch (m.role) {
                case "compactionSummary":
                    return {
                        role: "user",
                        content: [
                            {
                                type: "text" as const,
                                text:
                                    COMPACTION_SUMMARY_PREFIX +
                                    m.summary +
                                    COMPACTION_SUMMARY_SUFFIX,
                            },
                        ],
                        timestamp: m.timestamp,
                    }
                case "user":
                case "assistant":
                case "toolResult":
                    return m
                default:
                    return undefined
            }
        })
        .filter((m) => m !== undefined)
}
