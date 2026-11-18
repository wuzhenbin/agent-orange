# 项目文档目录

Agent Orange 是基于 TypeScript、Bun 和终端 UI 的 AI Agent 应用。本文档根据当前源码整理；涉及运行行为时，以对应源码为准。

## 文档索引

| 文档                                                          | 内容                                       |
| ------------------------------------------------------------- | ------------------------------------------ |
| [架构总览](architecture.md)                                   | 系统分层、依赖关系与核心概念               |
| [仓库结构](architecture/repository-tree.md)                   | 目录职责与文件组织                         |
| [源码导航](architecture/code-map.md)                          | 按开发任务查找源码入口                     |
| [启动与资源装配](architecture/runtime-setup.md)               | CLI、服务初始化、角色与提示词构建          |
| [请求与事件流](architecture/request-flow.md)                  | 用户输入、模型流式响应、工具执行与界面更新 |
| [会话、压缩与子代理](architecture/sessions-and-delegation.md) | 持久化、恢复、重试、上下文压缩与任务委派   |
| [扩展指南](architecture/extension-points.md)                  | 新增工具、模型协议、MCP、技能与终端命令    |
| [配置说明](configuration.md)                                  | 模型、设置、角色、插件与当前实现边界       |
| [开发指南](development.md)                                    | 安装、运行、构建、测试与提交约定           |
| [功能记录](feature.md)                                        | 已有功能及后续新增功能的记录入口           |

## 建议阅读顺序

- 初次了解项目：架构总览 → 仓库结构 → 启动与资源装配 → 请求与事件流。
- 配置并使用：配置说明 → 功能记录。
- 参与开发：开发指南 → 源码导航 → 对应专题 → 扩展指南。

## 维护约定

项目文档统一放在 `docs/`。新增文档时更新本目录；新增功能时更新 `feature.md`；改变模块职责、调用关系或数据结构时同步更新对应架构文档。示例只使用占位凭据，不提交本机 `~/.agent-orange/` 配置。
