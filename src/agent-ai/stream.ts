import "./providers/register-builtins.ts"
import type {
    Api,
    Context,
    Model,
    StreamOptions,
    SimpleStreamOptions,
    AssistantMessage,
} from "./types.ts"
import { AssistantMessageEventStream } from "../utils/event-stream.ts"
import { getApiProvider } from "./api-registry.ts"

export type ProviderStreamOptions = StreamOptions & Record<string, unknown>

export function stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
): AssistantMessageEventStream {
    const provider = getApiProvider(model.api)
    if (!provider) {
        throw new Error(`No API provider registered for api: ${model.api}`)
    }
    return provider.stream(model, context, options as StreamOptions)
}

export function streamSimple<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
): AssistantMessageEventStream {
    const provider = getApiProvider(model.api)
    if (!provider) {
        throw new Error(`No API provider registered for api: ${model.api}`)
    }
    return provider.streamSimple(model, context, options)
}

export async function completeSimple<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
    const s = streamSimple(model, context, options)
    return s.result()
}
