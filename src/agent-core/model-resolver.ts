import { type Api, type Model } from "../agent-ai/index.ts"
/**
 * Find an exact model reference match.
 * Supports either a bare model id or a canonical provider/modelId reference.
 * When matching by bare id, ambiguous matches across providers are rejected.
 */
export function findExactModelReferenceMatch(
    modelReference: string,
    availableModels: Model<Api>[],
): Model<Api> | undefined {
    const trimmedReference = modelReference.trim()
    if (!trimmedReference) {
        return undefined
    }

    const normalizedReference = trimmedReference.toLowerCase()

    const canonicalMatches = availableModels.filter(
        (model) => `${model.provider}/${model.id}`.toLowerCase() === normalizedReference,
    )
    if (canonicalMatches.length === 1) {
        return canonicalMatches[0]
    }
    if (canonicalMatches.length > 1) {
        return undefined
    }

    const slashIndex = trimmedReference.indexOf("/")
    if (slashIndex !== -1) {
        const provider = trimmedReference.substring(0, slashIndex).trim()
        const modelId = trimmedReference.substring(slashIndex + 1).trim()
        if (provider && modelId) {
            const providerMatches = availableModels.filter(
                (model) =>
                    model.provider.toLowerCase() === provider.toLowerCase() &&
                    model.id.toLowerCase() === modelId.toLowerCase(),
            )
            if (providerMatches.length === 1) {
                return providerMatches[0]
            }
            if (providerMatches.length > 1) {
                return undefined
            }
        }
    }

    const idMatches = availableModels.filter(
        (model) => model.id.toLowerCase() === normalizedReference,
    )
    return idMatches.length === 1 ? idMatches[0] : undefined
}
