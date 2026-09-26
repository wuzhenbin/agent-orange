# 扩展位置与当前实现边界

[返回架构概览](../architecture.md)

| 需求 | 修改入口 |
| --- | --- |
| 新增内置工具 | 在 `src/agent-core/tools/` 实现工具，并在 `tool-register.ts` 注册；角色的 `tools` 列表决定是否启用 |
| 新增模型 API | 在 `src/agent-ai/providers/` 实现流式适配，并通过 `api-registry.ts` 注册 |
| 新增代理角色 | 在 `~/.agent-orange/agents/` 添加 TOML 配置；主代理可通过 `delegate_task` 使用 |
| 新增 TUI 命令 | 更新 `src/client-tui/core/slash-commands.ts` 及对应输入处理代码 |

以下是以当前代码为准、维护时需要留意的边界：

- 启动流程固定创建 `default` 角色；虽然设置结构中有 `masterProfile`，`createAgentContextParams()` 当前没有读取它。
- 角色配置允许声明 `programs`，`buildSystemPrompt()` 也支持 Python 指令，但 `AgentInstanceFactory.buildDefinition()` 当前没有把 `programs` 传入提示词构造。
- `plugins.json` 的 MCP 配置由工厂向 `MCPClient` 传递 `command` 和 `args`；当前 stdio 客户端构造过程没有传递示例配置中的 `env`。

这些边界也解释了部分 README 配置项与实际运行效果可能存在差异；调整配置能力时，应同时核对运行时装配与用户文档。

继续阅读：[项目文件索引](code-map.md)。
