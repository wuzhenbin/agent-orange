# 功能记录

[返回文档目录](README.md)

本文件记录项目现有功能和后续新增功能。以下为根据当前源码整理的功能基线，不作为历史发布时间记录。

| 功能           | 当前行为                                                                  | 主要实现                                               |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| 终端交互       | 输入编辑、流式文本与思考输出、工具状态和主题渲染                          | `src/client-tui/`                                      |
| 多模型         | 配置多个 provider，支持 Completions 与 Responses 协议，通过 `/model` 切换 | `src/agent-ai/`、`src/agent-core/model-registry.ts`    |
| 本地工具       | `read`、`write`、`edit`、`ls`、`find`、`grep`、`bash`                     | `src/agent-core/tools/`                                |
| 工具调度       | 默认并行，可由配置或工具声明触发串行，支持执行前后钩子                    | `src/agent-core/tool-execute.ts`                       |
| 角色与项目规则 | 加载 TOML 角色及全局、祖先目录中的 AGENTS / CLAUDE 规则                   | `src/agent-core/resource-loader.ts`                    |
| 技能           | 从配置路径加载元信息，按角色名称列表启用，正文按需读取                    | `src/agent-core/skills.ts`                             |
| MCP            | 按角色启用 stdio 服务，将服务工具转换为统一工具接口                       | `src/agent-core/mcp-client.ts`                         |
| 子代理         | 主代理初次装配时提供 `delegate_task`，独立执行后返回最终文本              | `src/agent-core/agent-runtime/agent-manager.ts`        |
| 会话管理       | JSONL 持久化，新建、命名、选择和恢复会话                                  | `src/agent-core/session-manager.ts`                    |
| 上下文压缩     | 手动压缩、阈值压缩及一次溢出恢复，保存摘要与近期消息                      | `src/agent-core/harness/`、`src/agent-core/session.ts` |
| 自动重试       | 对可重试模型错误按配置延迟重试                                            | `src/agent-core/session.ts`                            |
| 消息队列       | 核心 API 支持执行中插话与任务结束后的后续消息                             | `src/agent-core/agent.ts`、`src/agent-core/session.ts` |
| CLI 参数       | `--path` 指定工作目录，`--version` 输出版本                               | `src/cli.ts`                                           |

终端内置命令为 `/new`、`/model`、`/compact`、`/name`、`/resume` 和 `/quit`。配置和会话恢复的实现边界分别见[配置说明](configuration.md)与[会话专题](architecture/sessions-and-delegation.md)。

## 文档体系建立

建立文档目录、架构总览、源码导航、启动与请求流程、会话与委派说明、扩展指南及配置和开发指南。文档入口为 [README.md](README.md)。

## 后续记录格式

新增功能时记录名称、用户可见行为、配置或使用入口、主要源码位置及限制；架构发生变化时链接对应专题。
