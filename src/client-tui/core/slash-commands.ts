export interface BuiltinSlashCommand {
    name: string
    description: string
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
    { name: "new", description: "Start a new session" },
    { name: "model", description: "Select model (opens selector UI)" },
    { name: "compact", description: "Manually compact the session context" },
    { name: "name", description: "Set session display name" },
    { name: "resume", description: "Resume a different session" },
    { name: "quit", description: `Quit agent` },
]
