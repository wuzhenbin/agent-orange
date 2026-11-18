<div align="center">

# 🍊 Agent Orange

**一个基于 Bun 的终端 AI Agent 运行时（TUI），支持多模型、子代理、上下文压缩与 MCP 扩展。**

</div>

---

## 项目文档

完整文档见 [文档目录](docs/README.md)，包括[架构总览](docs/architecture.md)、[配置说明](docs/configuration.md)和[开发指南](docs/development.md)。

## 特性

- 🖥️ **终端交互界面（TUI）**：流式输出、会话管理、模型切换
- 🔌 **多模型接入**：兼容 OpenAI `completions` / `responses` 协议，支持 DeepSeek、通义千问、Ollama、OpenRouter 等
- 🧩 **子代理（Subagent）编排**：将复杂任务委派给专用子代理并行执行
- 🗜️ **上下文压缩（Compaction）**：超长会话自动/手动压缩，保留关键信息
- 🛠️ **内置工具集**：bash、文件读写编辑、grep / find 搜索等
- 🔗 **MCP 扩展**：通过 Model Context Protocol 接入外部能力
- 🎨 **主题系统**：内置主题

---

## 快速开始

### 1. 安装 Agent Orange

选择以下任一方式全局安装：

**方式一：Bun（推荐）**

如尚未安装 Bun：

```bash
curl -fsSL https://bun.sh/install | bash
```

> 项目要求 Node `>=22.19.0`，推荐使用 Bun 运行时。

然后全局安装：

```bash
bun add -g orange-agent-harness
```

> 💡 推荐使用 Bun 安装，启动速度更快，且与项目运行时保持一致。

**方式二：npm**

```bash
npm install -g orange-agent-harness
```

**方式三：免安装直接运行**

无需全局安装，通过 `npx` 临时下载并启动：

```bash
npx orange-agent-harness
```

### 2. 启动 Agent 运行时

```bash
orange
```

默认使用当前目录作为工作目录。要指定其他目录，运行 `orange --path <目录>`。

---

## 项目截图

功能特性
<p align="center">
  <img src="./assets/feature.png" width="100%" />
</p>

会话恢复
<p align="center">
  <img src="./assets/resume.png" width="100%" />
</p>

模型选择
<p align="center">
  <img src="./assets/select-model.png" width="100%" />
</p>

## 配置目录

所有配置位于 `~/.agent-orange/`，目录结构如下：

```
~/.agent-orange/
├── models.json       # 模型与提供商配置
├── settings.json     # 运行时设置（主代理角色、默认模型等）
├── plugins.json      # MCP 服务定义与技能路径
├── agents/           # 代理角色配置（*.toml）
│   ├── default.toml  # 主代理（默认角色）
│   └── web-researcher.toml  # 子代理示例
├── sessions/         # 会话持久化
├── bin/              # 内置工具二进制（rg / fd 等）
├── python-runtime/   # Python 运行时（uv 管理）
└── skills/           # 技能目录
```

> 首次启动时会自动创建该目录及默认配置文件。

### settings.json — 运行时设置

配置文件：`~/.agent-orange/settings.json`

```jsonc
{
  "masterProfile": "default",       // 主代理角色名，对应 agents/ 下的 .toml 文件名（不含扩展名）
  "defaultModel": {
    "provider": "deepseek",         // 默认模型提供商（对应 models.json 中的 key）
    "model": "deepseek-chat",       // 默认模型 ID
    "thinkingLevel": "medium"       // 思考强度：off | minimal | low | medium | high | xhigh
  }
}
```

- **`masterProfile`**：指定主代理使用的角色。默认值为 `"default"`，即加载 `agents/default.toml`。你可以在 `agents/` 下创建多个角色文件，通过修改此字段切换主代理的人格与能力。

### agents/ — 代理角色配置

目录：`~/.agent-orange/agents/`

