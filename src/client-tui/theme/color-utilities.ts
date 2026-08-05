import type { ColorMode, ColorValue } from "./types.ts"

// ============================================================================
// Color Utilities
// ============================================================================

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const cleaned = hex.replace("#", "")
    if (cleaned.length !== 6) {
        throw new Error(`Invalid hex color: ${hex}`)
    }
    const r = parseInt(cleaned.substring(0, 2), 16)
    const g = parseInt(cleaned.substring(2, 4), 16)
    const b = parseInt(cleaned.substring(4, 6), 16)
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        throw new Error(`Invalid hex color: ${hex}`)
    }
    return { r, g, b }
}

// The 6x6x6 color cube channel values (indices 0-5)
const CUBE_VALUES = [0, 95, 135, 175, 215, 255]

// Grayscale ramp values (indices 232-255, 24 grays from 8 to 238)
const GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10)

function findClosestCubeIndex(value: number): number {
    let minDist = Infinity
    let minIdx = 0
    for (let i = 0; i < CUBE_VALUES.length; i++) {
        const dist = Math.abs(value - CUBE_VALUES[i])
        if (dist < minDist) {
            minDist = dist
            minIdx = i
        }
    }
    return minIdx
}

function findClosestGrayIndex(gray: number): number {
    let minDist = Infinity
    let minIdx = 0
    for (let i = 0; i < GRAY_VALUES.length; i++) {
        const dist = Math.abs(gray - GRAY_VALUES[i])
        if (dist < minDist) {
            minDist = dist
            minIdx = i
        }
    }
    return minIdx
}

function colorDistance(
    r1: number,
    g1: number,
    b1: number,
    r2: number,
    g2: number,
    b2: number,
): number {
    // Weighted Euclidean distance (human eye is more sensitive to green)
    const dr = r1 - r2
    const dg = g1 - g2
    const db = b1 - b2
    return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114
}

function rgbTo256(r: number, g: number, b: number): number {
    // Find closest color in the 6x6x6 cube
    const rIdx = findClosestCubeIndex(r)
    const gIdx = findClosestCubeIndex(g)
    const bIdx = findClosestCubeIndex(b)
    const cubeR = CUBE_VALUES[rIdx]
    const cubeG = CUBE_VALUES[gIdx]
    const cubeB = CUBE_VALUES[bIdx]
    const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx
    const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB)

    // Find closest grayscale
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    const grayIdx = findClosestGrayIndex(gray)
    const grayValue = GRAY_VALUES[grayIdx]
    const grayIndex = 232 + grayIdx
    const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue)

    // Check if color has noticeable saturation (hue matters)
    // If max-min spread is significant, prefer cube to preserve tint
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const spread = maxC - minC

    // Only consider grayscale if color is nearly neutral (spread < 10)
    // AND grayscale is actually closer
    if (spread < 10 && grayDist < cubeDist) {
        return grayIndex
    }

    return cubeIndex
}

function hexTo256(hex: string): number {
    const { r, g, b } = hexToRgb(hex)
    return rgbTo256(r, g, b)
}

export function fgAnsi(color: string | number, mode: ColorMode): string {
    if (color === "") return "\x1b[39m"
    if (typeof color === "number") return `\x1b[38;5;${color}m`
    if (color.startsWith("#")) {
        if (mode === "truecolor") {
            const { r, g, b } = hexToRgb(color)
            return `\x1b[38;2;${r};${g};${b}m`
        } else {
            const index = hexTo256(color)
            return `\x1b[38;5;${index}m`
        }
    }
    throw new Error(`Invalid color value: ${color}`)
}

export function bgAnsi(color: string | number, mode: ColorMode): string {
    if (color === "") return "\x1b[49m"
    if (typeof color === "number") return `\x1b[48;5;${color}m`
    if (color.startsWith("#")) {
        if (mode === "truecolor") {
            const { r, g, b } = hexToRgb(color)
            return `\x1b[48;2;${r};${g};${b}m`
        } else {
            const index = hexTo256(color)
            return `\x1b[48;5;${index}m`
        }
    }
    throw new Error(`Invalid color value: ${color}`)
}

export function resolveVarRefs(
    value: ColorValue,
    vars: Record<string, ColorValue>,
    visited = new Set<string>(),
): string | number {
    if (typeof value === "number" || value === "" || value.startsWith("#")) {
        return value
    }
    if (visited.has(value)) {
        throw new Error(`Circular variable reference detected: ${value}`)
    }
    if (!(value in vars)) {
        throw new Error(`Variable reference not found: ${value}`)
    }
    visited.add(value)
    return resolveVarRefs(vars[value], vars, visited)
}

export function resolveThemeColors<T extends Record<string, ColorValue>>(
    colors: T,
    vars: Record<string, ColorValue> = {},
): Record<keyof T, string | number> {
    const resolved: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(colors)) {
        resolved[key] = resolveVarRefs(value, vars)
    }
    return resolved as Record<keyof T, string | number>
}
