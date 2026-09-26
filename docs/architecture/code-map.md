# 项目文件索引

[返回架构概览](../architecture.md)

以下列出仓库中的每个项目文件及其职责。路径相对于仓库根目录；`node_modules/` 和 `.git/` 是依赖与版本库内部目录，不属于项目文件清单。

需要浏览完整目录结构时，参见 [项目目录树](repository-tree.md)。

## 根目录、资源、文档与测试

| 文件 | 职责 |
| --- | --- |
| `.gitignore` | 指定 Git 不跟踪的生成文件、依赖和本地文件。 |
| `.prettierrc` | 配置 Prettier 的代码格式。 |
| `.rgignore` | 指定 ripgrep 搜索时跳过的路径。 |
| `README.md` | 提供安装、使用、配置及开发说明。 |
| `package.json` | 声明包信息、CLI 入口、脚本、运行依赖和开发依赖。 |
| `package-lock.json` | 锁定 npm 依赖解析结果。 |
| `bun.lock` | 锁定 Bun 依赖解析结果。 |
| `tsconfig.json` | 配置 TypeScript 编译、模块解析和 `dist/` 输出。 |
| `assets/feature.png` | README 使用的功能界面截图。 |
| `assets/resume.png` | README 使用的会话恢复界面截图。 |
| `assets/select-model.png` | README 使用的模型选择界面截图。 |
| `docs/architecture.md` | 架构入口，概述组件关系并引导到专题文档。 |
| `docs/architecture/code-map.md` | 按目录列出项目文件及职责。 |
| `docs/architecture/extension-points.md` | 记录扩展入口和当前实现边界。 |
| `docs/architecture/request-flow.md` | 描述一次输入的模型与工具执行链。 |
| `docs/architecture/repository-tree.md` | 列出仓库的完整目录结构。 |
| `docs/architecture/runtime-setup.md` | 描述启动及配置装配过程。 |
| `docs/architecture/sessions-and-delegation.md` | 描述持久化会话与子代理。 |
| `test/openai/completions.test.ts` | 验证 OpenAI Completions 适配器的行为。 |
| `test/openai/response.test.ts` | 验证 OpenAI Responses 适配器的行为。 |
| `test/tool/read.test.ts` | 验证文件读取工具的行为。 |

## 入口与模型层：`src/cli.ts`、`src/agent-ai/`

| 文件 | 职责 |
| --- | --- |
| `src/cli.ts` | 解析 `--path` 工作目录参数，创建代理上下文并启动交互模式。 |
| `src/agent-ai/api-registry.ts` | 注册、查询和清空模型 API Provider，校验模型 API 类型与实现一致。 |
| `src/agent-ai/env-api-keys.ts` | 按已知 Provider 查找环境变量中的 API Key，并处理 Bun 环境变量读取的兼容情况。 |
| `src/agent-ai/index.ts` | 汇总导出模型层的类型、工具函数与流式接口。 |
| `src/agent-ai/models.ts` | 计算模型调用费用，判断和约束模型支持的思考等级。 |
| `src/agent-ai/session-resources.ts` | 注册并执行会话相关资源的清理回调。 |
| `src/agent-ai/stream.ts` | 按模型的 API 类型分发 `stream`、`streamSimple` 和单次完成调用。 |
| `src/agent-ai/types.ts` | 定义模型、消息、工具调用、用量、流事件和 Provider 选项的公共类型。 |
| `src/agent-ai/providers/openai-completions.ts` | 构造 Chat Completions 请求，转换消息和工具，并解析流式响应。 |
| `src/agent-ai/providers/openai-prompt-cache.ts` | 限制 OpenAI 提示缓存键的长度。 |
| `src/agent-ai/providers/openai-responses.ts` | 构造 Responses 请求，转换消息和工具，并解析流式响应。 |
| `src/agent-ai/providers/provider_types.ts` | 定义不同兼容服务的请求参数和能力覆盖类型。 |
| `src/agent-ai/providers/register-builtins.ts` | 延迟加载并注册内置的 Completions 与 Responses Provider。 |
| `src/agent-ai/providers/simple-options.ts` | 生成简化调用选项，约束思考等级并调整输出 token 上限。 |
| `src/agent-ai/providers/transform-messages.ts` | 为 Provider 请求整理和转换对话消息。 |