每个 `.toml` 文件定义一个代理角色。`default.toml` 为主代理的默认角色，其余 `.toml` 文件作为**子代理（Subagent）** 供主代理按需委派任务。

#### default.toml 示例

```toml
name = "default"
description = "general-purpose agent"
developer_instructions = "You are a general-purpose AI agent that assists users with software engineering, research, analysis, and problem-solving tasks."
tools = [ "read", "find", "ls", "write", "edit", "grep", "bash" ]
mcps = [ ]
skills = [ ]
programs = [ ]
```

#### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | ✅ | 代理名称，应与文件名一致（如 `default.toml` 对应 `"default"`） |
| `description` | `string` | ✅ | 代理描述。主代理编排时会根据此描述判断是否将任务委派给该子代理 |
| `developer_instructions` | `string` | ✅ | 系统提示词（System Prompt），定义代理的角色、行为准则与能力边界 |
| `tools` | `string[]` | ❌ | 可用工具白名单。可选值：`read`、`write`、`edit`、`ls`、`find`、`grep`、`bash`、`delegate_task`
| `mcps` | `string[]` | ❌ | 启用的 MCP 服务名称列表。名称对应 `plugins.json` 中 `mcpServers` 的 key |
| `skills` | `string[]` | ❌ | 启用的技能名称列表。技能文件从 `plugins.json` 中 `skillsPaths` 指定的目录加载 |
| `programs` | `string[]` | ❌ | 启用的程序运行环境。目前支持 `"python"`，启用后会在 `~/.agent-orange/python-runtime/` 下初始化一个基于 `uv` 的 Python 运行环境，代理可使用 `uv run` / `uv add` 执行 Python 脚本 |

#### mcps / skills 的声明与激活

`mcps` 和 `skills` 采用**声明-激活分离**的设计：

1. **声明**（定义可用资源）：在 `~/.agent-orange/plugins.json` 中声明所有可用的 MCP 服务和技能路径：

