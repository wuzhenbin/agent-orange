import { type Static, Type } from "typebox"
import type { TLocalizedValidationError } from "typebox/error"

// Schema for thinking level support and provider-specific values
const ThinkingLevelMapValueSchema = Type.Union([Type.String(), Type.Null()])
const ThinkingLevelMapSchema = Type.Object({
    off: Type.Optional(ThinkingLevelMapValueSchema),
    minimal: Type.Optional(ThinkingLevelMapValueSchema),
    low: Type.Optional(ThinkingLevelMapValueSchema),
    medium: Type.Optional(ThinkingLevelMapValueSchema),
    high: Type.Optional(ThinkingLevelMapValueSchema),
    xhigh: Type.Optional(ThinkingLevelMapValueSchema),
})

// Schema for per-model overrides (all fields optional, merged with built-in model)
const ModelOverrideSchema = Type.Object({
    name: Type.Optional(Type.String({ minLength: 1 })),
    reasoning: Type.Optional(Type.Boolean()),
    thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
    input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
    cost: Type.Optional(
        Type.Object({
            input: Type.Optional(Type.Number()),
            output: Type.Optional(Type.Number()),
            cacheRead: Type.Optional(Type.Number()),
            cacheWrite: Type.Optional(Type.Number()),
        }),
    ),
    contextWindow: Type.Optional(Type.Number()),
    maxTokens: Type.Optional(Type.Number()),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
})

// Schema for custom model definition
// Most fields are optional with sensible defaults for local models (Ollama, LM Studio, etc.)
const ModelDefinitionSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String({ minLength: 1 })),
    api: Type.Optional(Type.String({ minLength: 1 })),
    baseUrl: Type.Optional(Type.String({ minLength: 1 })),
    reasoning: Type.Optional(Type.Boolean()),
    thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
    input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
    cost: Type.Optional(
        Type.Object({
            input: Type.Number(),
            output: Type.Number(),
            cacheRead: Type.Number(),
            cacheWrite: Type.Number(),
        }),
    ),
    contextWindow: Type.Optional(Type.Number()),
    maxTokens: Type.Optional(Type.Number()),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
})

export const ProviderConfigSchema = Type.Object({
    name: Type.Optional(Type.String({ minLength: 1 })),
    baseUrl: Type.Optional(Type.String({ minLength: 1 })),
    apiKey: Type.Optional(Type.String({ minLength: 1 })),
    api: Type.Optional(Type.String({ minLength: 1 })),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    authHeader: Type.Optional(Type.Boolean()),
    models: Type.Optional(Type.Array(ModelDefinitionSchema)),
    modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
})

export const ModelsConfigSchema = Type.Object({
    providers: Type.Record(Type.String(), ProviderConfigSchema),
})

export type ModelsConfig = Static<typeof ModelsConfigSchema>

export function formatValidationPath(error: TLocalizedValidationError): string {
    if (error.keyword === "required") {
        const requiredProperties = (error.params as { requiredProperties?: string[] })
            .requiredProperties
        const requiredProperty = requiredProperties?.[0]
        if (requiredProperty) {
            const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".")
            return basePath ? `${basePath}.${requiredProperty}` : requiredProperty
        }
    }
    const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".")
    return path || "root"
}

export interface ModelSearchItem {
    id: string
    provider: string
    name?: string
}
export function getModelSearchText(item: ModelSearchItem): string {
    const { id, provider } = item
    const name = item.name ? ` ${item.name}` : ""
    return `${id} ${provider} ${provider}/${id} ${provider} ${id}${name}`
}
