import type { ThemeColor, ThemeBg, ColorMode } from "./types.ts"
import { fgAnsi, bgAnsi } from "./color-utilities.ts"
import chalk from "chalk"

export class Theme {
    readonly name?: string
    readonly sourcePath?: string
    private fgColors: Map<ThemeColor, string>
    private bgColors: Map<ThemeBg, string>
    private mode: ColorMode

    constructor(
        fgColors: Record<ThemeColor, string | number>,
        bgColors: Record<ThemeBg, string | number>,
        mode: ColorMode,
        options: { name?: string } = {},
    ) {
        this.name = options.name
        this.mode = mode
        this.fgColors = new Map()
        for (const [key, value] of Object.entries(fgColors) as [ThemeColor, string | number][]) {
            this.fgColors.set(key, fgAnsi(value, mode))
        }
        this.bgColors = new Map()
        for (const [key, value] of Object.entries(bgColors) as [ThemeBg, string | number][]) {
            this.bgColors.set(key, bgAnsi(value, mode))
        }
    }

    fg(color: ThemeColor, text: string): string {
        const ansi = this.fgColors.get(color)
        if (!ansi) throw new Error(`Unknown theme color: ${color}`)
        return `${ansi}${text}\x1b[39m` // Reset only foreground color
    }

    bg(color: ThemeBg, text: string): string {
        const ansi = this.bgColors.get(color)
        if (!ansi) throw new Error(`Unknown theme background color: ${color}`)
        return `${ansi}${text}\x1b[49m` // Reset only background color
    }

    bold(text: string): string {
        return chalk.bold(text)
    }

    italic(text: string): string {
        return chalk.italic(text)
    }

    underline(text: string): string {
        return chalk.underline(text)
    }

    inverse(text: string): string {
        return chalk.inverse(text)
    }

    strikethrough(text: string): string {
        return chalk.strikethrough(text)
    }

    getFgAnsi(color: ThemeColor): string {
        const ansi = this.fgColors.get(color)
        if (!ansi) throw new Error(`Unknown theme color: ${color}`)
        return ansi
    }

    getBgAnsi(color: ThemeBg): string {
        const ansi = this.bgColors.get(color)
        if (!ansi) throw new Error(`Unknown theme background color: ${color}`)
        return ansi
    }

    getColorMode(): ColorMode {
        return this.mode
    }

    getThinkingBorderColor(
        level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
    ): (str: string) => string {
        // Map thinking levels to dedicated theme colors
        switch (level) {
            case "off":
                return (str: string) => this.fg("thinkingOff", str)
            case "minimal":
                return (str: string) => this.fg("thinkingMinimal", str)
            case "low":
                return (str: string) => this.fg("thinkingLow", str)
            case "medium":
                return (str: string) => this.fg("thinkingMedium", str)
            case "high":
                return (str: string) => this.fg("thinkingHigh", str)
            case "xhigh":
                return (str: string) => this.fg("thinkingXhigh", str)
            default:
                return (str: string) => this.fg("thinkingOff", str)
        }
    }

    getBashModeBorderColor(): (str: string) => string {
        return (str: string) => this.fg("bashMode", str)
    }
}
