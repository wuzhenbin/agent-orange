# Repository Guidelines

## Project Structure & Module Organization

`src/cli.ts` starts the terminal application. Core agent orchestration, tools, sessions, and MCP integration live in `src/agent-core/`; model and provider adapters live in `src/agent-ai/`; terminal UI code lives in `src/client-tui/`. Shared helpers are in `src/utils/`, and configuration defaults are in `src/config/`. Keep tests in `test/`, documentation in `docs/`, and README screenshots in `assets/`. The build writes to `dist/`.

## Documentation Guidelines

Keep project documentation in `docs/`. Record every new feature in `docs/feature.md` for future reference. When a change affects the architecture, update the corresponding architecture documentation in `docs/` as part of the same change.

## Build, Test, and Development Commands

- `bun install` installs dependencies from the Bun lockfile.
- `bun run dev` starts the CLI from TypeScript; `bun run start` uses the same entry point.
- `bun run build` compiles `src/` to `dist/` with `tsgo` and checks TypeScript types. Install `@typescript/native-preview` if `tsgo` is unavailable.
- `bunx prettier --check .` checks formatting; `bunx prettier --write .` formats files.
- `npm run pack:check` previews the published package contents.

## Coding Style & Naming Conventions

Use TypeScript ES modules and keep strict typing enabled. Follow `.prettierrc`: four-space indentation, double quotes, no semicolons, and a 100-character print width. Use kebab-case filenames such as `model-registry.ts`, PascalCase for classes and types, and camelCase for functions and variables. Keep provider-specific code under `src/agent-ai/providers/` and tool implementations under `src/agent-core/tools/`.

## Testing Guidelines

The repository currently has standalone `.test.ts` scripts in `test/openai/` and `test/tool/`, but no package test command, test framework, or coverage threshold. Run a relevant script with `bun run test/path/name.test.ts` and run `bun run build` before submitting. The OpenAI scripts target a hard-coded local Ollama endpoint, so adjust the endpoint for your environment and do not rely on them as portable automated tests. Add focused tests or scripts alongside the affected area when changing behavior.

## Commit & Pull Request Guidelines

Recent commits commonly begin with `feat:` or `fix:` and use short English or Chinese descriptions; follow that pattern with a specific summary, for example `fix: handle missing model config`. In pull requests, explain the behavior changed, list build and test commands run, and link any related issue. Include terminal output or screenshots when changing the TUI. Keep credentials and local `~/.agent-orange/` configuration out of commits.