## Agent 核心：`src/agent-core/`

| 文件 | 职责 |
| --- | --- |
| `src/agent-core/agent.ts` | 保存 Agent 状态、订阅者及插话和后续消息队列，启动或继续推理循环。 |
| `src/agent-core/agent-loop.ts` | 运行模型与工具调用循环，发布消息和生命周期事件。 |
| `src/agent-core/guide.ts` | 提供缺少可用模型时的用户提示。 |
| `src/agent-core/index.ts` | 汇总导出 Agent 核心的公共接口。 |
| `src/agent-core/mcp-client.ts` | 经 stdio 连接 MCP 服务，发现其工具并包装为 Agent 工具。 |
| `src/agent-core/mcp-router.ts` | 管理已连接的 MCP 客户端并按服务名称提供工具。 |
| `src/agent-core/model-registry-helper.ts` | 定义模型配置校验 Schema、错误路径格式及模型搜索文本。 |
| `src/agent-core/model-registry.ts` | 读取和验证 `models.json`，建立模型索引并解析 API Key。 |
| `src/agent-core/model-resolver.ts` | 解析用户输入的精确模型引用。 |
| `src/agent-core/resource-loader-helper.ts` | 定义代理角色配置，并收集全局与项目上下文文件。 |
| `src/agent-core/resource-loader.ts` | 读取或创建角色 TOML 与插件 JSON 配置。 |
| `src/agent-core/session-manager-helper.ts` | 定义会话记录类型，读取 JSONL，重建分支上下文并生成会话列表信息。 |
| `src/agent-core/session-manager.ts` | 管理会话 ID、当前分支及记录追加，创建、打开和列举持久化会话。 |
| `src/agent-core/session.ts` | 协调用户输入、Agent 事件、会话持久化、重试和上下文压缩。 |
| `src/agent-core/settings-manager-helper.ts` | 定义运行设置、默认值及设置合并函数。 |
| `src/agent-core/settings-manager.ts` | 读取、更新和保存 `settings.json`。 |
| `src/agent-core/skills.ts` | 扫描技能目录、解析技能文件并生成技能提示词片段。 |
| `src/agent-core/system-prompt.ts` | 组合角色指令、子代理描述、项目上下文和技能说明。 |
| `src/agent-core/tool-execute.ts` | 校验、执行和汇总工具调用，支持并发或顺序执行及调用钩子。 |
| `src/agent-core/tool-register.ts` | 注册内置工具，按角色配置创建工具池并添加委派工具。 |
| `src/agent-core/types.ts` | 定义 Agent 状态、事件、工具和推理循环的核心类型。 |

## 运行时、压缩、提示词与工具：`src/agent-core/` 子目录

| 文件 | 职责 |
| --- | --- |
| `src/agent-core/agent-runtime/agent-context-builder.ts` | 初始化设置、模型、MCP 与代理管理器，并创建默认主代理。 |
| `src/agent-core/agent-runtime/agent-context.ts` | 暴露当前代理及服务，处理新建、切换和销毁会话。 |
| `src/agent-core/agent-runtime/agent-instance-factory.ts` | 从角色配置构建定义、工具、提示词和具体 Agent 运行时。 |
| `src/agent-core/agent-runtime/agent-manager.ts` | 管理代理实例、执行子代理任务并发布子代理事件。 |
| `src/agent-core/agent-runtime/types.ts` | 定义代理定义、实例、运行时及子代理事件类型。 |
| `src/agent-core/harness/calc-token.ts` | 根据模型用量或消息内容估算上下文 token 数。 |
| `src/agent-core/harness/compaction-prompt.ts` | 存放完整摘要、增量摘要和长轮次摘要的提示词模板。 |
| `src/agent-core/harness/compaction.ts` | 选择压缩切点、生成摘要并判断自动压缩条件。 |
| `src/agent-core/harness/message.ts` | 构造压缩摘要消息并将 Agent 消息转换为模型消息。 |
| `src/agent-core/harness/utils.ts` | 提取文件操作记录并序列化对话供摘要使用。 |
| `src/agent-core/prompt/orchestrator.ts` | 将可用子代理列表格式化为主代理编排提示词。 |
| `src/agent-core/prompt/program.ts` | 提供 Python 程序环境的提示词片段。 |
| `src/agent-core/tools/agent.ts` | 实现 `delegate_task`，调用代理管理器执行子代理。 |
| `src/agent-core/tools/bash.ts` | 实现 shell 命令执行工具及输出处理。 |
| `src/agent-core/tools/edit.ts` | 实现文件定点编辑、输入检查及修改结果返回。 |
| `src/agent-core/tools/find.ts` | 实现按文件名或模式查找文件的工具。 |
| `src/agent-core/tools/grep.ts` | 实现文件内容搜索工具。 |
| `src/agent-core/tools/ls.ts` | 实现目录列举工具。 |
| `src/agent-core/tools/read.ts` | 实现文件读取工具，处理文本、图片及输出截断。 |
| `src/agent-core/tools/write.ts` | 实现写入文件工具。 |

