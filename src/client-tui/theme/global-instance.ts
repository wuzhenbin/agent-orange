import * as fs from "node:fs"
import { Theme } from "./theme.ts"
import { getDefaultTheme, loadTheme } from "./theme-loading.ts"
import { closeWatcher } from "../../utils/fs-watch.ts"
// import { hexToRgb } from "./color-utilities.ts"

// ============================================================================
// Global Theme Instance
// ============================================================================

// Use globalThis to share theme across module loaders (tsx + jiti in dev mode)
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme")
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme")

// Export theme as a getter that reads from globalThis
// This ensures all module instances (tsx, jiti) see the same theme
export const theme: Theme = new Proxy({} as Theme, {
    get(_target, prop) {
        const t = (globalThis as Record<symbol, Theme>)[THEME_KEY]
        if (!t) throw new Error("Theme not initialized. Call initTheme() first.")
        return (t as unknown as Record<string | symbol, unknown>)[prop]
    },
})

function setGlobalTheme(t: Theme): void {
    ;(globalThis as Record<symbol, Theme>)[THEME_KEY] = t
    ;(globalThis as Record<symbol, Theme>)[THEME_KEY_OLD] = t
}

export let currentThemeName: string | undefined
let themeWatcher: fs.FSWatcher | undefined
let themeReloadTimer: NodeJS.Timeout | undefined
let onThemeChangeCallback: (() => void) | undefined
export const registeredThemes = new Map<string, Theme>()

export function setRegisteredThemes(themes: Theme[]): void {
    registeredThemes.clear()
    for (const theme of themes) {
        if (theme.name) {
            registeredThemes.set(theme.name, theme)
        }
    }
}

export function initTheme(themeName?: string): void {
    const name = themeName ?? getDefaultTheme()
    currentThemeName = name
    try {
        setGlobalTheme(loadTheme(name))
    } catch (_error) {
        // Theme is invalid - fall back to dark theme silently
        currentThemeName = "dark"
        setGlobalTheme(loadTheme("dark"))
        // Don't start watcher for fallback theme
    }
}

export function setTheme(name: string): { success: boolean; error?: string } {
    currentThemeName = name
    try {
        setGlobalTheme(loadTheme(name))
        if (onThemeChangeCallback) {
            onThemeChangeCallback()
        }
        return { success: true }
    } catch (error) {
        // Theme is invalid - fall back to dark theme
        currentThemeName = "dark"
        setGlobalTheme(loadTheme("dark"))
        // Don't start watcher for fallback theme
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

export function setThemeInstance(themeInstance: Theme): void {
    setGlobalTheme(themeInstance)
    currentThemeName = "<in-memory>"
    stopThemeWatcher() // Can't watch a direct instance
    if (onThemeChangeCallback) {
        onThemeChangeCallback()
    }
}

export function onThemeChange(callback: () => void): void {
    onThemeChangeCallback = callback
}

// 停止主题热重载相关资源 1 清除定时器 2 关闭文件监听器 3 释放引用
export function stopThemeWatcher(): void {
    // 清理定时器
    if (themeReloadTimer) {
        clearTimeout(themeReloadTimer)
        themeReloadTimer = undefined
    }
    // 关闭 watcher
    closeWatcher(themeWatcher)
    // 释放引用 方便 GC 回收
    themeWatcher = undefined
}
