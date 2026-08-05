import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { SessionScope, SortMode } from "./session-selector-helper.ts"
import { theme } from "../theme/global-instance.ts"
import { keyHint } from "../core/keybinding-hints.ts"

export default class SessionSelectorHeader implements Component {
    private scope: SessionScope
    private sortMode: SortMode
    private requestRender: () => void
    private loading = false
    private loadProgress: { loaded: number; total: number } | null = null
    private confirmingDeletePath: string | null = null
    private statusMessage: { type: "info" | "error"; message: string } | null = null
    private statusTimeout: ReturnType<typeof setTimeout> | null = null
    private showRenameHint = false

    constructor(scope: SessionScope, sortMode: SortMode, requestRender: () => void) {
        this.scope = scope
        this.sortMode = sortMode
        this.requestRender = requestRender
    }

    setScope(scope: SessionScope): void {
        this.scope = scope
    }

    setSortMode(sortMode: SortMode): void {
        this.sortMode = sortMode
    }

    setLoading(loading: boolean): void {
        this.loading = loading
        // Progress is scoped to the current load; clear whenever the loading state is set
        this.loadProgress = null
    }

    setProgress(loaded: number, total: number): void {
        this.loadProgress = { loaded, total }
    }

    setShowRenameHint(show: boolean): void {
        this.showRenameHint = show
    }

    setConfirmingDeletePath(path: string | null): void {
        this.confirmingDeletePath = path
    }

    // 清理旧 timer
    private clearStatusTimeout(): void {
        if (!this.statusTimeout) return
        clearTimeout(this.statusTimeout)
        this.statusTimeout = null
    }

    // 设置消息
    setStatusMessage(
        msg: { type: "info" | "error"; message: string } | null,
        autoHideMs?: number,
    ): void {
        this.clearStatusTimeout()
        this.statusMessage = msg
        if (!msg || !autoHideMs) return

        this.statusTimeout = setTimeout(() => {
            this.statusMessage = null
            this.statusTimeout = null
            this.requestRender()
        }, autoHideMs)
    }

    invalidate(): void {}

    // 输入终端宽度  输出三行文本
    render(width: number): string[] {
        const title =
            this.scope === "current" ? "Resume Session (Current Folder)" : "Resume Session (All)"

        const leftText = theme.bold(title)

        const sortLabel =
            this.sortMode === "threaded"
                ? "Threaded"
                : this.sortMode === "recent"
                  ? "Recent"
                  : "Fuzzy"
        const sortText = theme.fg("muted", "Sort: ") + theme.fg("accent", sortLabel)

        let scopeText: string
        if (this.loading) {
            const progressText = this.loadProgress
                ? `${this.loadProgress.loaded}/${this.loadProgress.total}`
                : "..."
            scopeText = `${theme.fg("muted", "○ Current Folder | ")}${theme.fg("accent", `Loading ${progressText}`)}`
        } else if (this.scope === "current") {
            scopeText = `${theme.fg("accent", "◉ Current Folder")}${theme.fg("muted", " | ○ All")}`
        } else {
            scopeText = `${theme.fg("muted", "○ Current Folder | ")}${theme.fg("accent", "◉ All")}`
        }

        // 宽度适配 先压缩右侧
        const rightText = truncateToWidth(`${scopeText}  ${sortText}`, width, "")
        const availableLeft = Math.max(0, width - visibleWidth(rightText) - 1)
        // 计算左侧最大空间
        const left = truncateToWidth(leftText, availableLeft, "")
        const spacing = Math.max(0, width - visibleWidth(left) - visibleWidth(rightText))

        // Build hint lines - changes based on state (all branches truncate to width)
        let hintLine1: string
        let hintLine2: string
        // 删除确认
        if (this.confirmingDeletePath !== null) {
            const confirmHint = `Delete session? ${keyHint("tui.select.confirm", "confirm")} · ${keyHint("tui.select.cancel", "cancel")}`
            hintLine1 = theme.fg("error", truncateToWidth(confirmHint, width, "…"))
            hintLine2 = ""
        }
        // 错误消息
        else if (this.statusMessage) {
            const color = this.statusMessage.type === "error" ? "error" : "accent"
            hintLine1 = theme.fg(color, truncateToWidth(this.statusMessage.message, width, "…"))
            hintLine2 = ""
        }
        // 默认快捷键提示
        else {
            // const pathState = this.showPath ? "(on)" : "(off)"
            const sep = theme.fg("muted", " · ")
            const hint1 =
                keyHint("tui.input.tab", "scope") +
                sep +
                theme.fg("muted", 're:<pattern> regex · "phrase" exact')
            const hint2Parts = [
                keyHint("app.session.toggleSort", "sort"),
                keyHint("app.session.delete", "delete"),
            ]
            if (this.showRenameHint) {
                hint2Parts.push(keyHint("app.session.rename", "rename"))
            }
            const hint2 = hint2Parts.join(sep)
            hintLine1 = truncateToWidth(hint1, width, "…")
            hintLine2 = truncateToWidth(hint2, width, "…")
        }

        return [`${left}${" ".repeat(spacing)}${rightText}`, hintLine1, hintLine2]
    }
}
