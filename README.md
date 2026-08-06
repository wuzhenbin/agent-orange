# my-agent-tui

To install dependencies:

```bash
# 如果没安装bun 执行
curl -fsSL https://bun.sh/install | bash

# 项目下安装依赖
bun install

# 开启agant 运行时
npm run start
```

## 配置目录
位于 ~/.agent-orange/

## 模型配置 (~/.agent-orange/model.json)
优先读取配置的apiKey, 配置不填apiKey将会在环境变量读取, 会读取环境变量对应的${provider}_API_KEY, 例如
```
export DEEPSEEK_API_KEY=""
export DASHSCOPE_API_KEY=""
export OPENROUTER_API_KEY=""
```
models里模型参数
```ts
interface Model {
    id: 模型名
    api: 协议名称 暂时支持 "openai-completions" / "openai-responses"
    provider: 模型提供商
    baseUrl: 模型地址
    reasoning: 是否支持推理
    contextWindow: 上下文窗口大小
    maxTokens: 最大token限制
}
```

## 模型配置参考
```json
{
    "providers": {
        "deepseek": {
            "baseUrl": "https://api.deepseek.com",
            "api": "openai-completions",
            "models": [
                { "id": "qwen3.7" },
            ]
        },
        "ollama": {
            "baseUrl": "http://192.168.0.103:11434/v1",
            "api": "openai-responses",
            "apiKey": "ollama",
            "models": [
                {
                    "id": "DeepSeek-V4-Flash-0731",
                    "contextWindow": 128000,
                    "maxTokens": 32000
                },
                {
                    "id": "DeepSeek-V4-Pro",
                    "contextWindow": 128000,
                    "maxTokens": 32000
                }
            ]
        },
        "dashscope": {
            "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "api": "openai-completions",
            "models": [
                { "id": "qwen3.7" },
            ]
        }
    }
}
```

## fd/rg 工具
```bash
# 如果~/.agent-orange/bin目录没有相关权限 提供权限
chmod -R +x ./bin

# 测试
~/.agent-orange/bin/rg --version
~/.agent-orange/bin/rg openai . | head -20
~/.agent-orange/bin/rg openai . -g '!node_modules/**' | head
~/.agent-orange/bin/rg openai . --debug
```

## rg忽略搜索目标的机制
.gitignore: Git ignore，需要 Git 上下文（通常有 .git）
.ignore: 无论是不是 Git 仓库都会生效
.rgignore: ripgrep 专用，也总是生效


## 压缩场景测试提示词
```
我正在启动一个代号为‘Project Lighthouse’（灯塔计划）的开源智能家居项目。请为我新建一个文本文件,撰写一份长达800字的项目愿景声明，
重点阐述为什么‘边缘计算’比‘云计算’更适合隐私保护。请务必在声明的最后一段提及：我们的初始启动资金是320万美元，且核心团队拒绝任何风险投资

针对上述愿景，请详细对比 Zigbee 和 Z-Wave 两种协议在开源社区中的支持度。请写一篇约1000字的技术分析，并强制要求：在对比表格的下方，用加粗字体写下结论——‘我们最终选择Zigbee 3.0，因为它拥有更开放的MAC层许可’

现在，请虚构一位我们的典型种子用户。姓名叫‘王建军’，52岁，居住在中国成都，是一名退休的无线电工程师。请写一段800字的人物画像，强调他非常介意数据被互联网大厂获取，且他的儿子在国外留学，需要通过特定端口转发才能访问家里设备。
```

## 在任意目录打开agent运行时
1 创建orange
touch ~/.bun/bin/orange
2 根据项目位置修改PROJECT
```sh
#!/bin/bash
PROJECT=""
WORKDIR="$PWD"
cd "$PROJECT" || exit 1
bun run start "$WORKDIR" "$@"
```
3 提供指令权限
sudo chmod +x ~/.bun/bin/orange


## subagent设计
```
Subagent 作为 Agent Runtime 能力
- 专门的 Planner Agent
- 主 Agent 输出结构化计划

tui -> /subagent prompt -> session.prompt -> 
tui -> session.subscribe 
```