# Formax CODEMAP

This file is a “where to change what” index for quickly navigating the codebase.

## Entry Points
- CLI entrypoint (main): `src/entrypoints/cli.tsx`
- CLI arg parsing + dispatch: `src/runtime/cli/args.ts`, `src/runtime/cli/main.ts`
- Legacy REPL bootstrap orchestration: `src/runtime/bootstrap/runLegacyCli.tsx`
  - Runtime assembly slices: `src/runtime/bootstrap/*`
- App-server entrypoint (JSON-RPC over stdio): `src/app-server/index.ts`
- In-process SDK unified API entry (`query()` + `unstable_v2_*`): `src/sdk/api.ts` (public re-export: `src/sdk/index.ts`)
- SDK query facade (`query()`): `src/sdk/query.ts` (runtime implementation: `src/sdk/query/runner.ts`)
- SDK session-query facade (`listSessions()` + `getSessionMessages()`): `src/sdk/sessions.ts` (backed by `src/features/repl/sessionSave/reader.ts`)
- SDK v2 session facade (`unstable_v2_*`): `src/sdk/v2.ts` (runtime implementation: `src/sdk/session/core.ts`)
- SDK local usage guide: `src/sdk/README.md`
- Serve runtime launcher (`formax serve`, WebSocket bridge): `src/runtime/serve/localServer.ts`
- Web UI runtime launcher (`formax web`, bridge + static host): `src/runtime/web/localUi.ts`
- App-server dev bridge entrypoint (WebSocket -> stdio loop): `src/entrypoints/app-server-bridge.ts`
- App-server web reference entrypoint (bridge + React UI dev server): `src/entrypoints/app-server-web-reference.ts`
- Desktop Electron shell (orchestrator + main/preload): `apps/desktop-electron/{scripts/run.mjs,src/main.ts,src/preload.ts}`
- Tool examples playground: `src/entrypoints/tool-examples.tsx`
- Loading examples: `src/entrypoints/loading-examples.tsx`
- Transcript perf playground: `src/entrypoints/perf-transcript.tsx`

## App Server (GUI Bridge)
- JSON-RPC server/router: `src/app-server/server.ts`
- Protocol parsing + param validation: `src/app-server/protocol.ts`, `src/app-server/protocol/input.ts`
- JSON-RPC message classification/encoding: `src/app-server/jsonrpc.ts`
- Thread/session mapping (sessionSave-backed): `src/app-server/threadStore.ts`
- Turn execution + streaming forwarding: `src/app-server/turnRunner.ts`
- Input lifecycle helpers: `src/app-server/turn/inputId.ts`, `src/app-server/turn/inputStore.ts`
- Stdio JSONL transport: `src/app-server/transport/stdio.ts`
- Dev bridge (WebSocket fan-in/fan-out to app-server loop): `src/app-server/devBridge.ts`
- Serve command parsing/help text: `src/runtime/cli/serveCommand.ts`
- Web command parsing/help text: `src/runtime/cli/webCommand.ts`
- Shared web/bridge network + security helpers (host/port/url/origin/token): `src/runtime/network/runtime.ts`
- Web reference React client (isolated app): `apps/web-reference-react/*` (see "Web Reference React Client")
- Session event recovery for stale inputs: `src/app-server/store/sessionEventReader.ts`
- Shared persisted tool-event reconstruction (used by app-server + REPL resume): `src/features/repl/sessionSave/persistedToolEvents.ts`
- Primary tests: `src/app-server/*.test.ts`, `src/app-server/store/*.test.ts`, `src/app-server/turn/*.test.ts`

## REPL UI (Ink)
- Main screen: `src/screens/REPL.tsx`
- Controller/state (send/streaming/overlays): `src/features/repl/useReplController.ts`, `src/features/repl/controller/{send,streaming,canonical,session,ui,shared}/*`
- Canonical event projection helper (hook-level orchestration): `src/features/repl/controller/canonical/canonicalEventOrchestration.ts`
- Session transition helpers (abort/new session): `src/features/repl/controller/session/sessionTransitions.ts`
- Session save/replay core (writer/reader + app tool-event payload mapping): `src/features/repl/sessionSave/{writer,reader,appToolEventPayload}.ts`
- REPL hotkeys / input routing (Ctrl+O Expanded Transcript, Ctrl+E fold history, etc.): `src/screens/repl/hotkeys.ts`
- Prompt mode gating (overlays/prompt blocks disable hotkeys): `src/screens/repl/promptMode.ts`
- Transcript renderers (Primary vs Expanded): `src/screens/repl/transcript.tsx`
- Expanded Transcript tests: `src/screens/repl/expandedTranscript.test.tsx`
- Input UI: `src/components/chat/InputBar.tsx`
- Header: `src/components/chat/HeaderBanner.tsx`
- Mode indicator: `src/components/chat/ModeIndicator.tsx`
- Pulsing dot: `src/components/ui/PulsingDot.tsx`

