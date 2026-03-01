# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, Test, and Development Commands

- `bun install` - Install dependencies
- `bun run dev` - Run the CLI REPL interface
- `bun run toole` - Run tool examples entrypoint
- `bun run loade` - Run loading examples entrypoint
- `bun run perf:transcript` - Run transcript performance playground (no network calls)
- `bun run build` - Bundle CLI to `dist/cli.js` (requires Bun)
- `bun run type-check` - Run TypeScript type checks (no emit) plus core + UI + features boundary checks
- `bun run core:boundaries` - Run core module boundary checks
- `bun run ui:boundaries` - Run UI boundary checks
- `bun run features:boundaries` - Run feature module boundary checks
- `bun run build:web-ui` - Build web UI assets (used by `prepack`)
- `bun run build:web-ui:fast` - Build web UI assets, skip install step
- `bun run test` - Run all tests (Vitest)
- `bun run test:watch` - Run tests in watch mode
- `bun run test -- <path>` - Run a specific test file (e.g., `bun run test -- src/tools/registry.test.ts`)
- `bun run test:watch -- -t "<test-name>"` - Run tests matching a pattern
- `bun run test:changed` - Run only tests affected by uncommitted changes
- `bun run test:coverage` - Run tests with coverage report
- `bun run test:coverage:watch` - Run tests in watch mode with coverage
- `bun run test:coverage:gate` - Run tests with coverage and check thresholds
- `bun run test:surface-smoke` - Run surface/TTY smoke tests (`surfaceSmoke.test.tsx`)
- `bun run test:surface-screen-model` - Run terminal screen-model smoke (catches real TTY regressions)
- `bun run test:surface-all` - Run both surface smoke suites (required for compact/expanded UI changes)
- `bun run test:repl-semantic-gate` - REPL semantic pre-review gate (run before committing `src/features/repl/**` changes)
- `bun run check:repl-single-writer` - Static check: enforce single-writer invariant in REPL state
- `bun run check:semantic-streaming-perf` - Check semantic streaming performance constraints
- `bun run check:partial-stage` - Check for partial staging issues before commit
- `bun run tools:coverage` - Check tool implementation coverage vs reference specs
- `bun run tools:parity` - Compare tool specs and schemas with reference file (default: `src/tools/specs/reference/tools-copy.json`)

## High-Level Architecture

Formax is a terminal-based AI chat interface built with React + Ink, featuring a sophisticated tool execution system and streaming Anthropic client.

### Layered Architecture

The codebase follows a layered architecture with strict dependency boundaries (enforced by `bun run core:boundaries` and `bun run ui:boundaries`):

1. **Core Layer** (`src/core/`) - Business logic and configuration, no dependencies on outer layers
2. **Adapters Layer** (`src/adapters/`) - I/O implementations (fs, permissions, audit) that implement core interfaces
3. **Application Layer** (`src/legacy/`, `src/cli/`, `src/features/`) - CLI wiring, command dispatch, feature modules
4. **UI Layer** (`src/ui/`, `src/screens/`, `src/components/`) - Ink-based terminal UI
5. **Infrastructure** (`src/tools/`, `src/streaming/`, `src/subagents/`) - Cross-cutting concerns

**Key invariant**: `src/core/` must NOT import from `src/adapters/`, `src/ui/`, `src/cli/`, or `src/screens/`. This prevents circular dependencies and keeps core testable.

### Core Components

**Entry Points**
- `src/entrypoints/cli.tsx` - Main CLI entry, parses args and dispatches to commands or REPL
- `src/entrypoints/app-server-bridge.ts` - Dev bridge entrypoint (WebSocket → stdio loop)
- `src/entrypoints/app-server-web-reference.ts` - Dev entrypoint for bridge + React web UI
- `src/entrypoints/tool-examples.tsx` - Tool testing/demo entry point
- `src/entrypoints/loading-examples.tsx` - Loading examples entry point
- `src/entrypoints/perf-transcript.tsx` - Transcript performance playground

**CLI Layer**
- `src/cli/args.ts` - CLI argument parsing
- `src/cli/main.ts` - Command dispatch (handles `formax doctor`, `formax auth`, etc.)
- `src/legacy/runLegacyCli.tsx` - Legacy REPL initialization flow

