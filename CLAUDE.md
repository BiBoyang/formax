# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, Test, and Development Commands

- `bun install` or `npm install` - Install dependencies
- `bun run dev` or `npm run dev` - Run the CLI REPL interface
- `bun run toole` or `npm run toole` - Run tool examples entrypoint
- `npm run type-check` - Run TypeScript type checks (no emit)
- `npm test` - Run all tests (Vitest)
- `npm run test:watch` - Run tests in watch mode
- `npm test -- <path>` - Run a specific test file (e.g., `npm test -- src/tools/registry.test.ts`)
- `npm run test:watch -- -t "<test-name>"` - Run tests matching a pattern

## High-Level Architecture

Formax is a terminal-based AI chat interface built with React + Ink, featuring a sophisticated tool execution system and streaming Anthropic client.

### Core Components

**Entry Points**
- `src/entrypoints/cli.tsx` - Main CLI entry, initializes all services and renders REPL screen
- `src/entrypoints/tool-examples.tsx` - Tool testing/demo entry point

**Screens & UI**
- `src/screens/REPL.tsx` - Main chat REPL interface with command input, streaming output, and tool execution visualization
- `src/screens/ToolExamplesScreen.tsx` - Interactive tool testing UI
- `src/components/` - Reusable Ink components (forms, inputs, status displays)

**Chat Engine**
- `src/chat/engine.ts` - Orchestrates conversation turns, managing the message loop between user and LLM with tool execution
- `src/streaming/anthropic/StreamClient.ts` - Streaming client for Anthropic API with SSE parsing
- `src/streaming/anthropic/sseParser.ts` - Server-sent event parser for streaming responses

**Tool System**
- `src/tools/registry.ts` - Central registry for tool specifications and handlers
- `src/tools/executor/` - Tool execution engine with context management (cwd, signals, tool allow/deny lists)
- `src/tools/modules/` - Individual tool implementations (read, write, bash, grep, glob, webSearch, etc.)
- `src/tools/catalog/` - Tool specification sources (loads from `proxy/tools.json` or similar)
- `src/tools/patches/` - Patches to modify tool specs at runtime (e.g., sub-agent integration)
- `src/tools/runtime/` - Runtime managers for background tasks and user input prompts
- `src/tools/presenters/` - Output formatting/presentation for tool results

**Sub-Agents**
- `src/subagents/registry.ts` - Loads and manages sub-agent definitions from `.claude/agents/*.md` and `~/.claude/agents/*.md`
- `src/subagents/runner.ts` - Executes sub-agents with isolated contexts and tool allowlists

**Supporting Modules**
- `src/prompts/` - Prompt construction and system message management
- `src/env/config.ts` - Runtime configuration from environment variables
- `src/services/` - External service integrations
- `src/utils/` - Utility functions (terminal helpers, logging, etc.)

### Key Patterns

**Tool Module Structure**
Tools follow a consistent module pattern in `src/tools/modules/<name>/`:
- `index.ts` - Module factory and spec definition
- `handler.ts` - Execution logic (pure function receiving input and context)
- `presenter.tsx` (optional) - Custom Ink UI for result display

Named as `createXToolModule()` where X is the tool name.

**Tool Registry Flow**
1. Registry initialized with spec source (proxy JSON or built-ins)
2. Tool modules registered via `toolRegistry.register(createXToolModule(...))`
3. Patches applied via `toolRegistry.addPatch()`
4. Specs accessed via `toolRegistry.listSpecs()` and handlers via `toolRegistry.getHandlers()`

**Chat Loop**
1. User input → ChatEngine.runTurn()
2. Engine streams LLM response via AnthropicStreamClient
3. On tool_use blocks, executor calls registered tool handlers
4. Tool results added to conversation history
5. Loop continues until stop_reason != "tool_use"

**Execution Context**
Tools receive:
- `cwd` - Current working directory
- `signal` - AbortSignal for cancellation
- `agentDepth` - Nested agent call depth (for sub-agents)
- `allowTools`/`denyTools` - Tool allow/deny lists

**Background Tasks**
- `TaskManager` - Manages background Bash shells (run via `bash` tool with `run_in_background: true`)
- `TaskOutput` tool - Retrieves output from background tasks
- `KillShell` tool - Terminates background shells

**User Input Prompts**
- `AskUserQuestion` tool - Presents multiple-choice questions in terminal
- `UserInputManager` - Manages active prompts and collects responses

### Configuration

Runtime config from environment variables:
- `ANTHROPIC_API_KEY2`, `ANTHROPIC_BASE_URL2`, `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT_MS`
- `FORMAX_WEBFETCH_MODEL`, `FORMAX_WEBFETCH_MAX_TOKENS`, `FORMAX_WEBFETCH_MAX_INPUT_CHARS`
- `FORMAX_PATCH_TASK_TOOL` - Enable Task tool sub-agent patching (default: true)
- `CONSOLE_LOGGER_PORT`, `ENABLE_CONSOLE_LOGGER` - Debug logging server

Path overrides:
- `FORMAX_TOOLS_JSON_PATH` - Tool spec JSON (default: `proxy/tools.json`)
- `FORMAX_LOGS_DIR` - Traffic logs directory (default: `proxy/logs`)
- `FORMAX_SUBAGENTS_DIR` - Project sub-agent definitions directory (default: `.claude/agents`)

### Testing

- Colocate tests with source as `*.test.ts` or `*.test.tsx`
- Use Vitest globals (`describe`, `it`, `expect`, `vi`)
- Ink UI tests use `ink-testing-library`
- Property-based tests use `fast-check` where applicable
- Tool handlers tested with mocked dependencies and context fixtures

### Coding Style

- TypeScript ESM (`"type": "module"`)
- 2-space indentation, single quotes, no semicolons (match existing code)
- `PascalCase` for components and classes
- `camelCase` for functions and hooks
- Tool modules: `createXToolModule`, files: `{index,handler,presenter}.ts(x)`

## Pitfalls & Gotchas (Keep Updated)
When you hit a non-obvious pitfall (tooling quirks, repo conventions, environment traps), record it here **and** in `AGENTS.md` so future agents can avoid re-discovering it.

- **Repomix + `.gitignore`**: Repomix respects `.gitignore` by default. If you export with repomix and files under `proxy/` (e.g. `proxy/tools.json`) go missing, use `--no-gitignore` (and keep using `--include`/`--ignore` per `.cursor/commands/repomix.md`).
- **Repomix default ignore patterns**: Repomix may exclude lockfiles (e.g. `bun.lock`) unless you add `--no-default-patterns`. Only enable this when you explicitly need lockfiles in the export.

## Codex local project path
- /Users/david/Documents/github/codex
