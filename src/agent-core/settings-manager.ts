import fs from "fs"
import path from "path"
import { SettingsConfig, DEFAULT_SETTINGS, deepMerge } from "./settings-manager-helper.ts"
import { getSettingsPath } from "../config/path-config.ts"

const defaultSettingOverride = {
    masterProfile: "default",
    defaultModel: {
        provider: "ollama",
        model: "qwen3:8b",
        thinkingLevel: "medium",
    },
}

export class SettingsManager {
    private readonly filePath: string
    // 默认配置
    private readonly defaults: SettingsConfig
    // 用户覆盖配置（只保存用户修改）
    private overrides: Partial<SettingsConfig>
    // 最终运行配置
    private config: SettingsConfig

    constructor() {
        this.filePath = getSettingsPath()
        this.defaults = DEFAULT_SETTINGS
        this.ensureFile()
        this.overrides = this.loadOverrides()
        this.config = deepMerge(this.defaults, this.overrides)
    }

    private ensureFile() {
        const dir = path.dirname(this.filePath)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {
                recursive: true,
            })
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify(defaultSettingOverride, null, 4), "utf8")
        }
    }

    private loadOverrides(): Partial<SettingsConfig> {
        const content = fs.readFileSync(this.filePath, "utf8")
        if (!content.trim()) {
            return {}
        }
        return JSON.parse(content)
    }

    private rebuild() {
        this.config = deepMerge(this.defaults, this.overrides)
    }

    get<K extends keyof SettingsConfig>(key: K): SettingsConfig[K] {
        return this.config[key]
    }

    getAll(): SettingsConfig {
        return this.config
    }

    set<K extends keyof SettingsConfig>(key: K, value: SettingsConfig[K]) {
        this.overrides[key] = value
        this.rebuild()
        this.save()
    }

    setMany(values: Partial<SettingsConfig>) {
        Object.assign(this.overrides, values)
        this.rebuild()
        this.save()
    }

    reset<K extends keyof SettingsConfig>(key: K) {
        delete this.overrides[key]
        this.rebuild()
        this.save()
    }

    resetAll() {
        this.overrides = {}
        this.rebuild()
        this.save()
    }

    private save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.overrides, null, 4), "utf8")
    }
}