**App Server** (`src/app-server/`)
JSON-RPC 2.0 server over stdio used by GUI/IDE clients (`formax app-server`). Also exposes a WebSocket dev bridge (`formax serve`, `formax web`) for the web reference UI.
- `src/app-server/server.ts` - JSON-RPC router
- `src/app-server/protocol.ts`, `src/app-server/protocol/input.ts` - Protocol parsing + param validation
- `src/app-server/jsonrpc.ts` - Message classification and encoding
- `src/app-server/threadStore.ts` - Thread/session mapping
- `src/app-server/turnRunner.ts` - Turn execution and streaming forwarding
- `src/app-server/devBridge.ts` - WebSocket fan-in/fan-out to app-server loop
- `src/app-server/transport/stdio.ts` - Stdio JSONL transport
- `src/network/runtime.ts` - Shared host/port/URL/security helpers for web + bridge
- `src/serve/localServer.ts` - `formax serve` WebSocket bridge launcher
- `src/web/localUi.ts` - `formax web` bridge + static host launcher
- `apps/web-reference-react/` - Reference React web client (isolated app)

**Core Layer** (productized configuration, auth, policy)
- `src/config/settings/` - Multi-source config merging (default → global → project → env → flags)
- `src/core/auth/` - API key storage and retrieval (auth.json)
- `src/core/setup/` - First-run setup wizard state machine
- `src/core/diagnostics/` - `formax doctor` health checks
- `src/core/policy/` - Permission rule matching engine (fs.read/write/bash.exec/net.fetch)
- `src/core/app/` - Application factory and event bus

**Adapters Layer** (I/O implementations)
- `src/adapters/fs/` - File system operations (config paths, file store, project/workspace roots)
- `src/adapters/permissions/` - Permission policy storage and matching
- `src/adapters/audit/` - Audit logging for tool execution
- `src/adapters/setup/` - Setup wizard I/O (connection tests, file writes)
- `src/adapters/diagnostics/` - Diagnostics check implementations

**Screens & UI**
- `src/screens/REPL.tsx` - Main chat REPL interface with command input, streaming output, and tool execution visualization
- `src/screens/ToolExamplesScreen.tsx` - Interactive tool testing UI
- `src/screens/perf/TranscriptPerfScreen.tsx` - Transcript perf screen
- `src/ui/SetupWizard.tsx` - First-run setup wizard UI
- `src/ui/agents/` - Agent management UI components
- `src/ui/permissions/` - Permission management UI components
- `src/ui/config/` - Config overlay UI (WIP)
- `src/components/` - Reusable Ink components (forms, inputs, status displays)

**Feature Modules**
- `src/features/repl/` - REPL-specific state and logic
- `src/features/commands/` - CLI command implementations

**Chat Engine**
- `src/chat/engine.ts` - Orchestrates conversation turns, managing the message loop between user and LLM with tool execution
- `src/streaming/anthropic/StreamClient.ts` - Streaming client for Anthropic API with SSE parsing
- `src/streaming/anthropic/sseParser.ts` - Server-sent event parser for streaming responses

**Tool System**
- `src/tools/registry.ts` - Central registry for tool specifications and handlers
- `src/tools/executor/` - Tool execution engine with context management (cwd, signals, tool allow/deny lists)
- `src/tools/modules/` - Individual tool implementations (read, write, bash, grep, glob, webSearch, etc.)
- `src/tools/specs/reference/` - Reference tool spec snapshots (used for parity/coverage only)
- `src/tools/patches/` - Patches to modify tool specs at runtime (e.g., sub-agent integration)
- `src/tools/runtime/` - Runtime managers for background tasks and user input prompts
- `src/components/tool/` - Output formatting/presentation for tool results
- `src/tools/catalog/` - Tool catalog utilities
- `src/tools/README.md` - Tool system architecture and patterns documentation
- `src/tools/STATUS.md` - Tool system development status and roadmap
- `src/tools/SPEC_HANDLER_MISMATCHES.md` - Tracking spec/handler mismatches

**Sub-Agents**
- `src/subagents/registry.ts` - Loads and manages sub-agent definitions from `.formax/agents/*.md` and `~/.formax/agents/*.md` (also supports `.claude/agents` for compatibility)
- `src/subagents/runner.ts` - Executes sub-agents with isolated contexts and tool allowlists

**Supporting Modules**
- `src/prompts/` - Prompt construction and system message management
- `src/config/config.ts` - Runtime configuration loader and env/file merge entry
- `src/services/` - External service integrations
- `src/shared/utils/` - Shared utility functions (terminal helpers, logging, formatting, paths, etc.)

### Key Patterns

**Tool Module Structure**
Tools follow a consistent module pattern in `src/tools/modules/<name>/`:
- `index.ts` - Module factory and spec definition
- `handler.ts` - Execution logic (pure function receiving input and context)
- `presenter.tsx` (optional) - Custom Ink UI for result display

Named as `createXToolModule()` where X is the tool name.

**Tool Transcript UI Blocks (C-lite)**
Some tools render via Tool UI Blocks instead of bespoke presenters. When adjusting common transcript formatting (⏺ spacing/indent, sublines, etc.), start at:
- `src/components/tool/ToolUiBlocks.tsx` - block renderer
- `src/shared/toolPresenterContracts.ts` - `createToolBlocksPresenter` helper

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

