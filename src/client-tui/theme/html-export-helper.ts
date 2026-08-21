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
 * Check if a theme is a "light" theme (for CSS that needs light/dark variants).
 */
export function isLightTheme(themeName?: string): boolean {
    // Currently just check the name - could be extended to analyze colors
    return themeName === "light"
}
