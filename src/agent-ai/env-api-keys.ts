import type { KnownProvider } from "./types.ts"

// NEVER convert to top-level imports - breaks browser/Vite builds
let _existsSync: typeof import("node:fs").existsSync | null = null
let _homedir: typeof import("node:os").homedir | null = null
let _join: typeof import("node:path").join | null = null

type DynamicImport = (specifier: string) => Promise<unknown>

const dynamicImport: DynamicImport = (specifier) => import(specifier)
const NODE_FS_SPECIFIER = "node:" + "fs"
const NODE_OS_SPECIFIER = "node:" + "os"
const NODE_PATH_SPECIFIER = "node:" + "path"

// Eagerly load in Node.js/Bun environment only
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
    dynamicImport(NODE_FS_SPECIFIER).then((m) => {
        _existsSync = (m as typeof import("node:fs")).existsSync
    })
    dynamicImport(NODE_OS_SPECIFIER).then((m) => {
        _homedir = (m as typeof import("node:os")).homedir
    })
    dynamicImport(NODE_PATH_SPECIFIER).then((m) => {
        _join = (m as typeof import("node:path")).join
    })
}

let _procEnvCache: Map<string, string> | null = null

/**
 * Fallback for https://github.com/oven-sh/bun/issues/27802
 * Bun compiled binaries have an empty `process.env` inside sandbox
 * environments on Linux. We can recover the env from `/proc/self/environ`.
 */
function getProcEnv(key: string): string | undefined {
    if (!process.versions?.bun) return undefined
    if (typeof process === "undefined") return undefined

    // If process.env already has entries, the bug is not triggered.
    if (Object.keys(process.env).length > 0) return undefined

    if (_procEnvCache === null) {
        _procEnvCache = new Map()
        try {
            const { readFileSync } = require("node:fs") as typeof import("node:fs")
            const data = readFileSync("/proc/self/environ", "utf-8")
            for (const entry of data.split("\0")) {
                const idx = entry.indexOf("=")
                if (idx > 0) {
                    _procEnvCache.set(entry.slice(0, idx), entry.slice(idx + 1))
                }
            }
        } catch {
            // /proc/self/environ may not be readable.
        }
    }

    return _procEnvCache.get(key)
}

function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
    // ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
    if (provider === "anthropic") {
        return ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]
    }

    const envMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
        opencode: "OPENCODE_API_KEY",
        "opencode-go": "OPENCODE_API_KEY",
    }

    const envVar = envMap[provider]
    return envVar ? [envVar] : undefined
}

/**
 * Find configured environment variables that can provide an API key for a provider.
 *
 * This only reports actual API key variables. It intentionally excludes ambient
 * credential sources such as AWS profiles, AWS IAM credentials, and Google
 * Application Default Credentials.
 */
export function findEnvKeys(provider: KnownProvider): string[] | undefined
export function findEnvKeys(provider: string): string[] | undefined
export function findEnvKeys(provider: string): string[] | undefined {
    const envVars = getApiKeyEnvVars(provider)
    if (!envVars) return undefined

    const found = envVars.filter((envVar) => !!process.env[envVar] || !!getProcEnv(envVar))
    return found.length > 0 ? found : undefined
}

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider): string | undefined
export function getEnvApiKey(provider: string): string | undefined
export function getEnvApiKey(provider: string): string | undefined {
    const envKeys = findEnvKeys(provider)
    if (envKeys?.[0]) {
        return process.env[envKeys[0]] || getProcEnv(envKeys[0])
    }

    return undefined
}
