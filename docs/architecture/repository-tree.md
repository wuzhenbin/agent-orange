# 项目目录树

[返回架构概览](../architecture.md) · [查看逐文件职责](code-map.md)

路径相对于仓库根目录；`node_modules/` 和 `.git/` 是依赖与版本库内部目录，未列入项目目录树。

完整目录树：

```text
.
├── assets/
│   ├── feature.png
│   ├── resume.png
│   └── select-model.png
├── docs/
│   ├── architecture.md
│   └── architecture/
│       ├── code-map.md
│       ├── extension-points.md
│       ├── repository-tree.md
│       ├── request-flow.md
│       ├── runtime-setup.md
│       └── sessions-and-delegation.md
├── src/
│   ├── agent-ai/
│   │   ├── providers/
│   │   │   ├── openai-completions.ts
│   │   │   ├── openai-prompt-cache.ts
│   │   │   ├── openai-responses.ts
│   │   │   ├── provider_types.ts
│   │   │   ├── register-builtins.ts
│   │   │   ├── simple-options.ts
│   │   │   └── transform-messages.ts
│   │   ├── api-registry.ts
│   │   ├── env-api-keys.ts
│   │   ├── index.ts
│   │   ├── models.ts
│   │   ├── session-resources.ts
│   │   ├── stream.ts
│   │   └── types.ts
│   ├── agent-core/
│   │   ├── agent-runtime/
│   │   │   ├── agent-context-builder.ts
│   │   │   ├── agent-context.ts
│   │   │   ├── agent-instance-factory.ts
│   │   │   ├── agent-manager.ts
│   │   │   └── types.ts
│   │   ├── harness/
│   │   │   ├── calc-token.ts
│   │   │   ├── compaction-prompt.ts
│   │   │   ├── compaction.ts
│   │   │   ├── message.ts
│   │   │   └── utils.ts
│   │   ├── prompt/
│   │   │   ├── orchestrator.ts
│   │   │   └── program.ts
│   │   ├── tools/
│   │   │   ├── agent.ts
│   │   │   ├── bash.ts
│   │   │   ├── edit.ts
│   │   │   ├── find.ts
│   │   │   ├── grep.ts
│   │   │   ├── ls.ts
│   │   │   ├── read.ts
│   │   │   └── write.ts
│   │   ├── agent-loop.ts
│   │   ├── agent.ts
│   │   ├── guide.ts
│   │   ├── index.ts
│   │   ├── mcp-client.ts
│   │   ├── mcp-router.ts
│   │   ├── model-registry-helper.ts
│   │   ├── model-registry.ts
│   │   ├── model-resolver.ts
│   │   ├── resource-loader-helper.ts
│   │   ├── resource-loader.ts
│   │   ├── session-manager-helper.ts
│   │   ├── session-manager.ts
│   │   ├── session.ts
│   │   ├── settings-manager-helper.ts
│   │   ├── settings-manager.ts
│   │   ├── skills.ts
│   │   ├── system-prompt.ts
│   │   ├── tool-execute.ts
│   │   ├── tool-register.ts
│   │   └── types.ts
│   ├── client-tui/
│   │   ├── components/
│   │   │   ├── countdown-timer.ts
│   │   │   ├── custom-editor.ts
│   │   │   ├── dynamic-border.ts
│   │   │   ├── footer.ts
│   │   │   ├── model-selector.ts
│   │   │   ├── session-selector-header.ts
│   │   │   ├── session-selector-helper.ts
│   │   │   ├── session-selector-list.ts
│   │   │   ├── session-selector.ts
│   │   │   └── stream-message.ts
│   │   ├── core/
│   │   │   ├── keybinding-hints.ts
│   │   │   ├── keybindings.ts
│   │   │   └── slash-commands.ts
│   │   ├── theme/
│   │   │   ├── color-utilities.ts
│   │   │   ├── global-instance.ts
│   │   │   ├── html-export-helper.ts
│   │   │   ├── theme-loading.ts
│   │   │   ├── theme.ts
│   │   │   ├── tui-helper.ts
│   │   │   └── types.ts
│   │   ├── auto-complete.ts
│   │   ├── command-handlers.ts
│   │   ├── helper.ts
│   │   ├── interact.ts
│   │   ├── key-handlers.ts
│   │   ├── selector-handles.ts
│   │   ├── types.ts
│   │   └── ui-manager.ts
│   ├── config/
│   │   ├── theme/
│   │   │   ├── dark.ts
│   │   │   └── theme-schema.ts
│   │   ├── path-config.ts
│   │   └── settings.ts
│   ├── utils/
│   │   ├── session/
│   │   │   └── uuid.ts
│   │   ├── child-process.ts
│   │   ├── diagnostics.ts
│   │   ├── edit-diff.ts
│   │   ├── event-emit.ts
│   │   ├── event-stream.ts
│   │   ├── exif-orientation.ts
│   │   ├── file-mutation-queue.ts
│   │   ├── frontmatter.ts
│   │   ├── fs-watch.ts
│   │   ├── global-tools.ts
│   │   ├── hash.ts
│   │   ├── headers.ts
│   │   ├── html.ts
│   │   ├── image-resize-core.ts
│   │   ├── image-resize.ts
│   │   ├── json-parse.ts
│   │   ├── json.ts
│   │   ├── mime.ts
│   │   ├── output-accumulator.ts
│   │   ├── overflow.ts
│   │   ├── path-utils.ts
│   │   ├── paths.ts
│   │   ├── photon.ts
│   │   ├── sanitize-unicode.ts
│   │   ├── shell.ts
│   │   ├── sleep.ts
│   │   ├── syntax-highlight.ts
│   │   ├── truncate.ts
│   │   ├── typebox-helpers.ts
│   │   └── validation.ts
│   └── cli.ts
├── test/
│   ├── openai/
│   │   ├── completions.test.ts
│   │   └── response.test.ts
│   └── tool/
│       └── read.test.ts
├── .gitignore
├── .prettierrc
├── .rgignore
├── README.md
├── bun.lock
├── package-lock.json
├── package.json
└── tsconfig.json
```

