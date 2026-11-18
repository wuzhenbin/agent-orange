# 源码导航

[返回文档目录](../README.md)

以下路径相对于仓库根目录。

| 开发任务               | 主要入口                                                | 关联文件                                                               |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 修改 CLI 参数          | `src/cli.ts`                                            | `agent-runtime/agent-context-builder.ts`                               |
| 修改启动装配           | `src/agent-core/agent-runtime/agent-context-builder.ts` | `agent-instance-factory.ts`、`agent-manager.ts`                        |
| 修改代理状态或插话队列 | `src/agent-core/agent.ts`                               | `types.ts`、`agent-loop.ts`                                            |
| 修改模型与工具循环     | `src/agent-core/agent-loop.ts`                          | `tool-execute.ts`                                                      |
| 调整重试或压缩触发     | `src/agent-core/session.ts`                             | `harness/compaction.ts`、`harness/calc-token.ts`                       |
| 修改会话存储与重建     | `src/agent-core/session-manager.ts`                     | `session-manager-helper.ts`、`harness/message.ts`                      |
| 修改默认设置           | `src/agent-core/settings-manager-helper.ts`             | `settings-manager.ts`                                                  |
| 修改模型配置解析       | `src/agent-core/model-registry.ts`                      | `model-registry-helper.ts`、`model-resolver.ts`                        |
| 增加模型协议           | `src/agent-ai/providers/`                               | `api-registry.ts`、`providers/register-builtins.ts`、`types.ts`        |
| 增加本地工具           | `src/agent-core/tools/`                                 | `tool-register.ts`、`types.ts`                                         |
| 修改任务委派           | `src/agent-core/tools/agent.ts`                         | `agent-runtime/agent-manager.ts`                                       |
| 修改 MCP               | `src/agent-core/mcp-client.ts`                          | `mcp-router.ts`、`agent-runtime/agent-instance-factory.ts`             |
| 修改角色或插件加载     | `src/agent-core/resource-loader.ts`                     | `resource-loader-helper.ts`                                            |
| 修改系统提示词         | `src/agent-core/system-prompt.ts`                       | `prompt/orchestrator.ts`、`skills.ts`                                  |
| 修改界面事件处理       | `src/client-tui/ui-manager.ts`                          | `components/stream-message.ts`、`components/footer.ts`                 |
| 修改命令与快捷键       | `src/client-tui/key-handlers.ts`                        | `command-handlers.ts`、`core/slash-commands.ts`、`core/keybindings.ts` |
| 修改模型或会话选择器   | `src/client-tui/selector-handles.ts`                    | `components/model-selector.ts`、`components/session-selector.ts`       |
| 修改主题               | `src/client-tui/theme/`                                 | `src/config/theme/`                                                    |

表格中未带 `src/` 的关联路径相对于同一模块；跨模块路径单独标出。
