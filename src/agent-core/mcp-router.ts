import MCPClient from "./mcp-client.ts"
import { AgentTool } from "./types.ts"

export default class MCPToolRouter {
    clients: Map<string, MCPClient>

    constructor() {
        this.clients = new Map()
    }

    registerClient(client: MCPClient): boolean {
        if (this.clients.has(client.mcp_name)) {
            return false
        }
        this.clients.set(client.mcp_name, client)
        return true
    }

    hasClient(name: string): boolean {
        return this.clients.has(name)
    }

    getClients(): MCPClient[] {
        return Array.from(this.clients.values())
    }

    getAllTools(): AgentTool[] {
        return this.getClients().flatMap((client) => client.tools)
    }

    getToolsByMcpNames(names: string[]): AgentTool[] {
        const tools: AgentTool[] = []
        for (const mcp_name of names) {
            const client = this.clients.get(mcp_name)
            if (!client) {
                continue
            }
            tools.push(...client.tools)
        }
        return tools
    }
}
