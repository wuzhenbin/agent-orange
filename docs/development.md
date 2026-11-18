# 开发指南

[返回文档目录](README.md)

## 环境与运行

项目使用 TypeScript ES modules，推荐 Bun。包声明的 Node 版本要求为 `>=22.19.0`。

```bash
bun install
bun run dev
```

`bun run start` 同样运行 `src/cli.ts`。指定工作目录可执行：

```bash
bun run src/cli.ts --path /absolute/path/to/project
bun run src/cli.ts --version
```

模型服务与运行配置见[配置说明](configuration.md)。从源码运行也会访问全局 `~/.agent-orange/` 配置。

## 构建与格式

```bash
bun run build
bunx prettier --check .
npm run pack:check
```

构建使用 `tsgo -p tsconfig.json`，对 `src/` 做严格类型检查并输出 JavaScript、声明文件及映射到 `dist/`。若找不到 `tsgo`，按仓库约定安装 `@typescript/native-preview`，例如 `npm install -g @typescript/native-preview`。

发布包仅包含 `dist/`，命令入口为 `dist/cli.js`；发布前脚本会执行构建。`pack:check` 仅预览打包内容。

代码遵循 `.prettierrc`：四空格缩进、双引号、无分号、100 字符行宽。文件用 kebab-case，类型和类用 PascalCase，函数与变量用 camelCase。

## 测试现状

当前没有统一测试命令、测试框架或覆盖率要求。`test/` 中是独立脚本，可按需运行：

```bash
bun run test/tool/read.test.ts
```

该脚本主要演示工具参数校验，不代表完整文件读取测试。`test/openai/` 脚本依赖硬编码的本地 Ollama 地址和模型，运行前需调整环境，不能当作可移植的自动化验证。TypeScript 构建仅包含 `src/`，不检查 `test/`。

行为变更应在对应区域增加聚焦测试或脚本，提交前运行相关脚本和构建。TUI 变更附终端输出或截图。

## 提交与文档

提交标题使用 `feat:` 或 `fix:` 等简短前缀，准确描述改动。PR 说明行为变化、执行过的检查与关联问题。新增功能写入 `docs/feature.md`，架构变化同步更新架构专题，新文档加入 [docs/README.md](README.md)。
