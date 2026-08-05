import * as os from "node:os"

export function isDeadTerminalError(error: unknown): boolean {
    const DEAD_TERMINAL_ERROR_CODES = new Set(["EIO", "EPIPE", "ENOTCONN"])
    if (!error || typeof error !== "object" || !("code" in error)) {
        return false
    }
    const code = (error as NodeJS.ErrnoException).code
    return code !== undefined && DEAD_TERMINAL_ERROR_CODES.has(code)
}

export function formatDisplayPath(p: string): string {
    const home = os.homedir()
    let result = p

    // Replace home directory with ~
    if (result.startsWith(home)) {
        result = `~${result.slice(home.length)}`
    }

    return result
}
