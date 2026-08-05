import readline from "readline"

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})

console.log("输入任意内容，我会原样返回。输入 exit 退出。")

rl.on("line", (input) => {
    if (input.trim() === "exit") {
        console.log("已退出")
        rl.close()
        return
    }

    // 原样输出
    console.log("你输入的是：", input)
})
