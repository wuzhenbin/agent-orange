import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { AgentTool } from "./types.ts"

export default class MCPClient {
    public mcp_name = ""
    public tools: AgentTool[] = []
    private mcp: Client
    private command: string
    private transport: StdioClientTransport | null = null
    private args: string[]

    constructor(mcp_name: string, command = "", args = []) {
        this.mcp = new Client({ name: mcp_name, version: "1.0.0" })
        this.command = command
        this.args = args
        this.mcp_name = mcp_name
    }

    async connectToServer() {
        try {
            this.transport = new StdioClientTransport({
                command: this.command,
                args: this.args,
            })
            await this.mcp.connect(this.transport)

            const toolsResult = await this.mcp.listTools()
            this.tools = toolsResult.tools.map((tool) => {
                const prefixed_name = `mcp__${this.mcp_name}__${tool.name}`
                return {
                    name: prefixed_name,
                    description: tool.description || "",
                    parameters: tool.inputSchema,
                    execute: async (_toolCallId, params) => {
                        const result = await this.mcp.callTool({
                            name: tool.name,
                            arguments: params as Record<string, unknown>,
                        })
                        return {
                            content: [{ type: "text", text: JSON.stringify(result.content) }],
                            details: {},
                        }
                    },
                }
            })
        } catch (e) {
            console.error("Failed to connect to MCP server: ", e)
            throw e
        }
    }

    async close() {
        await this.mcp.close()
    }
}
