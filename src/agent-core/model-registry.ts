import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname } from "path"
import { normalizePath } from "../utils/paths.ts"
import { stripJsonComments } from "../utils/json.ts"
import type { Model, Api } from "../agent-ai/index.ts"
import { Compile } from "typebox/compile"
import {
    ModelsConfig,
    ModelsConfigSchema,
    formatValidationPath,
    DEFAULT_MODELS_CONFIG,
    ProviderConfigSchema,
} from "./model-registry-helper.ts"
import { getModelsPath } from "../config/path-config.ts"
import { type Static } from "typebox"

export type ProviderConfig = Static<typeof ProviderConfigSchema>

const modelsConfigValidator = Compile(ModelsConfigSchema)

export class ModelRegistry {
    private models: Model<Api>[] = []
    private modelsMap = new Map<string, Model<Api>>()
    private providerConfigs = new Map<string, ProviderConfig>()
    private loadError?: string
    private readonly modelsJsonPath: string

    constructor() {
        this.modelsJsonPath = normalizePath(getModelsPath())
        if (!this.ensureConfigFile()) {
            return
        }
        this.load()
    }

    getModel(provider: string, modelId: string): Model<Api> | undefined {
        return this.modelsMap.get(`${provider}:${modelId}`)
    }

    getApiKey(provider: string): string | undefined {
        const configApiKey = this.providerConfigs.get(provider)?.apiKey
        if (configApiKey) {
            return configApiKey
        }
        // fallback 到环境变量
        const envKey = `${provider.toUpperCase()}_API_KEY`
        return process.env[envKey]
    }

    refresh(): void {
        this.load()
    }

    getError(): string | undefined {
        return this.loadError
    }

    getAll(): Model<Api>[] {
        return this.models
    }

    find(provider: string, modelId: string): Model<Api> | undefined {
        return this.models.find((m) => m.provider === provider && m.id === modelId)
    }

    private ensureConfigFile(): boolean {
        if (existsSync(this.modelsJsonPath)) {
            return true
        }
        try {
            const dir = dirname(this.modelsJsonPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }
            writeFileSync(
                this.modelsJsonPath,
                JSON.stringify(DEFAULT_MODELS_CONFIG, null, 2),
                "utf8",
            )
            return true
        } catch (err) {
            this.loadError =
                err instanceof Error ? `Failed to create models.json: ${err.message}` : String(err)
            return false
        }
    }

    private load(): void {
        if (!this.modelsJsonPath) {
            return
        }
        try {
            const config = this.readConfig()
            this.validateConfig(config)
            this.models = this.parseModels(config)
            this.providerConfigs.clear()
            for (const [name, provider] of Object.entries(config.providers)) {
                this.providerConfigs.set(name, provider)
            }
            this.loadError = undefined
        } catch (err) {
            this.models = []
            this.providerConfigs.clear()
            this.modelsMap.clear()
            this.loadError = err instanceof Error ? err.message : String(err)
        }
    }

    private readConfig(): ModelsConfig {
        const content = readFileSync(this.modelsJsonPath, "utf8")
        const parsed = JSON.parse(stripJsonComments(content)) as unknown
        if (!modelsConfigValidator.Check(parsed)) {
            const errors = modelsConfigValidator
                .Errors(parsed)
                .map((e) => ` - ${formatValidationPath(e)}: ${e.message}`)
                .join("\n")

            throw new Error(`Invalid models.json:\n${errors}`)
        }
        return parsed as ModelsConfig
    }

    private validateConfig(config: ModelsConfig): void {
        const ids = new Set<string>()
        Object.entries(config.providers).forEach(([providerName, provider]) => {
            if (!provider.models?.length) {
                throw new Error(`${providerName}: models required`)
            }

            for (const model of provider.models) {
                const key = `${providerName}:${model.id}`
                if (ids.has(key)) {
                    throw new Error(`Duplicate model ${key}`)
                }
                ids.add(key)
            }
        })
    }

    private parseModels(config: ModelsConfig): Model<Api>[] {
        const result: Model<Api>[] = []

        for (const [providerName, provider] of Object.entries(config.providers)) {
            for (const model of provider.models ?? []) {
                const parsed = {
                    id: model.id,
                    name: `${model.id}(${providerName})`,
                    api: (model.api ?? provider.api) as Api,
                    provider: providerName,
                    baseUrl: model.baseUrl ?? provider.baseUrl ?? "",
                    reasoning: model.reasoning ?? false,
                    thinkingLevelMap: model.thinkingLevelMap ?? {},
                    input: (model.input ?? ["text"]) as ("text" | "image")[],
                    cost: model.cost ?? {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                    },
                    contextWindow: model.contextWindow ?? 128000,
                    maxTokens: model.maxTokens ?? 16384,
                }
                this.modelsMap.set(`${providerName}:${model.id}`, parsed)
                result.push(parsed)
            }
        }

        return result
    }
}