## Setup / Dialogs (Overlays)
- First-run setup wizard (UI): `src/tui/SetupWizard.tsx`
- Setup session + state machine: `src/core/setup/session.ts`
- Setup persistence + connection checks: `src/adapters/setup/writeSetupFiles.ts`, `src/adapters/setup/connectionTest.ts`
- Overlay manager (open/close dialogs): `src/features/repl/overlays/OverlayManager.ts`
- Agents dialog (overlay UI): `src/tui/agents/AgentsDialog.tsx`
- Permissions dialog (overlay UI): `src/tui/permissions/PermissionsDialog.tsx`
- Config dialog (overlay UI, WIP): `src/tui/config/ConfigDialog.tsx`

## Chat Loop / Streaming
- Chat loop + tool loop: `src/chat/engine.ts`
  - TodoWrite reminders (prompt injection): `src/prompts/reminders/todos.ts` + wiring in `src/chat/engine.ts`
  - Runtime flags used by loop debug/limits: `src/config/runtimeFlags.ts`
- Streaming provider factory (provider -> client): `src/streaming/index.ts`
- Anthropic streaming client: `src/streaming/anthropic/StreamClient.ts`
- OpenAI-compatible streaming client: `src/streaming/openai/StreamClient.ts`
- SSE parser: `src/streaming/anthropic/sseParser.ts`
- Stream events/types: `src/streaming/types.ts`

## Context Management (UI transcript vs prompt history)
- Prompt-history owner (historyRef), pre/post pruning, `/compact`, auto-compact:
  - Pre-main routing coordinator (clear/compact/slash): `src/features/repl/controller/send/sendPreMainRouting.ts`
  - Pre-main command handlers (`/compact`, consumed slash, local async): `src/features/repl/controller/send/send.ts`
  - Main turn execution + prompt/history pipeline: `src/features/repl/controller/send/sendMainTurn.ts`
  - Main turn deps/refs context builder: `src/features/repl/controller/send/sendMainTurnContext.ts`
  - Auto-compact preflight/apply helper: `src/features/repl/controller/send/sendAutoCompact.ts`
  - Shared send context types/builders: `src/features/repl/controller/send/sendTypes.ts`
  - Wiring entry: `src/features/repl/useReplController.ts`
- Budget + stats: `src/chat/context/budget.ts`
- Token estimate fallback: `src/chat/context/estimate.ts`
- Model context window table (current provider-agnostic hints): `src/chat/context/modelWindow.ts`
- Hard pruning rules (tool pair invariants + truncation): `src/chat/context/prune.ts`
- Compaction tail selection (keep last N turns): `src/chat/context/compact.ts`
- Tool-loop pruning (pre-`streamOnce`): `src/chat/engine.ts` (`promptBudget`)
- Config knobs (defaults + env): `src/config/settings/schema.ts`, `src/config/settings/resolve.ts`, `src/config/config.ts`

## Semantics Parity (TUI + App-Server + Web)
- Semantics governance contract (SoT): `docs/contracts/semantics-contract.md`
- Shared semantics source of truth:
  - Canonical event envelope/types: `src/features/semantics/core/canonicalEvents.ts`
  - Transcript projection reducer (segment model): `src/features/semantics/projection/transcriptProjection.ts`
  - Mode semantics: `src/features/semantics/core/modeSemantics.ts`
  - Mode transition semantics (normalize/transition helpers): `src/features/semantics/core/replModeTransition.ts`
  - Slash semantics: `src/features/semantics/core/slashSemantics.ts`
  - Turn input builder: `src/features/semantics/adapters/turnInputBuilder.ts`
  - Input state machine: `src/features/semantics/runtime/inputStateMachine.ts`
  - Thread runtime state reducer (shared by app-server/web): `src/features/semantics/runtime/threadRuntimeState.ts`
- Contract tests:
  - `src/features/semantics/__tests__/*`
  - `src/features/semantics/*.test.ts`
- Web-side parity adapters:
  - Tool event normalizer: `apps/web-reference-react/src/toolEventNormalizer.ts`
  - Event cursor (eventId dedupe + replaySeq-first ordering): `apps/web-reference-react/src/turnEventCursor.ts`
  - Reducer integration points: `apps/web-reference-react/src/store.ts`, `apps/web-reference-react/src/App.tsx`
  - Browser-safe tool parity adapters: `apps/web-reference-react/src/parity/tools/*`

