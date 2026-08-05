import type { Message } from "../agent-ai/types.ts"
import { openSync, writeFileSync, appendFileSync, closeSync, existsSync, mkdirSync } from "fs"
import { join, resolve } from "path"
import { readdir } from "fs/promises"
import { getSessionsDir } from "../config/path-config.ts"
import { normalizePath, resolvePath } from "../utils/paths.ts"
import { uuidv7 } from "../utils/session/uuid.ts"
import {
    loadEntriesFromFile,
    FileEntry,
    SessionEntry,
    SessionMessageEntry,
    CompactionEntry,
    SessionHeader,
    assertValidSessionId,
    generateId,
    getDefaultSessionDir,
    buildSessionContext,
    buildSessionInfosWithConcurrency,
} from "./session-manager-helper.ts"
import type {
    SessionContext,
    SessionListProgress,
    SessionInfo,
    SessionInfoEntry,
} from "./session-manager-helper.ts"

export interface NewSessionOptions {
    id?: string
    persist?: boolean
}

export function createSessionId(): string {
    return uuidv7()
}

export class SessionManager {
    private cwd: string
    private persist: boolean
    private sessionId: string = ""
    private sessionDir: string
    private sessionFile: string | undefined
    private fileEntries: FileEntry[] = []
    private flushed: boolean = false
    private byId: Map<string, SessionEntry> = new Map()
    private leafId: string | null = null

    private constructor(
        cwd: string,
        sessionDir: string,
        sessionFile: string | undefined,
        persist: boolean,
        newSessionOptions?: NewSessionOptions,
    ) {
        this.cwd = resolvePath(cwd)
        this.sessionDir = normalizePath(sessionDir)
        this.persist = persist
        if (persist && this.sessionDir && !existsSync(this.sessionDir)) {
            mkdirSync(this.sessionDir, { recursive: true })
        }

        if (sessionFile) {
            this.setSessionFile(sessionFile)
        } else {
            this.newSession(newSessionOptions)
        }
    }