## 终端界面：`src/client-tui/`

| 文件 | 职责 |
| --- | --- |
| `src/client-tui/auto-complete.ts` | 为斜杠命令、模型参数和路径提供输入补全。 |
| `src/client-tui/command-handlers.ts` | 执行新会话、命名、手动压缩等命令。 |
| `src/client-tui/helper.ts` | 提供终端断连错误识别和路径显示格式化。 |
| `src/client-tui/interact.ts` | 协调 TUI 子模块，循环读取用户输入并提交给会话。 |
| `src/client-tui/key-handlers.ts` | 处理快捷键、输入提交、斜杠命令与退出信号。 |
| `src/client-tui/selector-handles.ts` | 打开模型和会话选择器，处理模型切换与会话恢复。 |
| `src/client-tui/types.ts` | 定义压缩期间排队消息的界面类型。 |
| `src/client-tui/ui-manager.ts` | 初始化终端组件，订阅会话事件并渲染消息、状态和子代理活动。 |
| `src/client-tui/components/countdown-timer.ts` | 为自动重试等等待状态提供倒计时。 |
| `src/client-tui/components/custom-editor.ts` | 封装终端多行输入编辑器及其按键和提交行为。 |
| `src/client-tui/components/dynamic-border.ts` | 按终端宽度绘制可着色的边框。 |
| `src/client-tui/components/footer.ts` | 显示模型、token 用量、工作目录等底栏信息。 |
| `src/client-tui/components/model-selector.ts` | 显示可搜索、可选择的模型列表。 |
| `src/client-tui/components/session-selector-header.ts` | 显示会话选择器的范围、排序、加载和操作提示。 |
| `src/client-tui/components/session-selector-helper.ts` | 处理会话树、搜索、排序、日期显示和文件删除。 |
| `src/client-tui/components/session-selector-list.ts` | 绘制和操作可搜索的会话列表。 |
| `src/client-tui/components/session-selector.ts` | 组合会话选择器界面并协调加载、选择、重命名与删除。 |
| `src/client-tui/components/stream-message.ts` | 按消息类型分块显示提示、推理文本、工具及错误。 |
| `src/client-tui/core/keybinding-hints.ts` | 将快捷键定义格式化为界面提示文本。 |
| `src/client-tui/core/keybindings.ts` | 定义应用快捷键并创建按键管理器。 |
| `src/client-tui/core/slash-commands.ts` | 定义内置斜杠命令及其说明。 |
| `src/client-tui/theme/color-utilities.ts` | 提供颜色转换与终端色彩计算函数。 |
| `src/client-tui/theme/global-instance.ts` | 保存当前主题，注册主题并通知主题变化。 |
| `src/client-tui/theme/html-export-helper.ts` | 将 ANSI 颜色转换为 HTML 可用颜色并判断明暗主题。 |
| `src/client-tui/theme/theme-loading.ts` | 读取和验证主题，检测终端背景并选择默认主题。 |
| `src/client-tui/theme/theme.ts` | 封装主题颜色、文字样式和边框配色。 |
| `src/client-tui/theme/tui-helper.ts` | 为代码高亮、Markdown、编辑器和列表生成 TUI 主题。 |
| `src/client-tui/theme/types.ts` | 定义主题 JSON Schema、颜色类型及校验器。 |

