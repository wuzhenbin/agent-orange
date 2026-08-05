import { currentThemeName } from "./global-instance.ts"
import { getDefaultTheme } from "./theme-loading.ts"
import { loadThemeJson } from "./theme-loading.ts"
import { resolveThemeColors, resolveVarRefs } from "./color-utilities.ts"
import { ColorValue } from "./types.ts"

// ============================================================================
// HTML Export Helpers
// ============================================================================

/**
 * Convert a 256-color index to hex string.
 * Indices 0-15: basic colors (approximate)
 * Indices 16-231: 6x6x6 color cube
 * Indices 232-255: grayscale ramp
 */
export function ansi256ToHex(index: number): string {
    // Basic colors (0-15) - approximate common terminal values
    const basicColors = [
        "#000000",
        "#800000",
        "#008000",
        "#808000",
        "#000080",
        "#800080",
        "#008080",
        "#c0c0c0",
        "#808080",
        "#ff0000",
        "#00ff00",
        "#ffff00",
        "#0000ff",
        "#ff00ff",
        "#00ffff",
        "#ffffff",
    ]
    if (index < 16) {
        return basicColors[index]
    }

    // Color cube (16-231): 6x6x6 = 216 colors
    if (index < 232) {
        const cubeIndex = index - 16
        const r = Math.floor(cubeIndex / 36)
        const g = Math.floor((cubeIndex % 36) / 6)
        const b = cubeIndex % 6
        const toHex = (n: number) => (n === 0 ? 0 : 55 + n * 40).toString(16).padStart(2, "0")
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    }

    // Grayscale (232-255): 24 shades
    const gray = 8 + (index - 232) * 10
    const grayHex = gray.toString(16).padStart(2, "0")
    return `#${grayHex}${grayHex}${grayHex}`
}

/**
 * Get resolved theme colors as CSS-compatible hex strings.
 * Used by HTML export to generate CSS custom properties.
 */
export function getResolvedThemeColors(themeName?: string): Record<string, string> {
    const name = themeName ?? currentThemeName ?? getDefaultTheme()
    const isLight = name === "light"
    const themeJson = loadThemeJson(name)
    const resolved = resolveThemeColors(themeJson.colors, themeJson.vars)

    // Default text color for empty values (terminal uses default fg color)
    const defaultText = isLight ? "#000000" : "#e5e5e7"

    const cssColors: Record<string, string> = {}
    for (const [key, value] of Object.entries(resolved)) {
        if (typeof value === "number") {
            cssColors[key] = ansi256ToHex(value)
        } else if (value === "") {
            // Empty means default terminal color - use sensible fallback for HTML
            cssColors[key] = defaultText
        } else {
            cssColors[key] = value
        }
    }
    return cssColors
}

/**
 * Check if a theme is a "light" theme (for CSS that needs light/dark variants).
 */
export function isLightTheme(themeName?: string): boolean {
    // Currently just check the name - could be extended to analyze colors
    return themeName === "light"
}

/**
 * Get explicit export colors from theme JSON, if specified.
 * Returns undefined for each color that isn't explicitly set.
 */
export function getThemeExportColors(themeName?: string): {
    pageBg?: string
    cardBg?: string
    infoBg?: string
} {
    const name = themeName ?? currentThemeName ?? getDefaultTheme()
    try {
        const themeJson = loadThemeJson(name)
        const exportSection = themeJson.export
        if (!exportSection) return {}

        const vars = themeJson.vars ?? {}
        const resolve = (value: ColorValue | undefined): string | undefined => {
            if (value === undefined) return undefined
            const resolved = resolveVarRefs(value, vars)
            if (typeof resolved === "number") return ansi256ToHex(resolved)
            if (resolved === "") return undefined
            return resolved
        }

        return {
            pageBg: resolve(exportSection.pageBg),
            cardBg: resolve(exportSection.cardBg),
            infoBg: resolve(exportSection.infoBg),
        }
    } catch {
        return {}
    }
}
