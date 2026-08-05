import { clearApiProviders, registerApiProvider } from "../api-registry.ts"
import {
    Api,
    StreamOptions,
    Model,
    Context,
    AssistantMessageEvent,
    StreamFunction,
    AssistantMessage,
    SimpleStreamOptions,
} from "../types.ts"
import { AssistantMessageEventStream } from "../../utils/event-stream.ts"
import type { OpenAICompletionsOptions } from "./openai-completions.ts"
import type { OpenAIResponsesOptions } from "./openai-responses.ts"

interface LazyProviderModule<
    TApi extends Api,
    TOptions extends StreamOptions,
    TSimpleOptions extends SimpleStreamOptions,
> {
    stream: (
        model: Model<TApi>,
        context: Context,
        options?: TOptions,
    ) => AsyncIterable<AssistantMessageEvent>
    streamSimple: (
        model: Model<TApi>,
        context: Context,
        options?: TSimpleOptions,
    ) => AsyncIterable<AssistantMessageEvent>
}

let openAICompletionsProviderModulePromise:
    | Promise<
          LazyProviderModule<"openai-completions", OpenAICompletionsOptions, SimpleStreamOptions>
      >
    | undefined

let openAIResponsesProviderModulePromise:
    | Promise<LazyProviderModule<"openai-responses", OpenAIResponsesOptions, SimpleStreamOptions>>
    | undefined

function forwardStream(
    target: AssistantMessageEventStream,
    source: AsyncIterable<AssistantMessageEvent>,
): void {
    ;(async () => {
        for await (const event of source) {
            target.push(event)
        }
        target.end()
    })()
}

function createLazyStream<
    TApi extends Api,
    TOptions extends StreamOptions,
    TSimpleOptions extends SimpleStreamOptions,
>(
    loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>,
): StreamFunction<TApi, TOptions> {
    return (model, context, options) => {
        const outer = new AssistantMessageEventStream()

        loadModule()
            .then((module) => {
                const inner = module.stream(model, context, options)
                forwardStream(outer, inner)
            })
            .catch((error) => {
                const message = createLazyLoadErrorMessage(model, error)
                outer.push({ type: "error", reason: "error", error: message })
                outer.end(message)
            })

        return outer
    }
}

function createLazySimpleStream<
    TApi extends Api,
    TOptions extends StreamOptions,
    TSimpleOptions extends SimpleStreamOptions,
>(
    loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>,
): StreamFunction<TApi, TSimpleOptions> {
    return (model, context, options) => {
        const outer = new AssistantMessageEventStream()

        loadModule()
            .then((module) => {
                const inner = module.streamSimple(model, context, options)
                forwardStream(outer, inner)
            })
            .catch((error) => {
                const message = createLazyLoadErrorMessage(model, error)
                outer.push({ type: "error", reason: "error", error: message })
                outer.end(message)
            })

        return outer
    }
}

function createLazyLoadErrorMessage<TApi extends Api>(
    model: Model<TApi>,
    error: unknown,
): AssistantMessage {
    return {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
    }
}

function loadOpenAICompletionsProviderModule(): Promise<
    LazyProviderModule<"openai-completions", OpenAICompletionsOptions, SimpleStreamOptions>
> {
    openAICompletionsProviderModulePromise ||= import("./openai-completions.ts").then((module) => {
        interface OpenAICompletionsProviderModule {
            streamOpenAICompletions: StreamFunction<"openai-completions", OpenAICompletionsOptions>
            streamSimpleOpenAICompletions: StreamFunction<"openai-completions", SimpleStreamOptions>
        }
        const provider = module as OpenAICompletionsProviderModule
        return {
            stream: provider.streamOpenAICompletions,
            streamSimple: provider.streamSimpleOpenAICompletions,
        }
    })
    return openAICompletionsProviderModulePromise
}

function loadOpenAIResponsesProviderModule(): Promise<
    LazyProviderModule<"openai-responses", OpenAIResponsesOptions, SimpleStreamOptions>
> {
    openAIResponsesProviderModulePromise ||= import("./openai-responses.ts").then((module) => {
        interface OpenAIResponsesProviderModule {
            streamOpenAIResponses: StreamFunction<"openai-responses", OpenAIResponsesOptions>
            streamSimpleOpenAIResponses: StreamFunction<"openai-responses", SimpleStreamOptions>
        }
        const provider = module as OpenAIResponsesProviderModule
        return {
            stream: provider.streamOpenAIResponses,
            streamSimple: provider.streamSimpleOpenAIResponses,
        }
    })
    return openAIResponsesProviderModulePromise
}

export function registerBuiltInApiProviders(): void {
    registerApiProvider({
        api: "openai-completions",
        stream: createLazyStream(loadOpenAICompletionsProviderModule),
        streamSimple: createLazySimpleStream(loadOpenAICompletionsProviderModule),
    })

    registerApiProvider({
        api: "openai-responses",
        stream: createLazyStream(loadOpenAIResponsesProviderModule),
        streamSimple: createLazySimpleStream(loadOpenAIResponsesProviderModule),
    })
}

export function resetApiProviders(): void {
    clearApiProviders()
    registerBuiltInApiProviders()
}

registerBuiltInApiProviders()
