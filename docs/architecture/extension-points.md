# 扩展指南

[返回文档目录](../README.md)

## 新增本地工具

在 `src/agent-core/tools/` 新建 kebab-case 文件，实现返回 `AgentTool` 的工厂。工具需提供名称、描述、参数 Schema 与 `execute`；结果由 `content` 和 `details` 组成，可通过更新回调提供进度。

将工厂加入 `tool-register.ts` 的 `toolsRegister`，再在目标角色 TOML 的 `tools` 数组中启用。文件与进程操作应使用工厂传入的工作目录，并处理取消信号。存在顺序要求时声明 `executionMode: "sequential"`。

委派工具通过独立的 `createAgentTools` 注入，不能直接当作普通本地工具名加入当前注册表。

## 新增模型或协议

兼容已有协议的模型可直接加入 `models.json`。全新协议需要在 `src/agent-ai/providers/` 实现 `stream` 与 `streamSimple`，通过 `registerApiProvider` 注册，并在 `providers/register-builtins.ts` 接入；同时检查 `types.ts` 的 API 类型。

适配器需将服务端响应转换为统一助手消息事件，涵盖文本、思考、工具调用、用量、结束与错误。协议差异留在模型层，Agent 循环继续使用统一类型。

## 接入 MCP

在 `plugins.json.mcpServers` 声明服务的 `command` 与 `args`，在角色 `mcps` 中启用。当前使用 stdio 传输，工具名映射为 `mcp__服务名__工具名`。

`MCPClient` 负责连接、列举和调用工具，`MCPToolRouter` 复用连接并按服务名选择工具。增加新的传输方式、环境配置透传或结果类型时，需要修改客户端和工厂装配路径。

## 新增技能或角色

技能目录由 `plugins.json.skillsPaths` 指定，`skills.ts` 负责加载技能元信息；角色通过 `skills` 名称列表选择可用技能。系统提示词展示技能说明和文件位置，具体指令由代理按需读取。

新角色放在 `~/.agent-orange/agents/*.toml`。除默认角色外的角色供编排提示词列举；角色工具名应来自实际注册表。字段格式见[配置说明](../configuration.md)。

## 新增终端命令

在 `client-tui/core/slash-commands.ts` 声明名称与说明，检查 `key-handlers.ts` 的输入分派，并在 `command-handlers.ts` 或选择器处理器中实现行为。涉及会话切换时同步重绑界面订阅；涉及界面组件时复用已有主题和组件模式。

每项新增功能均应记录到 [feature.md](../feature.md)，改变装配或事件流程时同步更新对应架构文档。
