import { getModelsPath } from "../config/path-config.ts"

export const noModelAvailable = `No models available. Configure at least one model in your models.json file.\nConfig file location: ${getModelsPath()}\nThen use /model select it`
