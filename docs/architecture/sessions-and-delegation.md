# 会话和子代理

[返回架构概览](../architecture.md)

`SessionManager` 将会话头、消息、压缩摘要和名称等记录组织为带 `id`、`parentId` 的追加式记录树；当前 `leafId` 指向活跃分支。`buildSessionContext()` 从当前分支构造发送给模型的消息。持久化会话以 JSONL 文件存放在 `~/.agent-orange/sessions/`，首次出现助手消息时才写出新会话文件；之后追加记录。`/new` 创建新会话，`/resume` 从已有文件切换，`/compact` 触发手动压缩。

`delegate_task` 由主代理额外注册。调用后，`AgentManager` 按角色配置创建独立子代理，其会话默认仅在内存中；子代理运行结果中的最后一条助手文本作为工具结果返回主代理。`AgentManager.events` 向 TUI 发出启动、工具调用、工具结果和结束事件。MCP 工具由 `MCPClient` 经 stdio 连接服务器、读取工具清单后包装成 Agent 工具，名称形式为 `mcp__<服务名>__<工具名>`。

继续阅读：[扩展位置与实现边界](extension-points.md)。
