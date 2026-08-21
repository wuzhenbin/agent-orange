import { dirname, join } from "path"
import { existsSync } from "fs"
import { homedir } from "os"
import { fileURLToPath } from "node:url"

// =============================================================================
// Package Detection
// =============================================================================
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const CONFIG_DIR_NAME: string = ".agent-orange"

export function getPackageDir(): string {
    let dir = __dirname
    while (dir !== dirname(dir)) {
        if (existsSync(join(dir, "package.json"))) {
            return dir
        }
        dir = dirname(dir)
    }
    return __dirname
}

export function getGlobalDir(): string {
    return join(homedir(), CONFIG_DIR_NAME)
}

/** Get path to sessions directory */
export function getSessionsDir(): string {
    return join(getGlobalDir(), "sessions")
}

export function getAgentsDir(): string {
    return join(getGlobalDir(), "agents")
}

export function getBinDir(): string {
    return join(getGlobalDir(), "bin")
}

export function getPythonRunDir(): string {
    return join(getGlobalDir(), "python-runtime")
}

export function getSkillsPath(): string {
    return join(getGlobalDir(), "skills")
}

export function getModelsPath(): string {
    return join(getGlobalDir(), "models.json")
}

export function getSettingsPath(): string {
    return join(getGlobalDir(), "settings.json")
}

export function getPluginPath(): string {
    return join(getGlobalDir(), "plugins.json")
}
