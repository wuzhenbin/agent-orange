import * as fs from "node:fs"
import * as path from "node:path"

import { Theme } from "./theme.ts"
import { getDefaultTheme, loadTheme, loadThemeFromPath } from "./theme-loading.ts"
import { getThemesDir } from "../../config/path-config.ts"
import { watchWithErrorHandler, closeWatcher } from "../../utils/fs-watch.ts"

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

export function initTheme(themeName?: string, enableWatcher: boolean = false): void {
    const name = themeName ?? getDefaultTheme()
    currentThemeName = name
    try {
        setGlobalTheme(loadTheme(name))
        if (enableWatcher) {
            startThemeWatcher()
        }
    } catch (_error) {
        // Theme is invalid - fall back to dark theme silently
        currentThemeName = "dark"
        setGlobalTheme(loadTheme("dark"))
        // Don't start watcher for fallback theme
    }
}

export function setTheme(
    name: string,
    enableWatcher: boolean = false,
): { success: boolean; error?: string } {
    currentThemeName = name
    try {
        setGlobalTheme(loadTheme(name))
        if (enableWatcher) {
            startThemeWatcher()
        }
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

function startThemeWatcher(): void {
    stopThemeWatcher()

    // Only watch if it's a custom theme (not built-in)
    if (!currentThemeName || currentThemeName === "dark" || currentThemeName === "light") {
        return
    }

    const customThemesDir = getThemesDir()
    const watchedThemeName = currentThemeName
    const watchedFileName = `${watchedThemeName}.json`
    const themeFile = path.join(customThemesDir, watchedFileName)

    // Only watch if the file exists
    if (!fs.existsSync(themeFile)) {
        return
    }

    const scheduleReload = () => {
        if (themeReloadTimer) {
            clearTimeout(themeReloadTimer)
        }
        themeReloadTimer = setTimeout(() => {
            themeReloadTimer = undefined

            // Ignore stale timers after switching themes or stopping the watcher
            if (currentThemeName !== watchedThemeName) {
                return
            }

            // Keep the last successfully loaded theme active if the file is temporarily missing
            if (!fs.existsSync(themeFile)) {
                return
            }

            try {
                // Reload the theme from disk and refresh the registry cache
                const reloadedTheme = loadThemeFromPath(themeFile)
                registeredThemes.set(watchedThemeName, reloadedTheme)
                setGlobalTheme(reloadedTheme)
                // Notify callback (to invalidate UI)
                if (onThemeChangeCallback) {
                    onThemeChangeCallback()
                }
            } catch (_error) {
                // Ignore errors (file might be in invalid state while being edited)
            }
        }, 100)
    }

    themeWatcher =
        watchWithErrorHandler(
            customThemesDir,
            (_eventType, filename) => {
                if (currentThemeName !== watchedThemeName) {
                    return
                }
                if (!filename) {
                    scheduleReload()
                    return
                }
                if (filename !== watchedFileName) {
                    return
                }
                scheduleReload()
            },
            () => {
                closeWatcher(themeWatcher)
                themeWatcher = undefined
            },
        ) ?? undefined
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