## 配置与通用工具：`src/config/`、`src/utils/`

| 文件 | 职责 |
| --- | --- |
| `src/config/path-config.ts` | 统一计算包目录和 `~/.agent-orange/` 下的配置、会话、工具路径。 |
| `src/config/settings.ts` | 定义欢迎文本、界面标题、消息类别和颜色。 |
| `src/config/theme/dark.ts` | 定义内置深色主题的颜色值。 |
| `src/config/theme/theme-schema.ts` | 定义主题配置的结构说明。 |
| `src/utils/child-process.ts` | 封装子进程启动、同步运行与退出等待。 |
| `src/utils/diagnostics.ts` | 从异常提取可记录的诊断信息并附加到助手消息。 |
| `src/utils/edit-diff.ts` | 处理行尾、模糊匹配、文本编辑应用及差异输出。 |
| `src/utils/event-emit.ts` | 提供有类型约束的事件发布与订阅器。 |
| `src/utils/event-stream.ts` | 提供异步事件流及助手消息流封装。 |
| `src/utils/exif-orientation.ts` | 读取图像 EXIF 方向并旋转图像数据。 |
| `src/utils/file-mutation-queue.ts` | 对同一文件的修改操作排队，避免并发写入冲突。 |
| `src/utils/frontmatter.ts` | 解析和剥离 Markdown 文件中的 YAML frontmatter。 |
| `src/utils/fs-watch.ts` | 封装文件监听、异常处理和监听器关闭。 |
| `src/utils/global-tools.ts` | 查找或下载 `rg`、`fd` 可执行文件。 |
| `src/utils/hash.ts` | 生成短哈希值。 |
| `src/utils/headers.ts` | 将 Fetch `Headers` 转为普通键值对象。 |
| `src/utils/html.ts` | 解码 HTML 字符实体。 |
| `src/utils/image-resize-core.ts` | 在当前进程内缩放和重新编码图片。 |
| `src/utils/image-resize.ts` | 通过 Worker 调用图像缩放，并格式化尺寸提示。 |
| `src/utils/json-parse.ts` | 修复异常 JSON 字符串并解析不完整的流式 JSON。 |
| `src/utils/json.ts` | 去除 JSON 文本中的注释。 |
| `src/utils/mime.ts` | 从文件字节识别受支持的图片 MIME 类型。 |
| `src/utils/output-accumulator.ts` | 累积命令输出，并按限制保留或转存内容。 |
| `src/utils/overflow.ts` | 根据错误文本和用量判断模型上下文溢出。 |
| `src/utils/path-utils.ts` | 展开输入路径，并处理读取路径的字符与平台兼容情况。 |
| `src/utils/paths.ts` | 规范化、解析和格式化通用路径。 |
| `src/utils/photon.ts` | 加载 Photon 图像库并处理 WASM 文件定位。 |
| `src/utils/sanitize-unicode.ts` | 清理无效的 Unicode 代理字符。 |
| `src/utils/session/uuid.ts` | 生成会话使用的 UUID v7。 |
| `src/utils/shell.ts` | 识别 shell 环境并管理脱离终端的子进程。 |
| `src/utils/sleep.ts` | 提供支持取消信号的延时函数。 |
| `src/utils/syntax-highlight.ts` | 将代码或 HTML 转为带终端颜色的高亮文本。 |
| `src/utils/truncate.ts` | 按行数与字节数截断工具输出。 |
| `src/utils/typebox-helpers.ts` | 提供 TypeBox 枚举 Schema 辅助函数。 |
| `src/utils/validation.ts` | 校验并转换工具调用参数。 |

项目使用 TypeScript ESM，`src/cli.ts` 是开发启动入口；`tsconfig.json` 将 `src/` 编译到 `dist/`，包的可执行命令 `orange` 指向 `dist/cli.js`。`package.json` 中的开发和启动脚本使用 Bun。