## Web Reference React Client
- App package root (isolated deps/scripts): `apps/web-reference-react/package.json`
- Vite entry + mount: `apps/web-reference-react/src/main.tsx`
- App composition root: `apps/web-reference-react/src/App.tsx`
- RPC client transport: `apps/web-reference-react/src/rpcClient.ts`
- Runtime orchestration (initialize/notifications/replay/thread actions): `apps/web-reference-react/src/app/runtime/*`
- Core state machines/contracts/selectors: `apps/web-reference-react/src/app/core/*`
- App runtime hook boundary: `apps/web-reference-react/src/app/useAppRuntime.ts`
- UI shell/layout: `apps/web-reference-react/src/app/ui/AppShell.tsx`
- Transcript + tool rendering: `apps/web-reference-react/src/components/TranscriptPane.tsx`, `apps/web-reference-react/src/components/tool/*`
- Pending-input/approval UI: `apps/web-reference-react/src/components/InputApprovalDock.tsx`, `apps/web-reference-react/src/components/approval/*`
- Web parity adapters + reducers: `apps/web-reference-react/src/toolEventNormalizer.ts`, `apps/web-reference-react/src/turnEventCursor.ts`, `apps/web-reference-react/src/store.ts`, `apps/web-reference-react/src/parity/*`
- E2E protocol/UI specs + rpc mock: `apps/web-reference-react/e2e/*.spec.js`, `apps/web-reference-react/e2e/helpers/mockRpc.js`

## Desktop Electron Shell
- Package root (isolated desktop-shell deps/scripts): `apps/desktop-electron/package.json`
- Runtime orchestrator (dev/debug/preview process lifecycle): `apps/desktop-electron/scripts/run.mjs`
- Runtime bundle builder (copies root CLI/web artifacts into embedded runtime): `apps/desktop-electron/scripts/build-runtime.mjs`
- Embedded packaged runtime artifacts (generated): `apps/desktop-electron/runtime/{cli.mjs,web/*}`
- Main process window/security lifecycle: `apps/desktop-electron/src/main.ts`
- Preload bridge (minimal read-only runtime metadata): `apps/desktop-electron/src/preload.ts`
- Local usage guide: `apps/desktop-electron/README.md`

## Permissions / Approvals (Claude Code-style)
- Permissions store (read/merge/write settings): `src/adapters/permissions/permissionsStore.ts`
- Rule matcher (deny/ask/allow priority + ToolName(spec) matching): `src/adapters/permissions/matcher.ts`
- Permission key helpers: `src/adapters/permissions/permissionKeys.ts`
- Skill allowlist (legacy, being migrated): `src/adapters/permissions/skillAllowList.ts`
- Policy rules store + schema: `src/core/policy/store.ts`, `src/core/policy/schema.ts`
- Policy evaluation + explain output: `src/core/policy/engine.ts`
- Tool preflight hook (central enforcement before tool execution): `src/tools/executor/policyPreflight.ts`
- ToolCall → PolicyAction mapping: `src/tools/executor/policyAction.ts`
- Policy explain formatter (CLI/debug): `src/tools/executor/policyExplain.ts`
- Approval service (user prompts, remember, auditable decision): `src/tools/executor/approvalService.ts`
- Bash policy engine (risk classification, confirmation triggers): `src/tools/modules/bash/policy.ts`
- `/permissions` wiring (slash command → open overlay): `src/features/commands/registry.ts`, `src/features/commands/adapter.ts`, `src/features/repl/useReplController.ts`, `src/screens/REPL.tsx`
- `/permissions` UI: `src/tui/permissions/PermissionsDialog.tsx`

## Hooks (Phase 1: PreToolUse / PermissionRequest / PostToolUse)
- Hook config (repo-level): `.formax/settings.local.json` (see `hooks` field)
- Hook scripts (repo-level): `.formax/hooks/*`
- Store (load/parse + list active hooks): `src/hooks/store.ts`
- Matcher (which hooks apply to which event/tool/action): `src/hooks/matcher.ts`
- Runner (spawn scripts, timeout, stdout/stderr, exit code semantics): `src/hooks/runner.ts`
- Runtime (event payload builder + per-event orchestration): `src/hooks/runtime.ts`
- Wiring points (where hooks are called):
  - PreToolUse: `src/tools/executor/index.ts`
  - PermissionRequest: `src/tools/executor/policyPreflight.ts`
  - PostToolUse (+ `additionalContext` injection before next LLM turn): `src/chat/engine.ts`
