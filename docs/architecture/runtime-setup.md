# 启动与配置装配

[返回架构概览](../architecture.md)

1. `cli.ts` 以 `--path <目录>` 指定的目录或当前目录作为工作目录，调用 `createAgentContextParams(cwd)`。
2. Builder 创建 `SettingsManager`、`ModelRegistry`、`MCPToolRouter` 和 `ResourceLoader`，再由 `AgentManager` 创建名为 `default` 的主代理；主代理标记为编排者，并启用会话持久化。
3. `AgentInstanceFactory` 读取 `~/.agent-orange/agents/default.toml`、`plugins.json`、项目上下文文件；连接角色声明的 MCP 服务，筛选技能，组装工具和系统提示词，再创建 `Agent`、`AgentSession`、`SessionManager`。
4. `InteractiveMode.run()` 初始化界面，循环获取用户输入并调用当前 `AgentSession.prompt()`。

用户数据路径由 `src/config/path-config.ts` 集中定义，默认根目录为 `~/.agent-orange/`。其中 `settings.json` 保存运行设置，`models.json` 保存 Provider 与模型，`plugins.json` 保存 MCP 声明及技能路径，`agents/*.toml` 定义代理角色，`sessions/*.jsonl` 保存会话。缺失的基础配置由相应加载器创建。

角色的 `tools`、`mcps`、`skills` 字段控制实例可用资源。`ResourceLoader` 还按全局配置目录、工作目录及其祖先目录读取 `AGENTS.md` 或 `CLAUDE.md`，由 `buildSystemPrompt()` 注入系统提示词。`ModelRegistry` 根据 `provider:modelId` 查找模型；API Key 优先取 `models.json` 中的配置，其次取大写 Provider 名对应的环境变量。主代理还获得 `delegate_task` 工具及可用子代理描述。

继续阅读：[一次输入的执行链](request-flow.md)。
