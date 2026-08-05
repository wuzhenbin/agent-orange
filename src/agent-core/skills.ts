import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import ignore from "ignore"
import { basename, dirname, join, relative, sep } from "path"
import { parseFrontmatter } from "../utils/frontmatter.ts"
import { canonicalizePath, resolvePath } from "../utils/paths.ts"

/** Max name length per spec */
const MAX_NAME_LENGTH = 64

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"]

type IgnoreMatcher = ReturnType<typeof ignore>

export interface SkillFrontmatter {
    name?: string
    description?: string
    "disable-model-invocation"?: boolean
    [key: string]: unknown
}

export interface Skill {
    name: string
    description: string
    filePath: string
    baseDir: string
    disableModelInvocation: boolean
}

function toPosixPath(p: string): string {
    return p.split(sep).join("/")
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null

    let pattern = line
    let negated = false

    if (pattern.startsWith("!")) {
        negated = true
        pattern = pattern.slice(1)
    } else if (pattern.startsWith("\\!")) {
        pattern = pattern.slice(1)
    }

    if (pattern.startsWith("/")) {
        pattern = pattern.slice(1)
    }

    const prefixed = prefix ? `${prefix}${pattern}` : pattern
    return negated ? `!${prefixed}` : prefixed
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
    const relativeDir = relative(rootDir, dir)
    const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : ""

    for (const filename of IGNORE_FILE_NAMES) {
        const ignorePath = join(dir, filename)
        if (!existsSync(ignorePath)) continue
        try {
            const content = readFileSync(ignorePath, "utf-8")
            const patterns = content
                .split(/\r?\n/)
                .map((line) => prefixIgnorePattern(line, prefix))
                .filter((line): line is string => Boolean(line))
            if (patterns.length > 0) {
                ig.add(patterns)
            }
        } catch {}
    }
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string): string[] {
    const errors: string[] = []
    if (name.length > MAX_NAME_LENGTH) {
        errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`)
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
        errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`)
    }
    if (name.startsWith("-") || name.endsWith("-")) {
        errors.push(`name must not start or end with a hyphen`)
    }
    if (name.includes("--")) {
        errors.push(`name must not contain consecutive hyphens`)
    }
    return errors
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: string | undefined): string[] {
    const errors: string[] = []

    if (!description || description.trim() === "") {
        errors.push("description is required")
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
        errors.push(
            `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`,
        )
    }

    return errors
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
// 递归目录遍历 + 忽略规则过滤 + Skill 解析
function loadSkillsFromDir(
    dir: string,
    includeRootFiles: boolean,
    ignoreMatcher?: IgnoreMatcher,
    rootDir?: string,
): Skill[] {
    const skills: Skill[] = []
    // 如果目录不存在
    if (!existsSync(dir)) {
        return skills
    }

    const root = rootDir ?? dir
    const ig = ignoreMatcher ?? ignore()
    addIgnoreRules(ig, dir, root)

    try {
        const entries = readdirSync(dir, { withFileTypes: true })
        // 第一轮扫描：寻找 SKILL.md
        for (const entry of entries) {
            if (entry.name !== "SKILL.md") {
                continue
            }

            const fullPath = join(dir, entry.name)
            let isFile = entry.isFile()
            if (entry.isSymbolicLink()) {
                try {
                    isFile = statSync(fullPath).isFile()
                } catch {
                    continue
                }
            }

            const relPath = toPosixPath(relative(root, fullPath))
            if (!isFile || ig.ignores(relPath)) {
                continue
            }

            const result = loadSkillFromFile(fullPath)
            if (result) {
                skills.push(result)
            }
            return skills
        }
        // 第二轮扫描（没有 SKILL.md 时）
        for (const entry of entries) {
            // 跳过隐藏目录
            if (entry.name.startsWith(".")) {
                continue
            }

            // Skip node_modules to avoid scanning dependencies
            if (entry.name === "node_modules") {
                continue
            }

            const fullPath = join(dir, entry.name)
            // For symlinks, check if they point to a directory and follow them
            // 判断文件类型 支持软链接
            let isDirectory = entry.isDirectory()
            let isFile = entry.isFile()
            if (entry.isSymbolicLink()) {
                try {
                    const stats = statSync(fullPath)
                    isDirectory = stats.isDirectory()
                    isFile = stats.isFile()
                } catch {
                    // Broken symlink, skip it
                    continue
                }
            }

            const relPath = toPosixPath(relative(root, fullPath))
            const ignorePath = isDirectory ? `${relPath}/` : relPath
            if (ig.ignores(ignorePath)) {
                continue
            }

            if (isDirectory) {
                const subResult = loadSkillsFromDir(fullPath, false, ig, root)
                skills.push(...subResult)
                continue
            }

            if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) {
                continue
            }

            const result = loadSkillFromFile(fullPath)
            if (result) {
                skills.push(result)
            }
        }
    } catch {}

    return skills
}