- Audit/debug (observability, not UI):
  - Centralized `hook.run` audit fields: `src/hooks/audit.ts`
  - `hook.run` schema: `src/core/audit/schema.ts`
  - Debug previews (stdout tail, etc): `FORMAX_HOOKS_DEBUG=1`
- Tests:
  - Audit fields: `src/hooks/audit.test.ts`
  - Runner/runtime: `src/hooks/runner.test.ts`, `src/hooks/runtime.test.ts`
  - PermissionRequest wiring: `src/tools/executor/policyPreflight.test.ts`
  - PostToolUse wiring: `src/chat/engine.test.ts`

## Prompts
- System prompt builder (profiles, env snapshot, constraints): `src/prompts/system.ts`
- Prompt composition helpers: `src/prompts/index.ts`, `src/prompts/user.ts`, `src/prompts/types.ts`
- TodoWrite reminder text + formatting helpers: `src/prompts/reminders/todos.ts`
- Prompt porting status/TODOs: `src/prompts/STATUS.md`, `system-prompts/PORTING-STATUS.md`

## Tools (Registry → Execution → Presentation)

### Tool registry + loader
- Tool definitions (ToolDefinition): `src/tools/types.ts`
- Tool module registry: `src/tools/registry.ts`
- Built-in tool modules registration: `src/tools/modules/index.ts`

### Tool execution pipeline
- Executor entry (enforces allow/deny lists, routes to handlers): `src/tools/executor/index.ts`
- Executor handlers (e.g. Task): `src/tools/executor/handlers/*`
- Runtime task manager (background tasks, cancel): `src/tools/runtime/taskManager.ts`
- Runtime user input manager (approval prompts / AskUserQuestion answers): `src/tools/runtime/userInputManager.ts`
- Deferred tool exposure store + ToolSearch session state: `src/tools/runtime/deferredToolExposure.ts`
- Cross-entry deferred exposure resolver (REPL/app-server/SDK shared wiring): `src/tools/runtime/deferredToolExposureResolver.ts`
- ToolSearch engine core (mode parsing + regex/BM25/hybrid ranking): `src/tools/runtime/toolSearchEngine.ts`

### Tool UI / presenters
- Default tool renderer: `src/components/tool/ToolMessage.tsx`
- Tool UI Blocks renderer (C-lite): `src/components/tool/ToolUiBlocks.tsx`
- Presenter interface: `src/shared/toolPresenterContracts.ts`
- Blocks presenter helper: `createToolBlocksPresenter` in `src/shared/toolPresenterContracts.ts`
- FS read approval bridge (blocks presenter → runtime user input): `src/components/tool/FsReadApprovalToolBlock.tsx`
- Shared approval prompt (Edit/Write/NotebookEdit): `src/components/tool/editApprovalPrompt.tsx`
- Fallback presenter: `src/components/tool/FallbackToolPresenter.tsx`

### Tool specs (“model-facing contract”)
- Each tool module owns its spec under `src/tools/modules/<tool>/spec.ts`.
- Reference snapshot for parity checks: `src/tools/specs/reference/tools-copy.json`
- Spec/handler drift tracking: `src/tools/SPEC_HANDLER_MISMATCHES.md`

## Key Tool Modules (where to implement behavior)
- Read: `src/tools/modules/read/*`
- Write (approval + preview UI): `src/tools/modules/write/*`
- Edit (diff UI + approval): `src/tools/modules/edit/*`
- Glob: `src/tools/modules/glob/*`
- Grep: `src/tools/modules/grep/*`
- Bash (policy, filepath extraction, approval workflow): `src/tools/modules/bash/*`
- AskUserQuestion (interactive prompts): `src/tools/modules/askUserQuestion/*`
- KillShell (terminate running shell): `src/tools/modules/killShell/*`
- NotebookEdit: `src/tools/modules/notebookEdit/*`
- TodoWrite: `src/tools/modules/todoWrite/*`
- WebFetch: `src/tools/modules/webFetch/*`
- WebSearch: `src/tools/modules/webSearch/*`
- Skill: `src/tools/modules/skill/*`
- SlashCommand: `src/tools/modules/slashCommand/*`
- Task (sub-agents + nested prompts UI): `src/tools/modules/task/*`
- TaskOutput (background task UI): `src/tools/modules/taskOutput/*`
- Search (high-level search): `src/tools/modules/search/*`

