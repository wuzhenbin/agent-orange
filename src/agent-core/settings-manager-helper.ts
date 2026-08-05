export interface SettingsConfig {
    masterProfile: string
    defaultModel: {
        provider: string
        model: string
        thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
    }
    showHardwareCursor?: boolean // Show terminal cursor while still positioning it for IME
    retry: {
        enabled: boolean
        maxRetries: number
        baseDelayMs: number
    }
    autocompleteMaxVisible?: number // Max visible items in autocomplete dropdown (default: 5),
    terminal?: {
        showImages?: boolean // default: true (only relevant if terminal supports images)
        imageWidthCells?: number // default: 60 (preferred inline image width in terminal cells)
        clearOnShrink?: boolean // default: false (clear empty rows when content shrinks)
        showTerminalProgress?: boolean // default: false (OSC 9;4 terminal progress indicators)
    }
    markdown?: {
        codeBlockIndent?: string // default: "  "
    }
    compaction: {
        enabled: boolean // default: true
        reserveTokens: number // default: 16384
        keepRecentTokens: number // default: 20000
    }
}

export const DEFAULT_SETTINGS: SettingsConfig = {
    masterProfile: "",
    defaultModel: {
        provider: "",
        model: "",
        thinkingLevel: "off",
    },
    showHardwareCursor: false,
    retry: {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 2000,
    },
    autocompleteMaxVisible: 5,
    terminal: {
        showImages: true,
        imageWidthCells: 60,
        clearOnShrink: false,
        showTerminalProgress: false,
    },
    markdown: {
        codeBlockIndent: "  ",
    },
    compaction: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
    },
}

export function deepMerge<T extends object>(base: T, overrides: Partial<T>): T {
    const result = { ...base }

    for (const key of Object.keys(overrides) as Array<keyof T>) {
        const overrideValue = overrides[key]
        const baseValue = base[key]

        if (overrideValue && typeof overrideValue === "object" && !Array.isArray(overrideValue)) {
            result[key] = deepMerge(baseValue as object, overrideValue as object) as T[keyof T]
        } else {
            result[key] = overrideValue as T[keyof T]
        }
    }

    return result
}