Formax uses a layered configuration system (merges in order of precedence):
1. Default config (built-in)
2. Global config (`~/.formax/config.json`)
3. Project config (`.formax/config.json`)
4. Environment variables
5. CLI flags

**Config files** (`~/.formax/config.json` and `.formax/config.json`):
```json
{
  "llm": {
    "provider": "anthropic",
    "baseUrl": "https://api.anthropic.com",
    "model": "claude-sonnet-4-5-20250929",
    "timeoutMs": 600000,
    "authRef": "default"  // References auth.json entry
  },
  "context": {
    "effectiveContextWindowPercent": 90,
    "autoCompactTokenLimitPercent": 95,
    "baselineTokens": 3000
  }
}
```

**Auth file** (`~/.formax/auth.json`):
```json
{
  "profiles": {
    "default": {
      "apiKey": "sk-ant-..."
    }
  }
}
```

**Environment variables** (override config files):
- `FORMAX_API_KEY`, `FORMAX_BASE_URL`, `FORMAX_TIMEOUT_MS`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `FORMAX_WEBFETCH_MODEL`, `FORMAX_WEBFETCH_MAX_TOKENS`, `FORMAX_WEBFETCH_MAX_INPUT_CHARS`

**Path overrides**:
- `FORMAX_CONFIG_DIR` - Global config directory (default: `~/.formax/`)
- `FORMAX_LOGS_DIR` - Traffic logs directory (default: `proxy/logs`)
- `FORMAX_SUBAGENTS_DIR` - Project sub-agent definitions directory (default: `.formax/agents`)
- `FORMAX_PLAN_DIR` - Plan mode directory (default: `.formax/plans/`)

Full list and classification (public/internal/deprecated):
- `docs/environment-variables.md`

### Testing

- Colocate tests with source as `*.test.ts` or `*.test.tsx`
- Use Vitest globals (`describe`, `it`, `expect`, `vi`)
- Ink UI tests use `ink-testing-library`
- Property-based tests use `fast-check` where applicable
- Tool handlers tested with mocked dependencies and context fixtures
- **Coverage mindset**: Prioritize edge cases and regressions for user-visible or stability-critical paths (tools, permissions, hooks, REPL input, UI flows). Avoid happy-path-only tests.
- **REPL semantic gate (mandatory)**: For any change to `src/features/repl/**` semantic flow, run `bun run test:repl-semantic-gate` before committing.
- **Surface tests (mandatory for UI changes)**: For compact/expanded toggle or Static-path changes, run `bun run test:surface-all` in addition to regular Vitest.

### Refactor Guardrails (Important)

When refactoring code:
- **Refactor ≠ rewrite**: Refactors must preserve existing functionality and user-visible behavior. Do not add/remove features as a side-effect.
- **Tests are not the spec**: Before refactoring, first check whether missing/weak tests can be added to lock current behavior; use those tests to validate the refactor.
- **UI parity**: UI refactors must keep layout/spacing/keys/interaction the same unless the user explicitly requests a UI change. Do not "improve" UI by default.
- **When uncertain**: If behavior/UI expectations are unclear, ask the user before changing it.
- **Root-cause first (mandatory)**: Do not default to patch/stopgap fixes for systemic bugs (state ownership, ordering, lifecycle, data flow). Fix the canonical root cause first.
- **Stopgap policy (strict)**: If a temporary mitigation is unavoidable, mark it explicitly as temporary in code comments and commit notes, define removal conditions, and create a follow-up task in the same iteration.

**UI refactor workflow (mandatory)**:
1. Before refactor: Write/extend `ink-testing-library` tests that lock the current UI text + key paths (Enter/Esc/Tab/↑↓/←→/Backspace)
2. During refactor: Do not change copy/spacing/colors unless explicitly requested; treat "simplifying UI" as a behavior change
3. After refactor: Run the targeted UI test file(s) + do a quick manual spot-check in `bun run dev` for the overlay(s) you touched
4. **No "test-only" refactors**: A passing test suite is not sufficient if manual UI behavior regresses

### Commit Guidelines

When the user asks you to create a commit:
- Assume the user already ran `git add`
- Run `git status --short` and `git diff --cached` (or `git diff --cached --stat`) to understand changes
- Generate a Conventional Commit message: `type(scope): summary` (≤72 chars, imperative mood)
- Run `git commit -m "<message>"`

Common types: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
Example: `refactor(tools): extract handler execution into separate module`

### Coding Style

- TypeScript ESM (`"type": "module"`)
- 2-space indentation, single quotes, no semicolons (match existing code)
- `PascalCase` for components and classes
- `camelCase` for functions and hooks
- Tool modules: `createXToolModule`, files: `{index,handler,presenter}.ts(x)`

