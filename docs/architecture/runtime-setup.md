# 启动与资源装配

[返回文档目录](../README.md)

## 启动顺序

1. `src/cli.ts` 使用 `parseArgs` 解析 `--path` 和 `--version`。版本请求读取包版本后直接返回。
2. 正常启动时动态导入运行时和 TUI 模块，以 `--path` 或当前进程目录作为工作目录。
3. `createAgentContextParams` 创建 `SettingsManager`、`ModelRegistry`、`MCPToolRouter`、`ResourceLoader`、`AgentInstanceFactory` 和 `AgentManager`。
4. 管理器创建 `default` 角色，启用 `orchestrator: true` 与 `sessionPersist: true`，将实例 ID 设为活动代理。
5. CLI 构造 `AgentContext` 和 `InteractiveMode`，初始化界面并进入输入循环。

## 定义构建

`AgentInstanceFactory.buildDefinition` 先读取角色 TOML。主代理额外读取其他角色供编排使用，再读取 `plugins.json`。

- 按角色的 `mcps` 名称初始化服务；已有连接通过共享路由器复用。
- 从 `skillsPaths` 加载技能，再按角色 `skills` 名称筛选。
- 按角色 `tools` 创建本地工具，并合入该角色启用的 MCP 工具。
- 加载全局和项目规则，组装系统提示词。

规则加载先读取 `~/.agent-orange/`，再按从根目录到工作目录的顺序合并祖先目录规则。同一目录优先选择 `AGENTS.md`、`AGENTS.MD`、`CLAUDE.md`、`CLAUDE.MD` 中第一个可读取的文件，并按路径去重。

提示词由角色指令、主代理编排说明、项目规则、技能元信息和工作目录组成。技能正文通过工具按需读取。

## 运行时创建

工厂根据默认模型配置创建 `Agent`，提供 API Key 查询函数和会话 ID，再创建 `AgentSession` 包装它。主代理通过额外工具集合获得 `delegate_task`；子代理默认使用内存会话，不额外注入编排工具。

`AgentContext` 将活动实例和服务暴露给 TUI，并在退出时清理代理与 MCP 连接。新建或恢复会话时，通过 `AgentManager.replaceAgentSession` 为现有定义重建运行时。

## 当前实现边界

启动代码当前固定选择 `default`，没有使用 `settings.masterProfile`。工厂也没有将角色的 `programs` 传给提示词构建器。配置字段存在不代表完整接入；具体限制见[配置说明](../configuration.md)。
