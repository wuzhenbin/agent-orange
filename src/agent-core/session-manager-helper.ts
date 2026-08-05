import { closeSync, existsSync, openSync, readSync, mkdirSync, createReadStream } from "fs"
import { stat } from "fs/promises"
import { StringDecoder } from "string_decoder"
import { AgentMessage } from "./types.ts"
import { createCompactionSummaryMessage } from "./harness/message.ts"
import { Message, TextContent } from "../agent-ai/types.ts"
import { randomUUID } from "crypto"
import { getGlobalDir } from "../config/path-config.ts"
import { normalizePath, resolvePath } from "../utils/paths.ts"
import { join } from "path"
import { createInterface } from "readline"

export interface SessionInfo {
    path: string
    id: string
    /** Working directory where the session was started. Empty string for old sessions. */
    cwd: string
    /** User-defined display name from session_info entries. */
    name?: string
    /** Path to the parent session (if this session was forked). */
    parentSessionPath?: string
    created: Date
    modified: Date
    messageCount: number
    firstMessage: string
    allMessagesText: string
}
export type SessionListProgress = (loaded: number, total: number) => void

export interface SessionContext {
    messages: AgentMessage[]
}

export interface SessionHeader {
    type: "session"
    id: string
    timestamp: string
    cwd: string
}

export interface SessionEntryBase {
    type: string
    id: string
    parentId: string | null
    timestamp: string
}

export interface SessionMessageEntry extends SessionEntryBase {
    type: "message"
    message: AgentMessage
}

export interface CompactionEntry<T = unknown> extends SessionEntryBase {
    type: "compaction"
    summary: string
    firstKeptEntryId: string
    tokensBefore: number
    /** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
    details?: T
}

/** Session metadata entry (e.g., user-defined display name). */
export interface SessionInfoEntry extends SessionEntryBase {
    type: "session_info"
    name?: string
}

/** Session entry - has id/parentId for tree structure (returned by "read" methods in SessionManager) */
export type SessionEntry = SessionMessageEntry | CompactionEntry | SessionInfoEntry

/** Raw file entry (includes header) */
export type FileEntry = SessionHeader | SessionEntry

export function getLatestCompactionEntry(entries: SessionEntry[]): CompactionEntry | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === "compaction") {
            return entries[i] as CompactionEntry
        }
    }
    return null
}

/** Generate a unique short ID (8 hex chars, collision-checked) */
export function generateId(byId: { has(id: string): boolean }): string {
    for (let i = 0; i < 100; i++) {
        const id = randomUUID().slice(0, 8)
        if (!byId.has(id)) return id
    }
    // Fallback to full UUID if somehow we have collisions
    return randomUUID()
}

export function assertValidSessionId(id: string): void {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
        throw new Error(
            "Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character",
        )
    }
}

/** Exported  */
export function loadEntriesFromFile(filePath: string): FileEntry[] {
    const SESSION_READ_BUFFER_SIZE = 1024 * 1024
    const resolvedFilePath = normalizePath(filePath)
    if (!existsSync(resolvedFilePath)) return []

    const entries: FileEntry[] = []
    const fd = openSync(resolvedFilePath, "r")
    try {
        const decoder = new StringDecoder("utf8")
        const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE)
        let pending = ""

        while (true) {
            const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
            if (bytesRead === 0) break

            pending += decoder.write(buffer.subarray(0, bytesRead))
            let lineStart = 0
            let newlineIndex = pending.indexOf("\n", lineStart)
            while (newlineIndex !== -1) {
                const entry = parseSessionEntryLine(pending.slice(lineStart, newlineIndex))
                if (entry) entries.push(entry)
                lineStart = newlineIndex + 1
                newlineIndex = pending.indexOf("\n", lineStart)
            }
            pending = pending.slice(lineStart)
        }

        pending += decoder.end()
        const finalEntry = parseSessionEntryLine(pending)
        if (finalEntry) entries.push(finalEntry)
    } finally {
        closeSync(fd)
    }

    // Validate session header
    if (entries.length === 0) return entries
    const header = entries[0]
    if (header.type !== "session" || typeof (header as { id?: unknown }).id !== "string") {
        return []
    }

    return entries
}

function parseSessionEntryLine(line: string): FileEntry | null {
    if (!line.trim()) return null
    try {
        return JSON.parse(line) as FileEntry
    } catch {
        // Skip malformed lines
        return null
    }
}

export function getDefaultSessionDir(agentDir: string = getGlobalDir()): string {
    const resolvedAgentDir = resolvePath(agentDir)
    const sessionDir = join(resolvedAgentDir, "sessions")
    if (!existsSync(sessionDir)) {
        mkdirSync(sessionDir, { recursive: true })
    }
    return sessionDir
}

/**
 * Build the session context from entries using tree traversal.
 * If leafId is provided, walks from that entry to root.
 * Handles compaction and branch summaries along the path.
 */
