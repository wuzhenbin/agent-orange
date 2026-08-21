import * as path from "node:path"
import * as fs from "node:fs"
import { getCapabilities } from "@earendil-works/pi-tui"

import { ThemeJson, validateThemeJson, ColorMode, ThemeColor, ThemeBg } from "./types.ts"
import { getThemesDir } from "../../config/path-config.ts"
import { registeredThemes } from "./global-instance.ts"
import { Theme } from "./theme.ts"
import { resolveThemeColors, hexToRgb } from "./color-utilities.ts"
import { ansi256ToHex } from "./html-export-helper.ts"

let BUILTIN_THEMES: Record<string, ThemeJson> | undefined

function getBuiltinThemes(): Record<string, ThemeJson> {
    if (!BUILTIN_THEMES) {
        const themesDir = getThemesDir()
        const darkPath = path.join(themesDir, "dark.json")
        BUILTIN_THEMES = {
            dark: JSON.parse(fs.readFileSync(darkPath, "utf-8")) as ThemeJson,
        }
    }
    return BUILTIN_THEMES
}

export function getAvailableThemes(): string[] {
    return getAvailableThemesWithPaths().map(({ name }) => name)
}

export interface ThemeInfo {
    name: string
    path: string | undefined
}

export function getAvailableThemesWithPaths(): ThemeInfo[] {
    const themesDir = getThemesDir()
    const result: ThemeInfo[] = []
    const seen = new Set<string>()
    const addTheme = (themeInfo: ThemeInfo) => {
        if (seen.has(themeInfo.name)) {
            return
        }
        seen.add(themeInfo.name)
        result.push(themeInfo)
    }

    // Built-in themes
    for (const name of Object.keys(getBuiltinThemes())) {
        addTheme({ name, path: path.join(themesDir, `${name}.json`) })
    }

    // Custom themes
    for (const themeInfo of getCustomThemeInfos()) {
        addTheme(themeInfo)
    }

    for (const [name, theme] of registeredThemes.entries()) {
        addTheme({ name, path: theme.sourcePath })
    }

    return result.sort((a, b) => a.name.localeCompare(b.name))
}

function getCustomThemeInfos(): ThemeInfo[] {
    const customThemesDir = getThemesDir()
    const result: ThemeInfo[] = []
    if (!fs.existsSync(customThemesDir)) {
        return result
    }

    for (const file of fs.readdirSync(customThemesDir)) {
        if (!file.endsWith(".json")) {
            continue
        }
        const themePath = path.join(customThemesDir, file)
        try {
            const customTheme = loadThemeFromPath(themePath)
            if (customTheme.name) {
                result.push({ name: customTheme.name, path: themePath })
            }
        } catch {
            // Invalid themes are ignored here; the resource loader reports them
            // during normal startup/reload.
        }
    }
    return result
}

function parseThemeJson(label: string, json: unknown): ThemeJson {
    if (!validateThemeJson.Check(json)) {
        const errors = Array.from(validateThemeJson.Errors(json))
        const missingColors = new Set<string>()
        const otherErrors: string[] = []

        for (const error of errors) {
            if (error.keyword === "required" && error.instancePath === "/colors") {
                const requiredProperties = (error.params as { requiredProperties?: string[] })
                    .requiredProperties
                for (const requiredProperty of requiredProperties ?? []) {
                    missingColors.add(requiredProperty)
                }
                continue
            }

            const path = error.instancePath || "/"
            otherErrors.push(`  - ${path}: ${error.message}`)
        }

        let errorMessage = `Invalid theme "${label}":\n`
        if (missingColors.size > 0) {
            errorMessage += "\nMissing required color tokens:\n"
            errorMessage += Array.from(missingColors)
                .sort()
                .map((color) => `  - ${color}`)
                .join("\n")
            errorMessage += '\n\nPlease add these colors to your theme\'s "colors" object.'
            errorMessage += "\nSee the built-in themes for reference values."
        }
        if (otherErrors.length > 0) {
            errorMessage += `\n\nOther errors:\n${otherErrors.join("\n")}`
        }

        throw new Error(errorMessage)
    }

    return json as ThemeJson
}

function parseThemeJsonContent(label: string, content: string): ThemeJson {
    let json: unknown
    try {
        json = JSON.parse(content)
    } catch (error) {
        throw new Error(`Failed to parse theme ${label}: ${error}`)
    }
    return parseThemeJson(label, json)
}

export function loadThemeJson(name: string): ThemeJson {
    const builtinThemes = getBuiltinThemes()
    if (name in builtinThemes) {
        return builtinThemes[name]
    }
    const registeredTheme = registeredThemes.get(name)
    if (registeredTheme?.sourcePath) {
        const content = fs.readFileSync(registeredTheme.sourcePath, "utf-8")
        return parseThemeJsonContent(registeredTheme.sourcePath, content)
    }
    if (registeredTheme) {
        throw new Error(`Theme "${name}" does not have a source path for export`)
    }
    const customThemesDir = getThemesDir()
    const themePath = path.join(customThemesDir, `${name}.json`)
    if (!fs.existsSync(themePath)) {
        throw new Error(`Theme not found: ${name}`)
    }
    const content = fs.readFileSync(themePath, "utf-8")
    return parseThemeJsonContent(name, content)
}