```jsonc
{
  "skillsPaths": ["/home/user/.agent-orange/skills"],
  "mcpServers": {
    "fetch": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-fetch"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

2. **激活**（按需启用）：在 `agents/*.toml` 的 `mcps` 和 `skills` 数组中引用已声明的名称，仅列入的项才会被加载到该代理的上下文中：

```toml
# 仅激活 fetch MCP，不激活 github
mcps = [ "fetch" ]

# 激活名为 "code-review" 的技能
skills = [ "code-review" ]
```

> 💡 这种设计使得多个代理可以共享同一份插件声明，但各自按需启用不同的子集，避免资源浪费。

#### programs 运行环境

`programs` 字段用于为代理开启本地程序执行环境。当前支持：

- **`"python"`**：启用后，系统提示中会注入 Python 环境指令，代理将使用 `~/.agent-orange/python-runtime/` 作为工作目录，通过 `uv run` 执行 Python 脚本，通过 `uv add <package>` 安装依赖。

---

## 模型配置

配置文件：`~/.agent-orange/models.json`

### API Key 读取顺序

1. **优先**读取配置文件中 provider 的 `apiKey` 字段；
2. 若未填写，则从**环境变量**读取，规则为 `${PROVIDER}_API_KEY`（provider 名称大写）。

```bash
export DEEPSEEK_API_KEY=""
export DASHSCOPE_API_KEY=""
export OPENROUTER_API_KEY=""
```

### Provider 参数

```ts
interface Provider {
    baseUrl: string    // 模型服务地址
    api: string        // 协议："openai-completions" | "openai-responses"
    apiKey?: string    // 可选，留空则读取环境变量
    models: Model[]    // 该 provider 下的模型列表
}

interface Model {
    id: string             // 模型名
    reasoning?: boolean    // 是否支持推理（思考链）
    contextWindow?: number // 上下文窗口大小
    maxTokens?: number     // 单次最大 token 限制
}
```

### 配置示例

```jsonc
{
  "providers": {
    // DeepSeek —— 通过环境变量 DEEPSEEK_API_KEY 鉴权
    "deepseek": {
      "baseUrl": "https://api.deepseek.com",
      "api": "openai-completions",
      "models": [
        { "id": "deepseek-chat" },
        { "id": "deepseek-reasoner", "reasoning": true }
      ]
    },

    // Ollama —— 本地服务，固定 apiKey
    "ollama": {
      "baseUrl": "http://192.168.0.103:11434/v1",
      "api": "openai-responses",
      "apiKey": "ollama",
      "models": [
        { "id": "qwen2.5:32b", "contextWindow": 128000, "maxTokens": 32000 }
      ]
    },

    // 通义千问（DashScope 兼容模式）—— 通过环境变量 DASHSCOPE_API_KEY 鉴权
    "dashscope": {
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "api": "openai-completions",
      "models": [
        { "id": "qwen-plus" },
        { "id": "qwen3-coder-plus" }
      ]
    }
  }
}
```

> 💡 提示：`models.json` 路径对应 `~/.agent-orange/models.json`。运行时通过 TUI 中 `/model` 命令可在已配置模型间快速切换。

---

## 上下文文件（AGENTS.md / CLAUDE.md）

Agent 启动时会自动加载项目上下文文件，用于注入项目特定的指令：

- 查找文件名：`AGENTS.md`（优先）或 `CLAUDE.md`
- 加载范围：从 `~/.agent-orange/`（全局）起，沿当前工作目录向上逐级查找祖先目录中的同名文件，去重后合并
- 适用于存放项目规范、技术栈说明、编码约定等

---

## 子代理（Subagent）

### 子代理配置示例

在 `~/.agent-orange/agents/` 下创建新的 `.toml` 文件即可定义子代理（文件名不能为 `default.toml`）：

```toml
# ~/.agent-orange/agents/web-researcher.toml
name = "web-researcher"
description = "用于联网检索、抓取网页与从在线资源提取结构化信息的专用代理"
developer_instructions = """
你是专注联网研究的子代理。
你的职责是：通过 MCP 工具抓取网页内容，提取关键信息并返回结构化结论。
不要回答与联网检索无关的问题。
"""

tools    = ["bash", "read", "grep"]   # 限定可用工具；省略则使用全部内置工具
mcps     = ["fetch"]                  # 启用 plugins.json 中声明的 fetch MCP 服务
skills   = []                         # 不启用额外技能
programs = []                         # 不需要程序运行环境
```

### 工作机制

- 主代理（orchestrator）读取 `settings.json` 中的 `masterProfile` 确定自身角色，并加载 `agents/` 下**除 default.toml 以外**的全部子代理定义，在系统提示中作为 `<available_agents>` 暴露给模型；
- 当任务匹配某个子代理的能力时，主代理调用 `delegate_task` 工具，将任务委派给子代理**独立执行**；
- 子代理仅向主代理返回**最终结论**，由主代理整合后回答用户。

```
TUI ──> /subagent 提示词 ──> session.prompt ──┐
                                              ├──> 主代理编排
TUI <── session.subscribe <── 子代理事件流 <──┘
```

> 委派原则：需要专门技能、可独立运行、或可并行执行时才委派；简单任务由主代理直接处理。

---

## 内置工具

| 工具 | 说明 |
| --- | --- |
| `bash` | 执行 shell 命令 |
| `read` | 读取文件内容（支持分页读取大文件） |
| `write` | 写入文件（不存在则创建） |
| `edit` | 基于精确文本替换的文件编辑 |
| `ls` | 列出目录内容 |
| `find` | 按 glob 模式查找文件 |
| `grep` | 按正则/字面量搜索文件内容 |
| `delegate_task` | 委派任务给子代理 |

---

## 斜杠命令（Slash Commands）

在 TUI 输入框中使用：

| 命令 | 说明 |
| --- | --- |
| `/new` | 新建会话 |
| `/model` | 打开模型选择器，切换当前模型 |
| `/compact` | 手动压缩当前会话上下文 |
| `/name` | 设置会话显示名称 |
| `/resume` | 恢复其他会话 |
| `/quit` | 退出 Agent |

---

## 内置搜索工具（rg / fd）

`~/.agent-orange/bin/` 下内置 `rg`（ripgrep）与 `fd`。若提示无执行权限：

```bash
chmod -R +x ~/.agent-orange/bin
```

验证：

```bash
~/.agent-orange/bin/rg --version
~/.agent-orange/bin/rg "openai" . | head -20
~/.agent-orange/bin/rg "openai" . -g '!node_modules/**' | head
~/.agent-orange/bin/rg "openai" . --debug
```

### rg 忽略规则

ripgrep 按以下顺序读取忽略文件：

| 文件 | 生效条件 |
| --- | --- |
| `.gitignore` | Git 仓库内（通常存在 `.git` 目录） |
| `.ignore` | 无论是否为 Git 仓库都生效 |
| `.rgignore` | ripgrep 专用，始终生效 |

---

## 开发

```bash
# 下载tsgo进行编译
npm install @typescript/native-preview -g

# 构建类型检查
bun run build

# 代码格式化
bunx prettier --write .
```
---


## 上下文压缩测试用例

以下提示词可生成超长多轮对话，用于验证 `/compact` 压缩能力：

### Prompt 1
```text
我需要你帮我制定一个 SaaS 产品在美国市场发布的 go-to-market 计划。先不要急着给完整方案。接下来我会逐步告诉你背景、约束和我的偏好。你需要记住这些信息，并在后续方案中持续使用它们。
```

### Prompt 2
```text
我们是一家日本 SaaS 公司，产品是一个面向 20～200 人规模公司的 AI 客服平台。目前主要市场在日本，美国市场还没有正式上线。美国市场的首发预算是 10 万美元，包含 marketing、广告、PR 和活动费用，但不包含人员工资。第一阶段目标是上线后的 6 个月内获得 50 个付费美国客户。
```

### Prompt 3
```text
我们的目标客户不是大型 Enterprise。
第一阶段主要针对：
- 20～200 人规模的 B2B SaaS、电商和互联网公司
- 客服团队大约 5～30 人
- 已经在使用 Zendesk、Intercom 或类似产品
- 对 AI customer support 有兴趣
不要把 Fortune 500 当成第一阶段目标客户。
```

### Prompt 4
```text
还有一个很重要的限制：
我们现在没有美国本地销售团队。
只有：
- 2 个日本销售
- 1 个日本 marketing
- 2 个工程师
- CEO 可以参与美国市场活动，但每个月最多只能去美国一次。
所以第一阶段不能设计成严重依赖线下销售拜访的模式。
```

### Prompt 5
```text
关于品牌定位，我不希望把产品宣传成“便宜的日本 AI 客服工具”。
我们的定位应该更偏向：
“AI customer support platform for growing SaaS and digital businesses”
强调：
- AI automation
- 降低 support workload
- 能和现有 support stack 集成
- implementation 简单
不要把“日本公司”作为核心卖点。
```

### Prompt 6
```text
渠道方面，我比较倾向于：
1. Content / SEO
2. Product-led growth
3. Partner / integration
4. LinkedIn
我不希望第一阶段大量烧 Google Ads。
原因是我们的品牌在美国还没有知名度，我担心直接买流量 CAC 会很高。
```

### Prompt 7
```text
关于活动：
我们可以参加美国的 SaaS conference，但第一阶段最多参加两个。
我比较倾向于 SaaStr 这一类 SaaS 活动。
不要建议参加大量泛科技大会。
```

### Prompt 8
```text
现在加入几个已经确定的决策：

1. 美国官网必须在 launch 前完成。
2. 必须提供英文 demo。
3. 必须提供至少一个美国客户 case study。
4. pricing 页面不能显示日元，只显示美元。
5. 第一阶段不做免费人工 onboarding。
6. 可以提供 14 天 free trial。
```

### Prompt 9
```text
再补充几个细节，你后面需要记住：
我们现在已经有一个 Shopify integration。
Zendesk integration 预计 launch 后 2 个月才能完成。
Intercom integration 暂时没有开发计划。
所以 launch day 的主要 integration 卖点应该是 Shopify，而不是 Zendesk。
```

### Prompt 10
```text
我个人比较担心一个问题：
美国客户可能会担心数据隐私。
所以 marketing message 里面不能轻易声称“完全安全”或者“100% compliant”。
如果涉及 compliance，要明确区分我们已经具备的能力和未来计划。
```

### Prompt 11
```text
目前有三个内部候选方案：
A：大量 Google Ads + SDR outbound
B：Content/SEO + PLG + LinkedIn + 少量 conference
C：找美国 reseller / agency，让 partner 帮我们卖 
我目前最倾向 B。但还没有最终决定。
```

### Prompt 12
```text
我们刚才讨论过一个方案：
第一阶段直接找 5 个美国 reseller。
但我认为这个方案暂时不合适，因为 partner enablement 成本太高，而且我们目前没有专门的人维护 partner。
所以：
不要把“5 个 reseller”当成已经确定的 launch strategy。
可以保留 partner channel，但应该作为后续验证方向。
```
### 在这 /compact

### Prompt 13
```text
现在先不要给最终 GTM。
目前还有三个问题没有解决：
1. 10 万美元具体怎么分配
2. 6 个月获得 50 个客户的 funnel 怎么设计
3. launch 前 8 周具体应该做什么
把这三个问题记住，后面我们继续解决。
```

### Final Test Prompt
```text
好，现在直接继续我们的 GTM 计划。
请你基于我们前面已经讨论和确定的信息，给我一份：
“美国市场 Launch 前 8 周执行计划”。
要求：
1. 按 Week 8 → Week 1 倒排
2. 每周列出最重要的 3～5 个动作
3. 给每个动作标注负责人
4. 给出预算
5. 明确哪些事情必须在 launch 前完成
6. 最后说明为什么你的方案适合我们目前的团队规模
不要重新向我确认已经讨论过的信息。
另外，特别注意：
- 不要把 Zendesk integration 当成 launch day 已经完成
- 不要把 reseller 作为既定 launch strategy
- 不要把 Fortune 500 当成第一阶段 ICP
- 不要把 Google Ads 作为主要获客渠道
- 不要设计大量依赖美国线下销售拜访的方案
```

### 测试关键信息
| 信息                     | Compression 后是否保留 |
| ---------------------- | ----------------- |
| $100k budget           | ✅                 |
| 6个月 50客户               | ✅                 |
| 20–200人 ICP            | ✅                 |
| 非 Fortune 500          | ✅                 |
| 没有美国销售团队               | ✅                 |
| CEO 每月最多去美国一次          | ✅                 |
| Shopify 已有 integration | ✅                 |
| Zendesk 2个月后才有         | ✅                 |
| Intercom 暂无计划          | ✅                 |
| 14天 trial              | ✅                 |
| 不做免费人工 onboarding      | ✅                 |
| USD pricing            | ✅                 |
| 美国 customer case study | ✅                 |
| 不做夸大的 compliance claim | ✅                 |
| 偏好 B                   | ✅                 |
| Google Ads 非主要渠道       | ✅                 |
| 最多两个 conference        | ✅                 |
| reseller 不是既定 strategy | ✅                 |
| 三个 pending questions   | ✅                 |


### 二阶段测试提示词

```text
我们现在发现 launch 前预算只有 70,000 美元，而不是原来的 100,000 美元。
请你不要重新制定整个 GTM。

只修改受影响的部分，并保持之前已经确定的：
- ICP
- positioning
- Shopify launch
- Zendesk timeline
- 14-day trial
- channel preference

同时告诉我，你放弃了哪些原计划，以及为什么。
```

---
