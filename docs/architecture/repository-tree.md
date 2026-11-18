# 仓库结构

[返回文档目录](../README.md)

```text
agent-orange/
├── src/
│   ├── cli.ts                     # 命令行入口
│   ├── agent-core/
│   │   ├── agent-runtime/         # 实例工厂、管理器、活动上下文
│   │   ├── harness/               # Token 估算、摘要与上下文压缩
│   │   ├── prompt/                # 编排与程序环境提示词
│   │   ├── tools/                 # 文件、搜索、Shell、任务委派工具
│   │   ├── agent.ts               # 运行状态、队列、取消和钩子
│   │   ├── agent-loop.ts          # 模型与工具循环
│   │   ├── session.ts             # 会话策略
│   │   ├── session-manager.ts     # 历史条目与存储
│   │   ├── model-registry.ts      # 加载用户模型配置
│   │   ├── resource-loader.ts     # 角色、插件与项目规则
│   │   └── mcp-*.ts               # MCP 连接与工具路由
│   ├── agent-ai/
│   │   ├── providers/             # 协议实现与消息转换
│   │   ├── api-registry.ts        # API 适配器注册
│   │   ├── stream.ts              # 统一流式调用入口
│   │   └── types.ts               # 模型、消息、工具调用和流事件类型
│   ├── client-tui/
│   │   ├── components/            # 编辑器、消息、选择器和页脚
│   │   ├── core/                  # 快捷键与斜杠命令定义
│   │   ├── theme/                 # 主题、颜色与渲染辅助
│   │   ├── interact.ts            # 输入和会话交互循环
│   │   └── ui-manager.ts          # 界面装配、事件订阅与渲染
│   ├── config/                    # 全局路径、界面常量与内置主题
│   └── utils/                     # 事件流、文件、进程、图像等通用工具
├── docs/                          # 文档及目录索引
├── test/
│   ├── openai/                    # 依赖本地模型服务的独立脚本
│   └── tool/                      # 工具参数校验脚本
├── assets/                        # README 截图
├── package.json                   # 命令、依赖与发布配置
└── tsconfig.json                  # 严格类型与构建输出配置
```

`dist/` 是生成目录。运行时用户配置和会话位于 `~/.agent-orange/`，不属于仓库源码。
