import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { unlink } from "node:fs/promises"
import * as os from "node:os"
import { fuzzyMatch } from "@earendil-works/pi-tui"
import type { SessionInfo } from "../../agent-core/session-manager-helper.ts"
import { canonicalizePath as _canonicalizePath } from "../../utils/paths.ts"

export type SessionScope = "current" | "all"
export type SortMode = "threaded" | "recent" | "relevance"
export type SessionListProgress = (loaded: number, total: number) => void
export type SessionsLoader = (onProgress?: SessionListProgress) => Promise<SessionInfo[]>

// export type NameFilter = "all" | "named"

export interface ParsedSearchQuery {
    mode: "tokens" | "regex"
    tokens: { kind: "fuzzy" | "phrase"; value: string }[]
    regex: RegExp | null
    /** If set, parsing failed and we should treat query as non-matching. */
    error?: string
}

export interface MatchResult {
    matches: boolean
    /** Lower is better; only meaningful when matches === true */
    score: number
}

/** A session tree node for hierarchical display */
export interface SessionTreeNode {
    session: SessionInfo
    children: SessionTreeNode[]
}

/** Flattened node for display with tree structure info */
export interface FlatSessionNode {
    session: SessionInfo
    depth: number
    isLast: boolean
    /** For each ancestor level, whether there are more siblings after it */
    ancestorContinues: boolean[]
}

export function shortenPath(path: string): string {
    const home = os.homedir()
    if (!path) return path
    if (path.startsWith(home)) {
        return `~${path.slice(home.length)}`
    }
    return path
}

