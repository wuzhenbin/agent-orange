import chalk from "chalk"

export const Welcome = `\nWelcome back!\n`

export const APP_TITLE: string = "Orange"

export enum MessageType {
    Text = "text",
    Thinking = "thinking",
    ToolCall = "toolCall",
    ToolResult = "toolResult",
    Error = "error",
}

export const CustomColor = {
    tips: chalk.rgb(108, 163, 94),
    gray: chalk.rgb(120, 120, 120),
    title: chalk.rgb(240, 198, 116),
    info: chalk.rgb(56, 189, 248),
    warning: chalk.rgb(245, 166, 35),
    error: chalk.rgb(248, 113, 113),
}

export const AgentColor = {
    think: CustomColor.gray,
    reply: chalk.rgb(183, 149, 245),
    tool_call: chalk.rgb(0, 137, 123),
    tool_result: chalk.rgb(245, 158, 11),
    compact: chalk.rgb(255, 71, 156),
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