function createTheme(themeJson: ThemeJson, mode?: ColorMode, sourcePath?: string): Theme {
    const colorMode = mode ?? (getCapabilities().trueColor ? "truecolor" : "256color")
    const resolvedColors = resolveThemeColors(themeJson.colors, themeJson.vars)
    const fgColors: Record<ThemeColor, string | number> = {} as Record<ThemeColor, string | number>
    const bgColors: Record<ThemeBg, string | number> = {} as Record<ThemeBg, string | number>
    const bgColorKeys: Set<string> = new Set([
        "selectedBg",
        "userMessageBg",
        "customMessageBg",
        "toolPendingBg",
        "toolSuccessBg",
        "toolErrorBg",
    ])
    for (const [key, value] of Object.entries(resolvedColors)) {
        if (bgColorKeys.has(key)) {
            bgColors[key as ThemeBg] = value
        } else {
            fgColors[key as ThemeColor] = value
        }
    }
    return new Theme(fgColors, bgColors, colorMode, {
        name: themeJson.name,
    })
}

export function loadThemeFromPath(themePath: string, mode?: ColorMode): Theme {
    const content = fs.readFileSync(themePath, "utf-8")
    const themeJson = parseThemeJsonContent(themePath, content)
    return createTheme(themeJson, mode, themePath)
}

export function loadTheme(name: string, mode?: ColorMode): Theme {
    const registeredTheme = registeredThemes.get(name)
    if (registeredTheme) {
        return registeredTheme
    }
    const themeJson = loadThemeJson(name)
    return createTheme(themeJson, mode)
}

export function getThemeByName(name: string): Theme | undefined {
    try {
        return loadTheme(name)
    } catch {
        return undefined
    }
}

export type TerminalTheme = "dark" | "light"

export interface RgbColor {
    r: number
    g: number
    b: number
}

export interface TerminalThemeDetection {
    theme: TerminalTheme
    source: "terminal background" | "COLORFGBG" | "fallback"
    detail: string
    confidence: "high" | "low"
}

export interface TerminalThemeDetectionOptions {
    env?: NodeJS.ProcessEnv
}

function getColorFgBgBackgroundIndex(colorfgbg: string): number | undefined {
    const parts = colorfgbg.split(";")
    for (let i = parts.length - 1; i >= 0; i--) {
        const bg = parseInt(parts[i].trim(), 10)
        if (Number.isInteger(bg) && bg >= 0 && bg <= 255) {
            return bg
        }
    }
    return undefined
}

function getRgbColorLuminance({ r, g, b }: RgbColor): number {
    const toLinear = (channel: number) => {
        const value = channel / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function getAnsiColorLuminance(index: number): number {
    return getRgbColorLuminance(hexToRgb(ansi256ToHex(index)))
}

export function getThemeForRgbColor(rgb: RgbColor): TerminalTheme {
    return getRgbColorLuminance(rgb) >= 0.5 ? "light" : "dark"
}

function parseOscHexChannel(channel: string): number | undefined {
    if (!/^[0-9a-f]+$/i.test(channel)) {
        return undefined
    }
    const max = 16 ** channel.length - 1
    if (max <= 0) {
        return undefined
    }
    return Math.round((parseInt(channel, 16) / max) * 255)
}

export function parseOsc11BackgroundColor(data: string): RgbColor | undefined {
    const match = data.match(/^\x1b\]11;([^\x07\x1b]*)(?:\x07|\x1b\\)$/i)
    if (!match) {
        return undefined
    }

    const value = match[1].trim()
    if (value.startsWith("#")) {
        const hex = value.slice(1)
        if (/^[0-9a-f]{6}$/i.test(hex)) {
            return hexToRgb(value)
        }
        if (/^[0-9a-f]{12}$/i.test(hex)) {
            const r = parseOscHexChannel(hex.slice(0, 4))
            const g = parseOscHexChannel(hex.slice(4, 8))
            const b = parseOscHexChannel(hex.slice(8, 12))
            return r !== undefined && g !== undefined && b !== undefined ? { r, g, b } : undefined
        }
        return undefined
    }

    const rgbValue = value.replace(/^rgba?:/i, "")
    const [red, green, blue] = rgbValue.split("/")
    if (red === undefined || green === undefined || blue === undefined) {
        return undefined
    }
    const r = parseOscHexChannel(red)
    const g = parseOscHexChannel(green)
    const b = parseOscHexChannel(blue)
    return r !== undefined && g !== undefined && b !== undefined ? { r, g, b } : undefined
}

export function detectTerminalBackground(
    options: TerminalThemeDetectionOptions = {},
): TerminalThemeDetection {
    const env = options.env ?? process.env
    const colorfgbg = env.COLORFGBG || ""
    const bg = getColorFgBgBackgroundIndex(colorfgbg)
    if (bg !== undefined) {
        return {
            theme: getAnsiColorLuminance(bg) >= 0.5 ? "light" : "dark",
            source: "COLORFGBG",
            detail: `background color index ${bg}`,
            confidence: "high",
        }
    }

    return {
        theme: "dark",
        source: "fallback",
        detail: "no terminal background hint found",
        confidence: "low",
    }
}

export function getDefaultTheme(): string {
    return detectTerminalBackground().theme
}
