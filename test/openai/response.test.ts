import OpenAI from "openai"

const client = new OpenAI({ apiKey: "ollama", baseURL: "http://192.168.0.103:11434/v1" })
try {
    const response = await client.responses.create({
        model: "qwen3:8b",
        input: "hello",
        stream: true,
    })
    console.log(response)
} catch (error) {
    console.error(error)
}
