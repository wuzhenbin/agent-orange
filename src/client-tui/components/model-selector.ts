import { type Model, modelsAreEqual } from "../../agent-ai/index.ts"
import {
    Container,
    type Focusable,
    fuzzyFilter,
    getKeybindings,
    Input,
    Spacer,
    Text,
    type TUI,
} from "@earendil-works/pi-tui"
import type { ModelRegistry } from "../../agent-core/model-registry.ts"
import { theme } from "../theme/global-instance.ts"
import { DynamicBorder } from "./dynamic-border.ts"

interface ModelItem {
    provider: string
    id: string
    model: Model<any>
}

export interface ModelSearchItem {
    id: string
    provider: string
    name?: string
}

export function getModelSelectorSearchText(item: ModelSearchItem): string {
    const { id, provider } = item
    const name = item.name ? ` ${item.name}` : ""
    return `${provider} ${provider}/${id} ${provider} ${id}${name}`
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container implements Focusable {
    private searchInput: Input

    // Focusable implementation - propagate to searchInput for IME cursor positioning
    private _focused = false
    get focused(): boolean {
        return this._focused
    }
    set focused(value: boolean) {
        this._focused = value
        this.searchInput.focused = value
    }
    private listContainer: Container
    private models: ModelItem[] = []
    private filteredModels: ModelItem[] = []
    private selectedIndex: number = 0
    private currentModel?: Model<any>
    private modelRegistry: ModelRegistry
    private onSelectCallback: (model: Model<any>) => void
    private onCancelCallback: () => void
    private errorMessage?: string
    private tui: TUI

    constructor(
        tui: TUI,
        currentModel: Model<any> | undefined,
        modelRegistry: ModelRegistry,
        onSelect: (model: Model<any>) => void,
        onCancel: () => void,
        initialSearchInput?: string,
    ) {
        super()

        this.tui = tui
        this.currentModel = currentModel
        this.modelRegistry = modelRegistry
        this.onSelectCallback = onSelect
        this.onCancelCallback = onCancel

        // Add top border
        this.addChild(new DynamicBorder())
        this.addChild(new Spacer(1))

        // Create search input
        this.searchInput = new Input()
        if (initialSearchInput) {
            this.searchInput.setValue(initialSearchInput)
        }
        this.searchInput.onSubmit = () => {
            // Enter on search input selects the first filtered item
            if (this.filteredModels[this.selectedIndex]) {
                this.handleSelect(this.filteredModels[this.selectedIndex].model)
            }
        }
        this.addChild(this.searchInput)
        this.addChild(new Spacer(1))

        // Create list container
        this.listContainer = new Container()
        this.addChild(this.listContainer)

        this.addChild(new Spacer(1))
        // Add bottom border
        this.addChild(new DynamicBorder())

        // Load models and do initial render
        this.loadModels().then(() => {
            if (initialSearchInput) {
                this.filterModels(initialSearchInput)
            } else {
                this.updateList()
            }
            // Request re-render after models are loaded
            this.tui.requestRender()
        })
    }

    private async loadModels(): Promise<void> {
        this.errorMessage = undefined
        this.modelRegistry.refresh()

        const loadError = this.modelRegistry.getError()
        if (loadError) {
            this.errorMessage = loadError
        }

        try {
            const models = await this.modelRegistry.getAll()
            this.models = this.sortModels(
                models.map((model) => ({
                    provider: model.provider,
                    id: model.id,
                    model,
                })),
            )

            this.filteredModels = [...this.models]
            const currentIndex = this.filteredModels.findIndex((item) =>
                modelsAreEqual(this.currentModel, item.model),
            )
            this.selectedIndex =
                currentIndex >= 0
                    ? currentIndex
                    : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1))
        } catch (error) {
            this.models = []
            this.filteredModels = []

            this.errorMessage = error instanceof Error ? error.message : String(error)
        }
    }

    private sortModels(models: ModelItem[]): ModelItem[] {
        const sorted = [...models]
        // Sort: current model first, then by provider
        sorted.sort((a, b) => {
            const aIsCurrent = modelsAreEqual(this.currentModel, a.model)
            const bIsCurrent = modelsAreEqual(this.currentModel, b.model)
            if (aIsCurrent && !bIsCurrent) return -1
            if (!aIsCurrent && bIsCurrent) return 1
            return a.provider.localeCompare(b.provider)
        })
        return sorted
    }

    private filterModels(query: string): void {
        this.filteredModels = query
            ? fuzzyFilter(this.models, query, ({ id, provider, model }) =>
                  getModelSelectorSearchText({
                      id,
                      provider,
                      name: model.name,
                  }),
              )
            : this.models
        this.selectedIndex = 0
        this.updateList()
    }

    private updateList(): void {
        this.listContainer.clear()

        const maxVisible = 10
        const startIndex = Math.max(
            0,
            Math.min(
                this.selectedIndex - Math.floor(maxVisible / 2),
                this.filteredModels.length - maxVisible,
            ),
        )
        const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length)

        // Show visible slice of filtered models
        for (let i = startIndex; i < endIndex; i++) {
            const item = this.filteredModels[i]
            if (!item) continue

            const isSelected = i === this.selectedIndex
            const isCurrent = modelsAreEqual(this.currentModel, item.model)

            let line = ""
            if (isSelected) {
                const prefix = theme.fg("accent", "→ ")
                const modelText = `${item.id}`
                const providerBadge = theme.fg("muted", `[${item.provider}]`)
                const checkmark = isCurrent ? theme.fg("success", " ✓") : ""
                line = `${prefix + theme.fg("accent", modelText)} ${providerBadge}${checkmark}`
            } else {
                const modelText = `  ${item.id}`
                const providerBadge = theme.fg("muted", `[${item.provider}]`)
                const checkmark = isCurrent ? theme.fg("success", " ✓") : ""
                line = `${modelText} ${providerBadge}${checkmark}`
            }

            this.listContainer.addChild(new Text(line, 0, 0))
        }

        // Add scroll indicator if needed
        if (startIndex > 0 || endIndex < this.filteredModels.length) {
            const scrollInfo = theme.fg(
                "muted",
                `  (${this.selectedIndex + 1}/${this.filteredModels.length})`,
            )
            this.listContainer.addChild(new Text(scrollInfo, 0, 0))
        }

        // Show error message or "no results" if empty
        if (this.errorMessage) {
            // Show error in red
            const errorLines = this.errorMessage.split("\n")
            for (const line of errorLines) {
                this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0))
            }
        } else if (this.filteredModels.length === 0) {
            this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0))
        } else {
            const selected = this.filteredModels[this.selectedIndex]
            this.listContainer.addChild(new Spacer(1))
            this.listContainer.addChild(
                new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0),
            )
        }
    }

    handleInput(keyData: string): void {
        const kb = getKeybindings()

        // Up arrow - wrap to bottom when at top
        if (kb.matches(keyData, "tui.select.up")) {
            if (this.filteredModels.length === 0) return
            this.selectedIndex =
                this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1
            this.updateList()
        }
        // Down arrow - wrap to top when at bottom
        else if (kb.matches(keyData, "tui.select.down")) {
            if (this.filteredModels.length === 0) return
            this.selectedIndex =
                this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1
            this.updateList()
        }
        // Enter
        else if (kb.matches(keyData, "tui.select.confirm")) {
            const selectedModel = this.filteredModels[this.selectedIndex]
            if (selectedModel) {
                this.handleSelect(selectedModel.model)
            }
        }
        // Escape or Ctrl+C
        else if (kb.matches(keyData, "tui.select.cancel")) {
            this.onCancelCallback()
        }
        // Pass everything else to search input
        else {
            this.searchInput.handleInput(keyData)
            this.filterModels(this.searchInput.getValue())
        }
    }

    private handleSelect(model: Model<any>): void {
        this.onSelectCallback(model)
    }

    getSearchInput(): Input {
        return this.searchInput
    }
}