### Mandatory Agent Behavior Rules

- **Clarification first (mandatory)**: In any task, if user intent is ambiguous (UI, behavior, scope, risk, tradeoff, or acceptance criteria), ask the user BEFORE making directional choices. Do not infer beyond explicit requirements.
- **Use question tool**: When clarification is needed, use `AskUserQuestion` (or ask directly in chat if the tool is unavailable) instead of guessing.

## Pitfalls & Gotchas (Keep Updated)
When you hit a non-obvious pitfall (tooling quirks, repo conventions, environment traps), record it here **and** in `AGENTS.md` so future agents can avoid re-discovering it.

- **Core module boundaries**: `src/core/` MUST NOT import from `src/adapters/`, `src/ui/`, `src/cli/`, or `src/screens/`. This is enforced by `bun run core:boundaries`. If you hit this error, refactor to move the dependency into an adapter or use dependency injection.
- **Repomix + `.gitignore`**: Repomix respects `.gitignore` by default. If you export with repomix and files under `src/tools/specs/reference/` (e.g. `src/tools/specs/reference/tools-copy.json`) go missing, use `--no-gitignore` (and keep using `--include`/`--ignore` per `.cursor/commands/repomix.md`).
- **Repomix default ignore patterns**: Repomix may exclude lockfiles (e.g. `bun.lock`) unless you add `--no-default-patterns`. Only enable this when you explicitly need lockfiles in the export.
- **Compact + Ctrl+O duplicate rows**: duplicated `HeaderBanner`/compact rows are usually surface ownership/race issues in Ink `Static`, not transcript-slice logic bugs. Do not move header/messages out of `Static` as a workaround.
- **Static parity checks required**: for compact/expanded toggles, run forced-Static + terminal-model smoke (`surfaceSmoke`, `test:surface-screen-model`) in addition to regular Vitest paths.
- **Prefer reset over clear-only on Static transitions**: for return/toggle paths touching `Static`, use clear+remount transaction semantics; clear-only flows can leave stale appended rows.
- **Surface reset workflow skill required on clear/reset changes**: for `/resume`, `/clear`, `onClearTerminal`, `transcriptSeq`, or `Static` remount paths, apply `formax-surface-reset-workflow` before implementation, and keep `/resume`/`/clear` on shared `replaceTranscript` transaction path.
- **Resume selection must use shared surface reset transaction**: `/resume` Enter path should go through `resetTranscriptSurface` queue; avoid ad-hoc clear/remount sequencing and avoid duplicate terminal clear paths (`replInstance.clear` + ANSI).
- **Anthropic `/v1/messages` fake-overload triage**: separate main turns from auto-title (`tools=0` + `thinking=false`) before A/B, and debug `thinking.signature` propagation separately from header profile routing. Details: `docs/pitfalls/anthropic-fake-overload-and-header-routing.md`.

## Module Documentation

Many modules have detailed README files with architecture documentation:
- `src/core/README.md` - Config, auth, setup, diagnostics, policy architecture
- `src/tools/README.md` - Tool system architecture and patterns
- `src/tools/STATUS.md` - Tool system development status and roadmap
- `src/subagents/README.md` - Sub-agent system architecture
- `src/streaming/README.md` - Streaming client architecture

When working in these modules, read their READMEs first to understand patterns and invariants.

## Scripts & Validation Tools

The `scripts/` directory contains validation and utility scripts:
- `check-core-boundaries.mjs` - Enforce core layer dependency rules
- `check-ui-boundaries.mjs` - Enforce UI layer dependency rules
- `check-coverage-thresholds.mjs` - Validate test coverage thresholds
- `check-no-ansi.mjs` - Check for unwanted ANSI escape sequences
- `check-no-claude.mjs` - Check for "claude" string references
- `tools-coverage.ts` - Compare implemented tools vs reference specs
- `tools-parity.ts` - Compare tool schemas and fields vs reference
- `extract-system-reminder-map.mjs` - Extract system reminder mappings

## Documentation Hygiene

- Keep module READMEs in sync when changing boundaries, control-flow, invariants, or extension points
- Prefer linking to source files over duplicating code; keep diagrams high-level to reduce churn
- `CODEMAP.md` is the "where to change what" index; update it when key entrypoints or ownership move

## Security Tips

- Do not commit secrets. Local config uses `.env` (e.g., `FORMAX_API_KEY`); keep `.env` and traffic logs out of git
- When sharing context with other AIs/tools, double-check exports for accidental secrets (API keys, tokens, cookies) before pasting
- Auth files (`~/.formax/auth.json`) should have mode 0o600 (enforced by the codebase)
