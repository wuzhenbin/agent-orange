import { Container, Text } from "@earendil-works/pi-tui"
import { CustomColor, AgentColor } from "../../config/settings.ts"

type BlockType =
    | "tips"
    | "prompt"
    | "text"
    | "think"
    | "toolcall"
    | "tool_result"
    | "compact"
    | "status"
    | "error"
    | "warning"
    | "subagent"

// block -> color 映射（关键）
const BlockColorMap: Record<BlockType, (s: string) => string> = {
    tips: CustomColor.tips,
    prompt: (string) => string,
    text: AgentColor.reply,
    think: AgentColor.think,
    toolcall: AgentColor.tool_call,
    tool_result: AgentColor.tool_result,
    compact: AgentColor.compact,
    subagent: AgentColor.subagent,
    status: CustomColor.gray,
    error: CustomColor.error,
    warning: CustomColor.warning,
}

interface Block {
    type: BlockType
    buffer: string
    node: Text
}

export class MessageComponent {
    private blocks: Block[] = []
    private currentBlock?: Block
    private lastStatus?: Block

    constructor(private container: Container) {}

    // status 是可覆盖消息
    showStatus(message: string) {
        if (this.lastStatus && this.currentBlock === this.lastStatus) {
            this.updateBlock(this.lastStatus, message)
            return
        }

        this.finishCurrent()
        const block = this.createBlock("status")
        this.blocks.push(block)
        this.currentBlock = block
        this.lastStatus = block
        this.mount(block)
        this.updateBlock(block, message)
    }

    showError(message: string) {
        this.lastStatus = undefined
        this.finishCurrent()
        const block = this.createBlock("error")
        this.blocks.push(block)
        this.currentBlock = block
        this.mount(block)
        this.updateBlock(block, `Error: ${message}`)
    }

    showWarning(message: string) {
        this.lastStatus = undefined
        this.finishCurrent()
        const block = this.createBlock("warning")
        this.blocks.push(block)
        this.currentBlock = block
        this.mount(block)
        this.updateBlock(block, `Warning: ${message}`)
    }

    switchBlock(type: BlockType) {
        if (this.currentBlock?.type === type && !this.isSingleton(type)) {
            return
        }
        this.finishCurrent()
        const block = this.createBlock(type)
        this.blocks.push(block)
        this.currentBlock = block
        this.mount(block)
    }

    writeText(text: string) {
        const normalized = this.normalizeText(text)
        if (!normalized) {
            return
        }
        this.ensureCurrent()
        this.currentBlock!.buffer += normalized
        this.syncBlock(this.currentBlock!)
    }

    writeLine(type: BlockType, text: string) {
        this.switchBlock(type)
        this.writeText(text)
        this.writeText("\n")
    }

    writePart(type: BlockType, text: string) {
        this.switchBlock(type)
        this.writeText(text)
    }

    private isSingleton(type: BlockType) {
        return type === "status" || type === "warning" || type === "error"
    }

    private createBlock(type: BlockType): Block {
        return {
            type,
            buffer: "",
            node: new Text("", 0, 0),
        }
    }

    private mount(block: Block) {
        this.container.addChild(block.node)
    }

    private updateBlock(block: Block, text: string) {
        block.buffer = text
        this.syncBlock(block)
    }

    private syncBlock(block: Block) {
        const color = BlockColorMap[block.type]
        block.node.setText(color(block.buffer))
    }

    private ensureCurrent() {
        if (!this.currentBlock) {
            this.switchBlock("text")
        }
    }

    // 结束当前block
    private finishCurrent() {
        const block = this.currentBlock
        if (!block) {
            return
        }
        const normalized = block.buffer.replace(/\n*$/, "\n")
        if (normalized !== block.buffer) {
            block.buffer = normalized
            this.syncBlock(block)
        }
        this.syncBlock(block)
        if (block !== this.lastStatus) {
            this.lastStatus = undefined
        }
    }

    // 限制连续空行
    private normalizeText(text: string) {
        let result = ""
        let newline = 0
        for (const ch of text) {
            if (ch === "\n") {
                newline++
                if (newline <= 2) {
                    result += ch
                }
            } else {
                newline = 0
                result += ch
            }
        }
        return result
    }
}
