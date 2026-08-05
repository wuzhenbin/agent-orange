import {
    type KeybindingDefinitions,
    type KeybindingsConfig,
    TUI_KEYBINDINGS,
    KeybindingsManager as TuiKeybindingsManager,
} from "@earendil-works/pi-tui"

export interface AppKeybindings {
    "app.interrupt": true
    "app.clear": true
    "app.exit": true
    "app.session.toggleSort": true
    "app.session.rename": true
    "app.session.delete": true
    "app.session.deleteNoninvasive": true
}

export type AppKeybinding = keyof AppKeybindings

declare module "@earendil-works/pi-tui" {
    interface Keybindings extends AppKeybindings {}
}

export const KEYBINDINGS = {
    ...TUI_KEYBINDINGS,
    "app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" },
    "app.clear": { defaultKeys: "ctrl+c", description: "Clear editor" },
    "app.exit": { defaultKeys: "ctrl+d", description: "Exit when editor is empty" },
    "app.session.rename": {
        defaultKeys: "ctrl+r",
        description: "Rename session",
    },
    "app.session.delete": {
        defaultKeys: "ctrl+d",
        description: "Delete session",
    },
    "app.session.deleteNoninvasive": {
        defaultKeys: "ctrl+backspace",
        description: "Delete session when query is empty",
    },
    "app.session.toggleSort": {
        defaultKeys: "ctrl+s",
        description: "Toggle session sort mode",
    },
} as const satisfies KeybindingDefinitions

export class KeybindingsManager extends TuiKeybindingsManager {
    constructor(userBindings: KeybindingsConfig = {}) {
        super(KEYBINDINGS, userBindings)
    }

    static create(): KeybindingsManager {
        return new KeybindingsManager()
    }

    getEffectiveConfig(): KeybindingsConfig {
        return this.getResolvedBindings()
    }
}
