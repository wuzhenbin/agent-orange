import OpenAI from "openai"

const client = new OpenAI({ apiKey: "ollama", baseURL: "http://192.168.0.103:11434/v1" })
const response = await client.chat.completions.create({
    model: "qwen3:8b",
    messages: [
        {
            role: "user",
            content: "hello",
        },
    ],
})

console.log(response.choices[0].message.content)