export function formatSessionDate(date: Date): string {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "now"
    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 7) return `${diffDays}d`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`
    return `${Math.floor(diffDays / 365)}y`
}

export function canonicalizePath(path: string | undefined): string | undefined {
    if (!path) return path
    return _canonicalizePath(path)
}

/**
 * Build a tree structure from sessions based on parentSessionPath.
 * Returns root nodes sorted by modified date (descending).
 */
export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
    const byPath = new Map<string, SessionTreeNode>()

    for (const session of sessions) {
        const sessionPath = canonicalizePath(session.path) ?? session.path
        byPath.set(sessionPath, { session, children: [] })
    }

    const roots: SessionTreeNode[] = []

    for (const session of sessions) {
        const sessionPath = canonicalizePath(session.path) ?? session.path
        const node = byPath.get(sessionPath)!
        const parentPath = canonicalizePath(session.parentSessionPath)

        if (parentPath && byPath.has(parentPath)) {
            byPath.get(parentPath)!.children.push(node)
        } else {
            roots.push(node)
        }
    }

    // Sort children and roots by modified date (descending)
    const sortNodes = (nodes: SessionTreeNode[]): void => {
        nodes.sort((a, b) => b.session.modified.getTime() - a.session.modified.getTime())
        for (const node of nodes) {
            sortNodes(node.children)
        }
    }
    sortNodes(roots)

    return roots
}

/**
 * Flatten tree into display list with tree structure metadata.
 */
export function flattenSessionTree(roots: SessionTreeNode[]): FlatSessionNode[] {
    const result: FlatSessionNode[] = []

    const walk = (
        node: SessionTreeNode,
        depth: number,
        ancestorContinues: boolean[],
        isLast: boolean,
    ): void => {
        result.push({ session: node.session, depth, isLast, ancestorContinues })

        for (let i = 0; i < node.children.length; i++) {
            const childIsLast = i === node.children.length - 1
            // Only show continuation line for non-root ancestors
            const continues = depth > 0 ? !isLast : false
            walk(node.children[i]!, depth + 1, [...ancestorContinues, continues], childIsLast)
        }
    }

    for (let i = 0; i < roots.length; i++) {
        walk(roots[i]!, 0, [], i === roots.length - 1)
    }

    return result
}

/**
 * Delete a session file, trying the `trash` CLI first, then falling back to unlink
 */
export async function deleteSessionFile(
    sessionPath: string,
): Promise<{ ok: boolean; method: "trash" | "unlink"; error?: string }> {
    // Try `trash` first (if installed)
    const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath]
    const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" })

    const getTrashErrorHint = (): string | null => {
        const parts: string[] = []
        if (trashResult.error) {
            parts.push(trashResult.error.message)
        }
        const stderr = trashResult.stderr?.trim()
        if (stderr) {
            parts.push(stderr.split("\n")[0] ?? stderr)
        }
        if (parts.length === 0) return null
        return `trash: ${parts.join(" · ").slice(0, 200)}`
    }

    // If trash reports success, or the file is gone afterwards, treat it as successful
    if (trashResult.status === 0 || !existsSync(sessionPath)) {
        return { ok: true, method: "trash" }
    }

    // Fallback to permanent deletion
    try {
        await unlink(sessionPath)
        return { ok: true, method: "unlink" }
    } catch (err) {
        const unlinkError = err instanceof Error ? err.message : String(err)
        const trashErrorHint = getTrashErrorHint()
        const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError
        return { ok: false, method: "unlink", error }
    }
}

function normalizeWhitespaceLower(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function getSessionSearchText(session: SessionInfo): string {
    return `${session.id} ${session.name ?? ""} ${session.allMessagesText} ${session.cwd}`
}

export function hasSessionName(session: SessionInfo): boolean {
    return Boolean(session.name?.trim())
}

// function matchesNameFilter(session: SessionInfo, filter: NameFilter): boolean {
//     if (filter === "all") return true
//     return hasSessionName(session)
// }

export function parseSearchQuery(query: string): ParsedSearchQuery {
    const trimmed = query.trim()
    if (!trimmed) {
        return { mode: "tokens", tokens: [], regex: null }
    }

    // Regex mode: re:<pattern>
    if (trimmed.startsWith("re:")) {
        const pattern = trimmed.slice(3).trim()
        if (!pattern) {
            return { mode: "regex", tokens: [], regex: null, error: "Empty regex" }
        }
        try {
            return { mode: "regex", tokens: [], regex: new RegExp(pattern, "i") }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { mode: "regex", tokens: [], regex: null, error: msg }
        }
    }

    // Token mode with quote support.
    // Example: foo "node cve" bar
    const tokens: { kind: "fuzzy" | "phrase"; value: string }[] = []
    let buf = ""
    let inQuote = false
    let hadUnclosedQuote = false

    const flush = (kind: "fuzzy" | "phrase"): void => {
        const v = buf.trim()
        buf = ""
        if (!v) return
        tokens.push({ kind, value: v })
    }

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i]!
        if (ch === '"') {
            if (inQuote) {
                flush("phrase")
                inQuote = false
            } else {
                flush("fuzzy")
                inQuote = true
            }
            continue
        }

        if (!inQuote && /\s/.test(ch)) {
            flush("fuzzy")
            continue
        }

        buf += ch
    }

    if (inQuote) {
        hadUnclosedQuote = true
    }

    // If quotes were unbalanced, fall back to plain whitespace tokenization.
    if (hadUnclosedQuote) {
        return {
            mode: "tokens",
            tokens: trimmed
                .split(/\s+/)
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
                .map((t) => ({ kind: "fuzzy" as const, value: t })),
            regex: null,
        }
    }

    flush(inQuote ? "phrase" : "fuzzy")

    return { mode: "tokens", tokens, regex: null }
}

export function matchSession(session: SessionInfo, parsed: ParsedSearchQuery): MatchResult {
    const text = getSessionSearchText(session)

    if (parsed.mode === "regex") {
        if (!parsed.regex) {
            return { matches: false, score: 0 }
        }
        const idx = text.search(parsed.regex)
        if (idx < 0) return { matches: false, score: 0 }
        return { matches: true, score: idx * 0.1 }
    }

    if (parsed.tokens.length === 0) {
        return { matches: true, score: 0 }
    }

    let totalScore = 0
    let normalizedText: string | null = null

    for (const token of parsed.tokens) {
        if (token.kind === "phrase") {
            if (normalizedText === null) {
                normalizedText = normalizeWhitespaceLower(text)
            }
            const phrase = normalizeWhitespaceLower(token.value)
            if (!phrase) continue
            const idx = normalizedText.indexOf(phrase)
            if (idx < 0) return { matches: false, score: 0 }
            totalScore += idx * 0.1
            continue
        }

        const m = fuzzyMatch(token.value, text)
        if (!m.matches) return { matches: false, score: 0 }
        totalScore += m.score
    }

    return { matches: true, score: totalScore }
}

export function filterAndSortSessions(
    sessions: SessionInfo[],
    query: string,
    sortMode: SortMode,
    // nameFilter: NameFilter = "all",
): SessionInfo[] {
    const trimmed = query.trim()
    if (!trimmed) return sessions

    const parsed = parseSearchQuery(query)
    if (parsed.error) return []

    // Recent mode: filter only, keep incoming order.
    if (sortMode === "recent") {
        const filtered: SessionInfo[] = []
        for (const s of sessions) {
            const res = matchSession(s, parsed)
            if (res.matches) filtered.push(s)
        }
        return filtered
    }

    // Relevance mode: sort by score, tie-break by modified desc.
    const scored: { session: SessionInfo; score: number }[] = []
    for (const s of sessions) {
        const res = matchSession(s, parsed)
        if (!res.matches) continue
        scored.push({ session: s, score: res.score })
    }

    scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score
        return b.session.modified.getTime() - a.session.modified.getTime()
    })

    return scored.map((r) => r.session)
}
