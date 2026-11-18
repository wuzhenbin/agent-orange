# 配置说明

[返回文档目录](README.md)

全局配置根目录为 `~/.agent-orange/`，路径函数位于 `src/config/path-config.ts`。缺失文件通常在对应加载器首次访问时创建；生成模型配置后仍需填写可用模型。

| 路径               | 用途                                     |
| ------------------ | ---------------------------------------- |
| `models.json`      | provider、服务地址、协议、凭据与模型列表 |
| `settings.json`    | 默认模型、重试、压缩和终端设置           |
| `plugins.json`     | MCP 服务声明与技能搜索路径               |
| `agents/*.toml`    | 角色指令及资源白名单                     |
| `sessions/*.jsonl` | 持久化会话                               |
| `skills/`          | 默认技能目录                             |
| `bin/`             | 搜索工具二进制缓存                       |

## 模型

以下是使用本地 OpenAI 兼容服务的示例，端口与模型 ID 需要匹配实际服务：

```json
{
    "providers": {
        "local": {
            "baseUrl": "http://localhost:11434/v1",
            "api": "openai-completions",
            "apiKey": "ollama",
            "models": [
                {
                    "id": "qwen3:8b",
                    "contextWindow": 32768,
                    "maxTokens": 4096
                }
            ]
        }
    }
}
```

内置协议为 `openai-completions` 和 `openai-responses`。API Key 优先使用 provider 配置，否则读取 `${PROVIDER大写}_API_KEY`。模型层可以覆盖 provider 的 `api` 和 `baseUrl`。

模型默认不启用推理，输入类型为文本，上下文窗口 128000，最大输出 16384 Token。推理模型需要配置 `reasoning`，按服务能力设置 `thinkingLevelMap`。`models.json` 支持 JSON 注释；不要据此假定其他 JSON 配置也支持注释。

## 运行设置

```json
{
    "defaultModel": {
        "provider": "local",
        "model": "qwen3:8b",
        "thinkingLevel": "off"
    },
    "retry": {
        "enabled": true,
        "maxRetries": 3,
        "baseDelayMs": 2000
    },
    "compaction": {
        "enabled": true,
        "reserveTokens": 16384,
        "keepRecentTokens": 20000
    }
}
```

设置与内置默认值递归合并，完整字段见 `src/agent-core/settings-manager-helper.ts`。首次默认 provider 和 model 均为空，需要填写或通过 `/model` 选择已配置模型。

## 角色与插件

```toml
name = "default"
description = "通用开发代理"
developer_instructions = "你负责协助完成软件开发任务。"
tools = ["read", "find", "ls", "write", "edit", "grep", "bash"]
mcps = []
skills = []
programs = []
```

`name`、`description` 和 `developer_instructions` 必填。`tools`、`mcps`、`skills` 按名称选择资源；省略 `tools` 时当前工厂使用空列表。自动创建的默认角色会显式包含全部普通内置工具。

```json
{
    "skillsPaths": ["/absolute/path/to/skills"],
    "mcpServers": {
        "example": {
            "command": "/absolute/path/to/mcp-server",
            "args": []
        }
    }
}
```

插件声明后，还需在角色的 `mcps` 或 `skills` 中启用。当前 MCP 客户端使用 stdio，工厂只传递 `command` 和 `args`，未透传服务配置中的 `env`。

## 当前配置边界

- `masterProfile` 存在于设置类型中，但启动装配固定创建 `default`。
- `programs` 存在于角色类型中，提示词构建器也有 Python 分支，但工厂未传递该字段，不能据此认定 Python 环境已自动初始化。
- 模型配置 Schema 中的 `headers`、`authHeader`、`modelOverrides` 等字段没有在当前注册器解析中完整接入。
- 默认 `models.json` 生成为 `{}`，尚不符合要求包含 `providers` 的有效模型配置；应按上述示例填写。

这些说明记录当前实现状态，便于配置时判断实际行为。