export function buildSessionContext(
    entries: SessionEntry[],
    leafId?: string | null,
    byId?: Map<string, SessionEntry>,
): SessionContext {
    // Build uuid index if not available
    if (!byId) {
        byId = new Map<string, SessionEntry>()
        for (const entry of entries) {
            byId.set(entry.id, entry)
        }
    }

    // Find leaf
    let leaf: SessionEntry | undefined
    if (leafId === null) {
        // Explicitly null - return no messages (navigated to before first entry)
        return { messages: [] }
    }
    if (leafId) {
        leaf = byId.get(leafId)
    }
    if (!leaf) {
        // Fallback to last entry (when leafId is undefined)
        leaf = entries[entries.length - 1]
    }

    if (!leaf) {
        return { messages: [] }
    }

    // Walk from leaf to root, collecting path
    const path: SessionEntry[] = []
    let current: SessionEntry | undefined = leaf
    while (current) {
        path.push(current)
        current = current.parentId ? byId.get(current.parentId) : undefined
    }
    path.reverse()

    let compaction: CompactionEntry | null = null
    for (const entry of path) {
        if (entry.type === "compaction") {
            compaction = entry
        }
    }

    // Build messages and collect corresponding entries
    // When there's a compaction, we need to:
    // 1. Emit summary first (entry = compaction)
    // 2. Emit kept messages (from firstKeptEntryId up to compaction)
    // 3. Emit messages after compaction
    const messages: AgentMessage[] = []

    const appendMessage = (entry: SessionEntry) => {
        if (entry.type === "message") {
            messages.push(entry.message)
        }
    }

    if (compaction) {
        // Emit summary first
        messages.push(
            createCompactionSummaryMessage(
                compaction.summary,
                compaction.tokensBefore,
                compaction.timestamp,
            ),
        )

        // Find compaction index in path
        const compactionIdx = path.findIndex(
            (e) => e.type === "compaction" && e.id === compaction.id,
        )

        // Emit kept messages (before compaction, starting from firstKeptEntryId)
        let foundFirstKept = false
        for (let i = 0; i < compactionIdx; i++) {
            const entry = path[i]
            if (entry.id === compaction.firstKeptEntryId) {
                foundFirstKept = true
            }
            if (foundFirstKept) {
                appendMessage(entry)
            }
        }

        // Emit messages after compaction
        for (let i = compactionIdx + 1; i < path.length; i++) {
            const entry = path[i]
            appendMessage(entry)
        }
    } else {
        // No compaction - emit all messages, handle branch summaries and custom messages
        for (const entry of path) {
            appendMessage(entry)
        }
    }

    return { messages }
}

const MAX_CONCURRENT_SESSION_INFO_LOADS = 10
export async function buildSessionInfosWithConcurrency(
    files: string[],
    onLoaded: () => void,
): Promise<(SessionInfo | null)[]> {
    const results: (SessionInfo | null)[] = new Array(files.length).fill(null)
    const inFlight = new Set<Promise<void>>()
    let nextIndex = 0

    const startNext = (): void => {
        const index = nextIndex++
        const file = files[index]
        if (!file) return

        let task: Promise<void>
        task = buildSessionInfo(file)
            .then((info) => {
                results[index] = info
            })
            .catch(() => {
                results[index] = null
            })
            .finally(() => {
                inFlight.delete(task)
                onLoaded()
            })
        inFlight.add(task)
    }

    while (nextIndex < files.length || inFlight.size > 0) {
        while (nextIndex < files.length && inFlight.size < MAX_CONCURRENT_SESSION_INFO_LOADS) {
            startNext()
        }
        if (inFlight.size > 0) {
            await Promise.race(inFlight)
        }
    }

    return results
}

async function buildSessionInfo(filePath: string): Promise<SessionInfo | null> {
    try {
        const stats = await stat(filePath)
        let header: SessionHeader | null = null
        let messageCount = 0
        let firstMessage = ""
        const allMessages: string[] = []
        let name: string | undefined
        let lastActivityTime: number | undefined

        const rl = createInterface({
            input: createReadStream(filePath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        })

        for await (const line of rl) {
            const entry = parseSessionEntryLine(line)
            if (!entry) continue

            if (!header) {
                if (entry.type !== "session") return null
                header = entry
                continue
            }

            // Extract session name (use latest, including explicit clears)
            if (entry.type === "session_info") {
                name = entry.name?.trim() || undefined
            }

            if (entry.type !== "message") continue
            messageCount++

            const activityTime = getMessageActivityTime(entry)
            if (typeof activityTime === "number") {
                lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime)
            }

            const message = entry.message
            if (!isMessageWithContent(message)) continue
            if (message.role !== "user" && message.role !== "assistant") continue

            const textContent = extractTextContent(message)
            if (!textContent) continue

            allMessages.push(textContent)
            if (!firstMessage && message.role === "user") {
                firstMessage = textContent
            }
        }

        if (!header) return null

        const cwd = typeof header.cwd === "string" ? header.cwd : ""
        const headerTime =
            typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN
        const modified =
            typeof lastActivityTime === "number" && lastActivityTime > 0
                ? new Date(lastActivityTime)
                : !Number.isNaN(headerTime)
                  ? new Date(headerTime)
                  : stats.mtime

        return {
            path: filePath,
            id: header.id,
            cwd,
            name,
            created: new Date(header.timestamp),
            modified,
            messageCount,
            firstMessage: firstMessage || "(no messages)",
            allMessagesText: allMessages.join(" "),
        }
    } catch {
        return null
    }
}

function isMessageWithContent(message: AgentMessage): message is Message {
    return typeof (message as Message).role === "string" && "content" in message
}

function getMessageActivityTime(entry: SessionMessageEntry): number | undefined {
    const message = entry.message
    if (!isMessageWithContent(message)) return undefined
    if (message.role !== "user" && message.role !== "assistant") return undefined

    const msgTimestamp = (message as { timestamp?: number }).timestamp
    if (typeof msgTimestamp === "number") {
        return msgTimestamp
    }

    const t = new Date(entry.timestamp).getTime()
    return Number.isNaN(t) ? undefined : t
}

function extractTextContent(message: Message): string {
    const content = message.content
    if (typeof content === "string") {
        return content
    }
    return content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join(" ")
}