## Plan Mode
- REPL mode type: `src/features/repl/mode.ts`
- REPL mode transition application: `src/features/repl/useReplController.ts`
- Plan session manager (plan file path, lifecycle): `src/features/repl/planSession.ts`
- Plan path helpers: `src/shared/utils/planMode.ts`
- Plan mode injected blocks: `src/features/repl/controller/send/sendMainTurn.ts` (wired by `src/features/repl/useReplController.ts`)
- App-server runtime mode change notifications: `src/app-server/turnRunner.ts` (`turn/modeChanged`)
- Plan tools:
  - EnterPlanMode: `src/tools/modules/enterPlanMode/*`
  - ExitPlanMode: `src/tools/modules/exitPlanMode/*`

## Sub-agents (Task tool)
- Built-in subagents registry (names, prompts, tool allowlist): `src/features/subagents/builtins.ts`
- Subagent registry: `src/features/subagents/registry.ts`
- Runner (spawning + tool allowlist enforcement): `src/features/subagents/runner.ts`
- Agents creation wizard (generate with model / manual): `src/features/subagents/agentsWizard.ts`
- Approval/“read-only” strategy notes (Claude Code vs Formax vs Kode): `plans/_archive/sub-agent/claude-code-subagent-analysis.md`

## Slash Commands
- Slash command registry + suggest + dispatch: `src/features/commands/registry.ts`
- Built-in command effects → command contract adapter: `src/features/commands/adapter.ts`, `src/features/commands/contracts.ts`
- Custom commands store (scan `.formax/commands/**` and global overrides): `src/features/commands/CommandStore.ts`
- Custom command rendering (markdown → injected prompt blocks): `src/features/commands/render.ts`
- CLI wires suggestions/registry into REPL: `src/features/repl/useReplController.ts`, `src/screens/REPL.tsx`

## Config / Auth / Paths
- Runtime config loader: `src/config/config.ts`
- Runtime env flag parser (single entry for `FORMAX_*` runtime toggles): `src/config/runtimeFlags.ts`
- Config paths + migration/legacy behavior: `src/adapters/fs/configPaths.ts`
- Reading config files (auth.json, etc): `src/adapters/fs/configFiles.ts`

## Subsystem READMEs (Deep Dives)
- Core (config/auth/setup/policy): `src/core/README.md`
- Tools (registry/executor/presenters/runtime): `src/tools/README.md`
- Streaming (SSE parsing + tool execution): `src/streaming/README.md`
- Sub-agents (registry/runner/allowlist): `src/features/subagents/README.md`

## Docs Governance (Contracts / Invariants)
- Docs source-of-truth index: `docs/index.md`
- Project semantics contract (TUI/app-server/Web): `docs/contracts/semantics-contract.md`
- Interactive input semantic contract (approval + ask): `docs/contracts/interactive-input-contract.md`
- Runtime environment-variable source of truth: `docs/environment-variables.md`
- App-server interaction contract: `docs/contracts/app-server-interaction-contract.md`
- App-server API reference: `docs/references/app-server-api-reference.md`
- App-server Web UI spec: `docs/frontend/app-server-ui-spec.md`
- Interactive input form inventory (informative): `docs/inventories/interactive-input-inventory.md`
- Frontend governance index: `docs/FRONTEND.md`
- App-server manual runbook: `docs/runbooks/app-server-manual-runbook.md`
- Semantic streaming perf baseline: `docs/baselines/semantic-streaming-perf.md`
- REPL single-writer audit: `docs/audits/repl-single-writer-audit.md`
- Semantics blueprint + learnings: `docs/design/semantics-architecture-blueprint.md`, `docs/learnings/*`
- Pitfalls deep-dive index: `docs/pitfalls/index.md`
- Layer contract config + baseline:
  - `scripts/layer-contract.config.json`
  - `scripts/check-layer-contracts.mjs`
  - `scripts/baselines/layer-contract-violations.json`
- Golden principles checks + baseline:
  - `scripts/check-golden-principles.mjs`
  - `scripts/baselines/golden-principles-violations.json`
- Single-writer gate: `scripts/check-repl-single-writer.mjs`

## If You’re Adding a Feature, Start Here
- UI behavior: `src/screens/REPL.tsx` + `src/features/repl/useReplController.ts`
- New tool: add `src/tools/modules/<name>/{spec.ts,handler.ts,presenter.tsx,index.ts}`, then register in `src/tools/registry.ts`
- New slash command: add to `src/features/commands/registry.ts` (and optionally implement LLM tool exposure later)
- Sub-agent capability/prompt: update `src/features/subagents/builtins.ts` and related prompt sources under `src/features/subagents/prompts/`
