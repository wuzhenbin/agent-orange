import chalk from "chalk"

export const Welcome = `\nWelcome 🍊Orange Agent!\n`

export const APP_TITLE: string = "Orange"

export enum MessageType {
    Text = "text",
    Thinking = "thinking",
    ToolCall = "toolCall",
    ToolResult = "toolResult",
    Error = "error",
}

export const CustomColor = {
    tips: chalk.hex("#00897B"),
    gray: chalk.hex("#787878"),
    title: chalk.hex("#F0C674"),
    info: chalk.hex("#38BDF8"),
    warning: chalk.hex("#F5A623"),
    error: chalk.hex("#F87171"),
}

export const AgentColor = {
    theme: chalk.hex("#F59E0B"),
    think: CustomColor.gray,
    reply: chalk.hex("#B795F5"),
    tool_call: chalk.hex("#00897B"),
    tool_result: chalk.hex("#FF8800"),
    compact: chalk.hex("#FF479C"),
    subagent: CustomColor.info,
}

export const logo = `
　/＼7　　　 ∠＿/
　/　│　　 ／　／
　│　Z ＿,＜　／　　 /\`ヽ
　│　　　　　ヽ　　 /　　〉
　Y　　　　　\`　 /　　/
　ｲ ●　､　●　　⊂⊃〈　　/
　()　 へ　　　　|　＼〈
　　>ｰ ､_　 ィ　 │ ／／
　 / へ　　 /　ﾉ＜| ＼＼
　 ヽ_ﾉ　　(_／　 │／／
　　7　　　　　　　|／
　　＞―r￣￣\`ｰ―＿
\n
`