    /**
     * Create a new session.
     * @param cwd Working directory (stored in session header)
     * @param sessionDir Optional session directory.
     */
    static create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir()
        return new SessionManager(cwd, dir, undefined, options?.persist ?? false, options)
    }

    /**
     * Open a specific session file.
     * @param path Path to session file
     * @param sessionDir Optional session directory for /new or /branch. If omitted, derives from file's parent.
     */
    static open(path: string, sessionDir?: string): SessionManager {
        const resolvedPath = resolvePath(path)
        // Extract cwd from session header if possible, otherwise use process.cwd()
        const entries = loadEntriesFromFile(resolvedPath)
        const header = entries.find((e) => e.type === "session") as SessionHeader | undefined
        const cwd = header?.cwd ?? process.cwd()
        // If no sessionDir provided, derive from file's parent directory
        const dir = sessionDir ? normalizePath(sessionDir) : resolve(resolvedPath, "..")
        return new SessionManager(cwd, dir, resolvedPath, true)
    }

    /** Create an in-memory session (no file persistence) */
    static inMemory(cwd: string = process.cwd()): SessionManager {
        return new SessionManager(cwd, "", undefined, false)
    }

    getCwd(): string {
        return this.cwd
    }

    isPersisted(): boolean {
        return this.persist
    }

    getSessionId(): string {
        return this.sessionId
    }

    /**
     * Get all session entries (excludes header). Returns a shallow copy.
     * The session is append-only: use appendXXX() to add entries, branch() to
     * change the leaf pointer. Entries cannot be modified or deleted.
     */
    getEntries(): SessionEntry[] {
        return this.fileEntries.filter((e): e is SessionEntry => e.type !== "session")
    }

    /**
     * Walk from entry to root, returning all entries in path order.
     * Includes all entry types (messages, compaction,  etc.).
     * Use buildSessionContext() to get the resolved messages for the LLM.
     */
    getBranch(fromId?: string): SessionEntry[] {
        const path: SessionEntry[] = []
        const startId = fromId ?? this.leafId
        let current = startId ? this.byId.get(startId) : undefined
        while (current) {
            path.push(current)
            current = current.parentId ? this.byId.get(current.parentId) : undefined
        }
        path.reverse()
        return path
    }

    /**
     * Build the session context (what gets sent to the LLM).
     * Uses tree traversal from current leaf.
     */
    buildSessionContext(): SessionContext {
        return buildSessionContext(this.getEntries(), this.leafId, this.byId)
    }

    /** Get the current session name from the latest session_info entry, if any. */
    getSessionName(): string | undefined {
        // Walk entries in reverse to find the latest session_info entry.
        // Empty names explicitly clear the session title.
        const entries = this.getEntries()
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i]
            if (entry.type === "session_info") {
                return entry.name?.trim() || undefined
            }
        }
        return undefined
    }

    /** Switch to a different session file (used for resume and branching) */
    setSessionFile(sessionFile: string): void {
        this.sessionFile = resolvePath(sessionFile)
        if (existsSync(this.sessionFile)) {
            this.fileEntries = loadEntriesFromFile(this.sessionFile)

            // If file was empty or corrupted (no valid header), truncate and start fresh
            // to avoid appending messages without a session header (which breaks the session)
            if (this.fileEntries.length === 0) {
                const explicitPath = this.sessionFile
                this.newSession()
                this.sessionFile = explicitPath
                this._rewriteFile()
                this.flushed = true
                return
            }

            const header = this.fileEntries.find((e) => e.type === "session") as
                | SessionHeader
                | undefined
            this.sessionId = header?.id ?? createSessionId()

            this._buildIndex()
            this.flushed = true
        } else {
            const explicitPath = this.sessionFile
            this.newSession()
            this.sessionFile = explicitPath // preserve explicit path from --session flag
        }
    }

    private _buildIndex(): void {
        this.byId.clear()
        this.leafId = null
        for (const entry of this.fileEntries) {
            if (entry.type === "session") continue
            this.byId.set(entry.id, entry)
            this.leafId = entry.id
        }
    }

    newSession(options?: NewSessionOptions): string | undefined {
        if (options?.id !== undefined) {
            assertValidSessionId(options.id)
        }
        this.sessionId = options?.id ?? createSessionId()
        const current = new Date()
        const timestamp = current.toISOString()
        const header: SessionHeader = {
            type: "session",
            id: this.sessionId,
            timestamp,
            cwd: this.cwd,
        }
        this.fileEntries = [header]
        this.byId.clear()
        this.leafId = null
        this.flushed = false

        if (this.persist) {
            const fileTimestamp = current.getTime()
            this.sessionFile = join(
                this.getSessionDir(),
                `${fileTimestamp}_${this.sessionId}.jsonl`,
            )
        }
        return this.sessionFile
    }

    getSessionDir(): string {
        return this.sessionDir
    }

    /** Append a message as child of current leaf, then advance leaf. Returns entry id.
     * Does not allow writing CompactionSummaryMessage and BranchSummaryMessage directly.
     * Reason: we want these to be top-level entries in the session, not message session entries,
     * so it is easier to find them.
     * These need to be appended via appendCompaction() and appendBranchSummary() methods.
     */
    appendMessage(message: Message): string {
        const entry: SessionMessageEntry = {
            type: "message",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            message,
        }
        this._appendEntry(entry)
        return entry.id
    }

    /** Append a compaction summary as child of current leaf, then advance leaf. Returns entry id. */
    appendCompaction<T = unknown>(
        summary: string,
        firstKeptEntryId: string,
        tokensBefore: number,
        details?: T,
    ): string {
        const entry: CompactionEntry = {
            type: "compaction",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            summary,
            firstKeptEntryId,
            tokensBefore,
            details,
        }
        this._appendEntry(entry)
        return entry.id
    }

    /** Append a session info entry (e.g., display name). Returns entry id. */
    appendSessionInfo(name: string): string {
        const entry: SessionInfoEntry = {
            type: "session_info",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            name: name.trim(),
        }
        this._appendEntry(entry)
        return entry.id
    }

    private _appendEntry(entry: SessionEntry): void {
        this.fileEntries.push(entry)
        this.byId.set(entry.id, entry)
        this.leafId = entry.id
        this._persist(entry)
    }

    getSessionFile(): string | undefined {
        return this.sessionFile
    }

    _persist(entry: SessionEntry): void {
        if (!this.persist || !this.sessionFile) return

        const hasAssistant = this.fileEntries.some(
            (e) => e.type === "message" && e.message.role === "assistant",
        )
        if (!hasAssistant) {
            if (this.flushed) {
                appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`)
            } else {
                // Mark as not flushed so when assistant arrives, all entries get written
                this.flushed = false
            }
            return
        }

        if (!this.flushed) {
            const fd = openSync(this.sessionFile, "wx")
            try {
                for (const e of this.fileEntries) {
                    writeFileSync(fd, `${JSON.stringify(e)}\n`)
                }
            } finally {
                closeSync(fd)
            }
            this.flushed = true
        } else {
            appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`)
        }
    }

    private _rewriteFile(): void {
        if (!this.persist || !this.sessionFile) return
        const fd = openSync(this.sessionFile, "w")
        try {
            for (const entry of this.fileEntries) {
                writeFileSync(fd, `${JSON.stringify(entry)}\n`)
            }
        } finally {
            closeSync(fd)
        }
    }

    /**
     * List all sessions across all project directories.
     * @param onProgress Optional callback for progress updates (loaded, total)
     */
    static async listAll(cwd?: string, onProgress?: SessionListProgress): Promise<SessionInfo[]> {
        const sessionsDir = getSessionsDir()

        try {
            if (!existsSync(sessionsDir)) {
                return []
            }
            // Read all session jsonl files directly under sessionsDir
            const files = (await readdir(sessionsDir, { withFileTypes: true }))
                .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
                .map((entry) => join(sessionsDir, entry.name))

            if (files.length === 0) {
                return []
            }
            const totalFiles = files.length
            let loaded = 0
            const results = await buildSessionInfosWithConcurrency(files, () => {
                loaded++
                onProgress?.(loaded, totalFiles)
            })
            const sessions: SessionInfo[] = []
            for (const info of results) {
                if (!info) continue
                // cwd filter
                if (cwd && info.cwd !== cwd) {
                    continue
                }
                if (info) {
                    sessions.push(info)
                }
            }
            sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime())
            return sessions
        } catch {
            return []
        }
    }
}
