import type { AutocompleteProvider, SlashCommand, AutocompleteItem } from "@earendil-works/pi-tui"
import { CombinedAutocompleteProvider, fuzzyFilter } from "@earendil-works/pi-tui"

import { InteractiveMode } from "./interact.ts"
import { BUILTIN_SLASH_COMMANDS } from "./core/slash-commands.ts"
import { getModelSearchText } from "../agent-core/model-registry-helper.ts"

/** Wrap the current autocomplete provider with additional behavior. */
export type AutocompleteProviderFactory = (current: AutocompleteProvider) => AutocompleteProvider

export default class AutoComplete {
    private app: InteractiveMode
    autocompleteProviderWrappers: AutocompleteProviderFactory[] = []

    private get agentContext() {
        return this.app.agentContext
    }
    private get modelRegistry() {
        return this.agentContext.modelRegistry
    }
    private get sessionManager() {
        return this.agentContext.sessionManager
    }
    private get uiManager() {
        return this.app.uiManager
    }

    constructor(app: InteractiveMode) {
        this.app = app
    }

    private createBaseAutocompleteProvider(): AutocompleteProvider {
        //  commands autocomplete
        const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
            name: command.name,
            description: command.description,
        }))

        // model autocomplete
        const modelCommand = slashCommands.find((command) => command.name === "model")
        if (modelCommand) {
            modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
                // Get available models (scoped or from registry)
                const models = this.modelRegistry.getAll()
                if (models.length === 0) return null

                // Create items with provider/id format
                const items = models.map((m) => ({
                    id: m.id,
                    provider: m.provider,
                    name: m.name,
                    label: `${m.provider}/${m.id}`,
                }))

                // Fuzzy filter by model ID + provider in either order.
                const filtered = fuzzyFilter(items, prefix, getModelSearchText)
                if (filtered.length === 0) return null

                return filtered.map((item) => ({
                    value: item.label,
                    label: item.id,
                    description: item.provider,
                }))
            }
        }

        return new CombinedAutocompleteProvider(
            [...slashCommands],
            this.sessionManager.getCwd(),
            this.uiManager.fdPath,
        )
    }

    setupAutocompleteProvider(): void {
        let provider = this.createBaseAutocompleteProvider()
        const triggerCharacters: string[] = []
        for (const wrapProvider of this.autocompleteProviderWrappers) {
            provider = wrapProvider(provider)
            triggerCharacters.push(...(provider.triggerCharacters ?? []))
        }
        if (triggerCharacters.length > 0) {
            provider.triggerCharacters = [...new Set(triggerCharacters)]
        }

        this.uiManager.editor.setAutocompleteProvider(provider)
    }
}
