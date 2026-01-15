# Formax CODEMAP

This file is a “where to change what” index for quickly navigating the codebase.

## Entry Points
- CLI entrypoint (main): `src/entrypoints/cli.tsx`
- Tool examples playground: `src/entrypoints/tool-examples.tsx`
- Loading examples: `src/entrypoints/loading-examples.tsx`

## REPL UI (Ink)
- Main screen: `src/screens/REPL.tsx`
- Input UI: `src/components/chat/InputBar.tsx`
- Header: `src/components/chat/HeaderBanner.tsx`
- Mode indicator: `src/components/chat/ModeIndicator.tsx`
- Pulsing dot: `src/components/ui/PulsingDot.tsx`

## Chat Loop / Streaming
- Chat loop + tool loop: `src/chat/engine.ts`
  - TodoWrite “stale todo” reminder injection (Claude Code style): `src/chat/engine.ts` (appends `<system-reminder>` to last `tool_result` content)
- Anthropic streaming client: `src/streaming/anthropic/StreamClient.ts`
- SSE parser: `src/streaming/anthropic/sseParser.ts`
- Stream events/types: `src/streaming/types.ts`

## Context Management (UI transcript vs prompt history)
- Prompt-history owner (historyRef), pre/post pruning, `/compact`, auto-compact: `src/features/repl/useReplController.ts`
- Budget + stats: `src/chat/context/budget.ts`
- Token estimate fallback: `src/chat/context/estimate.ts`
- Model context window table (current provider-agnostic hints): `src/chat/context/modelWindow.ts`
- Hard pruning rules (tool pair invariants + truncation): `src/chat/context/prune.ts`
- Compaction tail selection (keep last N turns): `src/chat/context/compact.ts`
- Tool-loop pruning (pre-`streamOnce`): `src/chat/engine.ts` (`promptBudget`)
- Config knobs (defaults + env): `src/core/config/schema.ts`, `src/core/config/resolve.ts`, `src/env/config.ts`

## Prompts
- System prompt builder (profiles, env snapshot, constraints): `src/prompts/system.ts`
- Prompt composition helpers: `src/prompts/index.ts`, `src/prompts/user.ts`, `src/prompts/types.ts`
- TodoWrite reminder text + formatting helpers: `src/prompts/reminders/todos.ts`
- Prompt porting status/TODOs: `src/prompts/STATUS.md`, `system-prompts/PORTING-STATUS.md`

## Tools (Registry → Execution → Presentation)

### Tool registry + loader
- Tool definitions (ToolDefinition): `src/tools/types.ts`
- Tool module registry: `src/tools/registry.ts`
- Tool loader (collect modules into runtime tools list): `src/tools/loader.ts`

### Tool execution pipeline
- Executor entry (enforces allow/deny lists, routes to handlers): `src/tools/executor/index.ts`
- Executor handlers (e.g. Task): `src/tools/executor/handlers/*`
- Runtime task manager (background tasks, cancel): `src/tools/runtime/taskManager.ts`
- Runtime user input manager (approval prompts / AskUserQuestion answers): `src/tools/runtime/userInputManager.ts`

### Tool UI / presenters
- Default tool renderer: `src/components/tool/ToolMessage.tsx`
- Presenter interface: `src/tools/presenters/types.ts`
- Shared approval prompt (Edit/Write/NotebookEdit): `src/tools/presenters/editApprovalPrompt.tsx`
- Fallback presenter: `src/tools/presenters/fallback.tsx`

### Tool specs (“model-facing contract”)
- Each tool module owns its spec under `src/tools/modules/<tool>/spec.ts`.
- A convenient reference list/spec mapping exists in: `src/tools/specs/toolsCopy.ts`
- Spec/handler drift tracking: `src/tools/SPEC_HANDLER_MISMATCHES.md`

## Key Tool Modules (where to implement behavior)
- Read: `src/tools/modules/read/*`
- Write (approval + preview UI): `src/tools/modules/write/*`
- Edit (diff UI + approval): `src/tools/modules/edit/*`
- Glob: `src/tools/modules/glob/*`
- Grep: `src/tools/modules/grep/*`
- Bash (policy, filepath extraction, approval workflow): `src/tools/modules/bash/*`
- Task (sub-agents + nested prompts UI): `src/tools/modules/task/*`
- TaskOutput (background task UI): `src/tools/modules/taskOutput/*`
- Search (high-level search): `src/tools/modules/search/*`

## Plan Mode
- REPL mode type: `src/features/repl/mode.ts`
- Plan session manager (plan file path, lifecycle): `src/features/repl/planSession.ts`
- Plan path helpers: `src/utils/planMode.ts`
- Plan mode injected blocks: `src/features/repl/useReplController.ts`
- Plan tools:
  - EnterPlanMode: `src/tools/modules/enterPlanMode/*`
  - ExitPlanMode: `src/tools/modules/exitPlanMode/*`

## Sub-agents (Task tool)
- Built-in subagents registry (names, prompts, tool allowlist): `src/subagents/builtins.ts`
- Subagent registry: `src/subagents/registry.ts`
- Runner (spawning + tool allowlist enforcement): `src/subagents/runner.ts`
- Validator: `src/subagents/validator.ts`
- Approval/“read-only” strategy notes (Claude Code vs Formax vs Kode): `docs/SUBAGENT-APPROVAL-STRATEGY.md`

## Slash Commands
- Slash command registry + dispatch: `src/features/commands/registry.ts`
- CLI wires suggestions/registry into REPL: `src/features/repl/useReplController.ts`, `src/screens/REPL.tsx`

## Config / Auth / Paths
- Runtime config loader: `src/env/config.ts`
- Config directory default: `src/utils/env.ts` (`FORMAX_CONFIG_DIR`)
- Config paths + migration/legacy behavior: `src/adapters/fs/configPaths.ts`
- Reading config files (auth.json, etc): `src/adapters/fs/configFiles.ts`

## Subsystem READMEs (Deep Dives)
- Core (config/auth/setup/policy): `src/core/README.md`
- Tools (registry/executor/presenters/runtime): `src/tools/README.md`
- Streaming (SSE parsing + tool execution): `src/streaming/README.md`
- Sub-agents (registry/runner/allowlist): `src/subagents/README.md`

## If You’re Adding a Feature, Start Here
- UI behavior: `src/screens/REPL.tsx` + `src/features/repl/useReplController.ts`
- New tool: add `src/tools/modules/<name>/{spec.ts,handler.ts,presenter.tsx,index.ts}`, then register in `src/tools/registry.ts`
- New slash command: add to `src/features/commands/registry.ts` (and optionally implement LLM tool exposure later)
- Sub-agent capability/prompt: update `src/subagents/builtins.ts` and related prompt sources under `src/subagents/prompts/`