function loadSkillFromFile(filePath: string): Skill | null {
    try {
        const rawContent = readFileSync(filePath, "utf-8")
        const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent)
        const skillDir = dirname(filePath)
        const parentDirName = basename(skillDir)

        // Validate description
        const descErrors = validateDescription(frontmatter.description)
        for (const error of descErrors) {
            console.log({ type: "warning", message: error, path: filePath })
        }

        // Use name from frontmatter, or fall back to parent directory name
        const name = frontmatter.name || parentDirName

        // Validate name
        const nameErrors = validateName(name)
        for (const error of nameErrors) {
            console.log({ type: "warning", message: error, path: filePath })
        }

        // Still load the skill even with warnings (unless description is completely missing)
        if (!frontmatter.description || frontmatter.description.trim() === "") {
            return null
        }

        return {
            name,
            description: frontmatter.description,
            filePath,
            baseDir: skillDir,
            disableModelInvocation: frontmatter["disable-model-invocation"] === true,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "failed to parse skill file"
        console.error(message)
        return null
    }
}

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
    const visibleSkills = skills.filter((s) => !s.disableModelInvocation)

    if (visibleSkills.length === 0) {
        return ""
    }

    const lines = [
        "\n\nThe following skills provide specialized instructions for specific tasks.",
        "Use the read tool to load a skill's file when the task matches its description.",
        "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
        "",
        "<available_skills>",
    ]

    for (const skill of visibleSkills) {
        lines.push("  <skill>")
        lines.push(`    <name>${escapeXml(skill.name)}</name>`)
        lines.push(`    <description>${escapeXml(skill.description)}</description>`)
        lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
        lines.push("  </skill>")
    }

    lines.push("</available_skills>")

    return lines.join("\n")
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(skillPaths: string[]): Skill[] {
    const skillMap = new Map<string, Skill>()
    const realPathSet = new Set<string>()

    function addSkills(result: Skill[]) {
        for (const skill of result) {
            // Resolve symlinks to detect duplicate files
            const realPath = canonicalizePath(skill.filePath)

            // Skip silently if we've already loaded this exact file (via symlink)
            if (realPathSet.has(realPath)) {
                continue
            }

            const existing = skillMap.get(skill.name)
            if (!existing) {
                skillMap.set(skill.name, skill)
                realPathSet.add(realPath)
            }
        }
    }

    for (const rawPath of skillPaths) {
        const resolvedPath = resolvePath(rawPath, process.cwd(), { trim: true })
        if (!existsSync(resolvedPath)) {
            continue
        }

        try {
            const stats = statSync(resolvedPath)
            // const source = getSource(resolvedPath)
            if (stats.isDirectory()) {
                addSkills(loadSkillsFromDir(resolvedPath, true))
            } else if (stats.isFile() && resolvedPath.endsWith(".md")) {
                const result = loadSkillFromFile(resolvedPath)
                if (result) {
                    addSkills([result])
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "failed to read skill path"
            console.error(message)
        }
    }

    return Array.from(skillMap.values())
}
