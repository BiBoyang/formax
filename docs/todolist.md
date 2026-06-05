# MCP Client Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] Formax is a code agent, so this effort is MCP client/host support, not MCP server support.
- [x] Existing Formax tool semantics are centered on `ToolDefinition`, `ToolCall`, and `ToolResult`.
- [x] Tool execution must continue through the existing executor gates: abort, subagent deny, allow/deny list, handler resolution, hooks, policy preflight, and handler execution.
- [x] Existing deferred exposure runtime already provides session-scoped catalog, loaded tool state, and search/select behavior for global deferred mode.
- [x] REPL, app-server, and SDK already share prompt/tool exposure semantics and must not grow separate MCP paths.
- [x] SDK types expose `options.mcpServers` and MCP control methods; Phase 1A now supports the explicit `options.mcpServers` overlay subset while live MCP control methods remain unsupported.
- [x] WebGPT review responses converge on a hybrid architecture: dynamic MCP tool catalog plus one MCP dispatch handler, compatible with existing direct/deferred tool exposure modes.
- [x] Claude Code reference behavior keeps MCP server config trust/activation separate from MCP tool-call permissions; MCP tool remember defaults to the fully-qualified tool name, not call arguments.
- [x] Claude Code uses one generic `MCPTool` / MCP UI renderer for dynamic MCP tools, not one UI presenter per server tool.

### 0.2 Goals
- [x] Add Phase 1 MCP client support using `@modelcontextprotocol/sdk` client transports for stdio and Streamable HTTP.
- [x] Expose MCP tools as model-facing names shaped like `mcp__<server>__<tool>`.
- [x] Register MCP tools as dynamic `ToolDefinition`s at the same runtime level as existing tools; exposure follows the active Formax tool exposure mode.
- [x] Execute MCP tool calls through existing executor, hooks, policy, approval, and audit paths.
- [x] Unlock a safe SDK `options.mcpServers` subset after runtime semantics are tested.
- [x] Keep REPL, app-server, and SDK wired through shared MCP runtime/catalog helpers.
- [x] Use existing `config.json` storage for REPL MCP server config in Phase 1A; SDK remains explicit-overlay only and must not read local config files.

### 0.3 Non-goals
- [x] No Formax MCP server in Phase 1.
- [x] No hand-rolled MCP protocol or transport implementation; use `@modelcontextprotocol/sdk` `Client` plus SDK transports.
- [x] No OAuth browser flow in Phase 1A; HTTP config supports only static `headers` plus environment-variable references.
- [x] No legacy SSE execution in Phase 1A; `type: "sse"` is reserved for a later compatibility scope and rejected by the Phase 1A parser.
- [x] Claude Code handles two non-tool MCP capabilities in addition to tools: `resources/list` and `prompts/list`. It can expose prompts as slash-style commands and resources through explicit list/read tools. Formax Phase 1A only converts MCP `tools/list` entries into `mcp__<server>__<tool>` tools; MCP resources and prompts are ignored for model context/tool exposure and deferred to Phase 2 explicit UX/tools.
- [x] Claude Code declares MCP roots and answers `ListRoots` with the current working directory. Formax Phase 1A declares roots only as the current runtime `cwd` root and answers `ListRoots` with that single root; no multi-root negotiation or project-root selection UX in Phase 1A.
- [x] Claude Code has MCP elicitation handling. Formax Phase 1A does not declare MCP elicitation capability until it has a real cancel/queue/UI bridge.
- [x] MCP sampling bridge, resource templates, resource subscribe/poll, and tasks are out of Formax Phase 1A; do not describe these as Claude Code parity unless separately verified in the reference code.
- [x] No app-server/Web/Electron MCP management UI in Phase 1; Web transcript rendering gets a generic `mcp__*` tool block renderer, not a management UI.
- [x] No `/mcp` slash command in Phase 1.
- [x] No live `setMcpServers`, `reconnectMcpServer`, or `toggleMcpServer` runtime mutation in Phase 1A.
- [x] No separate MCP config file such as `.mcp.json`; persisted MCP config must use the existing Formax `config.json` system when enabled.
- [x] No SDK runtime consumption of user/project local config files; SDK MCP servers must come from explicit SDK/session overlay.
- [x] No MCP server startup from config parsing, catalog construction, status reads, deferred exposure resolution, or dry-run request construction in Phase 1A.
- [x] No user/chat/model-created MCP session overlay in Phase 1A.
- [x] No app-server protocol field, REPL command, or Web UI path that can start MCP servers in Phase 1A.
- [x] No MCP-specific broker/search tool in Phase 1; MCP tools use the normal Formax tool exposure mechanism for the active mode.

### 0.4 Review scope
- [x] MCP crosses tool runtime, prompt exposure, policy, hooks, SDK, and child-process lifecycle, so each loop needs explicit scope before edits.
- [x] Review findings must be classified before code changes; do this in the current loop notes/todo rather than a dedicated findings-log file in Phase 1A.
- [x] Current-loop review is scoped by each loop's `Loop Contract`.
- [x] Later-loop findings are logged, not chased in the current loop.
- [x] Spec ambiguity stops implementation until contracts/todo/user alignment are updated.
- [x] Stop implementation edits and run a convergence pass if two review rounds in one loop produce new P1/P2 semantic findings after targeted tests pass.

### 0.5 Decision Draft Summary
- [x] Storage/config source: persisted MCP config lives under existing Formax `config.json` as `mcp.servers`; REPL Phase 1A reads only user/global runtime config and ignores repo-local project MCP config until a project MCP trust/approval gate exists; SDK uses explicit `options.mcpServers` / session overlay only; app-server/Web/Electron do not read local MCP config in Phase 1A.
- [x] Schema/defaults/rejected fields: Phase 1A supports strict `stdio` and Streamable HTTP `type: "http"` configs, `enabled?: boolean` defaults to `true`, unknown transport fields are rejected, OAuth/session/reconnect fields are rejected, and reserved `type: "sse"` is rejected.
- [x] Startup/activation timing: config parsing, catalog construction, status reads, deferred exposure resolution, and dry-run are pure; REPL starts manager activation in the background after runtime/session setup; SDK/one-shot non-interactive runs await manager activation before the first model request when using the explicit overlay path; app-server/Web/Electron do not activate MCP in Phase 1A.
- [x] Permission model: MCP tool calls reuse existing Formax tool permission / approval / hook flow keyed by fully-qualified tool name; no `mcp.call` `PolicyAction` and no `mcp.server.start` approval action.
- [x] Capability level: MCP `tools/list` entries become dynamic `ToolDefinition`s at the same level as existing tools; one generic MCP dispatch handler executes them; no MCP broker/search tool and no MCP-specific ToolSearch semantics.
- [x] Result/IO/persistence bounds: text/JSON output follows Claude Code-derived `MAX_MCP_OUTPUT_TOKENS = 25_000` with `tokens * 4` character approximation; image/blob byte caps are Formax Phase 1A safety choices; binary payloads are file-backed under logsDir and preserved after manager/query close because transcripts contain their paths.
- [x] Explicit non-goals: no Formax MCP server, OAuth, legacy SSE runtime, resources/prompts exposure, multi-root negotiation, elicitation, sampling, app-server/Web/Electron management UI, `/mcp`, live SDK controls, or SDK local config reads in Phase 1A.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Add `docs/contracts/mcp-client-contract.md` as the MCP client source of truth.
- [x] Update `docs/contracts/tool-runtime-contract.md` with MCP dynamic tool handler and result mapping rules.
- [x] In `docs/contracts/mcp-client-contract.md`, define Phase 1A active server sources by entrypoint: REPL uses user/global runtime config `mcp.servers` and ignores repo-local project MCP config until a trust gate exists; SDK uses explicit `options.mcpServers` / session overlay only.
- [x] In `docs/contracts/mcp-client-contract.md`, define config parsing, name normalization, pure catalog mapping, status reads, and dry-run preview as side-effect-free: no spawn, connect, initialize, or list tools.
- [x] In `docs/contracts/mcp-client-contract.md`, define Claude Code-aligned activation timing: config reads are pure; interactive REPL starts enabled MCP server connection/listTools in a background manager activation after runtime/session setup and does not block first render or guarantee first-turn availability; one-shot SDK/non-interactive runs await manager activation before the first model request for the explicit overlay path.
- [x] In `docs/contracts/mcp-client-contract.md`, define that MCP tool-call approval authorizes model-requested tool invocation only; server startup is host/runtime config activation, not a model tool-call permission.
- [x] Update `docs/contracts/prompt-tool-exposure-contract.md` with MCP as dynamic tool catalog input and no automatic resources/prompts injection.
- [x] In `docs/contracts/prompt-tool-exposure-contract.md`, define that MCP tools follow the same active exposure mode as other tools: direct in legacy/direct mode, searchable/loadable in global deferred mode.
- [x] In `docs/contracts/prompt-tool-exposure-contract.md`, define that deferred discovery controls only affect global deferred mode; they must not make MCP specially unavailable when direct exposure mode is active.
- [x] Update `docs/contracts/permissions-policy-contract.md` with MCP tool-name permission semantics and the rule that there is no separate `mcp.server.start` approval action in Phase 1.
- [x] In `docs/contracts/permissions-policy-contract.md`, define that MCP tool permissions match tool names, not a new `PolicyAction`: exact `mcp__<server>__<tool>` by default, plus hand-authored server-level `mcp__<server>` and wildcard `mcp__<server>__*` rules. MCP must reuse the existing permission decision order `deny > ask > allow`; list precedence wins before match specificity.
- [x] In `docs/contracts/permissions-policy-contract.md`, define that Phase 1A MCP remember does not bind individual call arguments; remembered approval for one MCP tool applies to later calls to the same fully-qualified tool with different arguments.
- [x] In `docs/contracts/permissions-policy-contract.md`, define Phase 1A MCP `approve_remember` as existing permission/approval remember behavior for the fully-qualified MCP tool name; arguments belong in prompt/audit only.
- [x] Update `docs/contracts/hooks-contract.md` with MCP tool names and MCP policy payload fields using existing hook events.
- [x] Update `docs/contracts/config-settings-contract.md` to reserve persisted MCP config under existing `config.json` storage, with `mcp.servers` as the long-term envelope.
- [x] In `docs/contracts/config-settings-contract.md`, define that REPL Phase 1A loads `mcp.servers` from user/global `config.json` only and ignores repo-local project MCP config until a trust gate exists, while SDK Phase 1A must not read local config files.
- [x] Update `plans/sdk-contract-alignment-loop/query-alignment-matrix.md` for the Phase 1 SDK subset.
- [x] Update `CODEMAP.md` only when MCP runtime entrypoints or ownership modules are added.

### 1.2 Data model
- [x] Define `McpServerConfig` as a discriminated union aligned with Claude Code / SDK config vocabulary:
  - Shared field: `enabled?: boolean`, default `true`. Do not support a separate `disabled` field in Phase 1A.
  - `type: "stdio"` with `command`, optional `args`, `env`, `cwd`, optional `timeoutMs`, and optional `enabled`.
  - `type: "http"` for MCP Streamable HTTP with `url`, optional `headers`, optional `timeoutMs`, and optional `enabled`.
  - `type: "sse"` is reserved but rejected in Phase 1A; do not create runtime transport support for it in this plan.
- [x] Define dynamic-key boundaries explicitly: `mcp.servers` is a record keyed by normalized server id, `stdio.env` and `http.headers` are typed records, but each server config object remains strict and rejects unknown transport fields.
- [x] Define `McpServerConfig` secret handling consistently across transports; `env` and `headers` stay out of model-facing output and audit, and SDK stdio startup inherits the SDK safe default environment plus a low-sensitivity runtime env allowlist and explicit per-server overrides.
- [x] Document that `type: "http"` means MCP Streamable HTTP, not arbitrary HTTP fetch.
- [x] Define persisted config shape under `mcp.servers` in `config.json` using the same normalized server config model. Do not persist source/fingerprint metadata in user config in Phase 1A; any source/fingerprint metadata used by implementation is internal derived state only.
- [x] Reject HTTP session policy, reconnect policy, OAuth/browser auth, and legacy SSE fields from the Phase 1A schema instead of preserving them.
- [x] Define internal MCP server runtime snapshots as read-only derived manager state for tests/diagnostics; reading snapshots must not start, reconnect, initialize, list tools, or call tools.
- [x] Define `McpToolBinding`: model-facing name to server id, original tool name, and schema fingerprint. Catalog generation is implicit in the manager snapshot for Phase 1A.
- [x] Define MCP permission keys: fully-qualified tool `mcp__<server>__<tool>` as default remember key; server-level `mcp__<server>` and wildcard `mcp__<server>__*` are hand-authored rule forms only. Conflicts use the existing matcher order: any matching deny beats ask/allow, any matching ask beats allow, and allow only wins if no deny/ask rule matches.
- [x] Define MCP call arguments as prompt/audit payload only; arguments must not be serialized into permission allow/ask/deny keys.
- [x] Define Claude Code-style server/tool name normalization: replace invalid characters with `_`, build `mcp__<server>__<tool>`, and retain original server/tool names in `mcpInfo` for logging/calls.
- [x] Define simple collision behavior: after user/global config resolution produces the effective `mcp.servers` map, builtin/static tools reserve names first; MCP bindings are then considered in stable order by normalized server id and normalized tool name. If two MCP bindings produce the same `mcp__<server>__<tool>` name, keep the first binding and suppress later duplicates. Suppressed duplicates are reported only in internal runtime snapshots/debug logs; they are not exposed to the model, not written to user config, and not repaired with hash suffixes or aliases in Phase 1A. Claude Code tool names use normalized `mcp__<server>__<tool>` names and retain original `mcpInfo`; separate connector/server-name collision handling may add human-readable numeric suffixes, but Formax Phase 1A does not need hash aliases.
- [x] Define Claude Code-style MCP result mapping into existing `ToolResult`: text as text, `structuredContent` as JSON text, images/audio/non-image blobs as file-backed path text, resource links as placeholder text without body injection, and all large/binary output bounded.
- [x] Define Phase 1A result bounds: text and JSON-stringified `structuredContent` use a Claude Code-aligned MCP output budget: default `MAX_MCP_OUTPUT_TOKENS = 25_000`, with the first implementation allowed to derive a character budget as `maxTokens * 4` until Formax has a token estimator in this mapper. Truncated output appends an explicit marker that names the token limit. Binary/blob payloads are never emitted inline/base64 to the model; Formax Phase 1A local safety limits allow blobs up to `10 MiB` to be written under a manager-owned `mcp-output/<session-id>/` directory rooted in `cfg.paths.logsDir` when available. Larger blobs return an error text result with size metadata and no file write.
- [x] Define image handling: Phase 1A generic `ToolResult` mapping does not emit provider image blocks or raw image base64; images use the same file-backed path flow as other blobs, and provider-native image blocks are deferred until an adapter-specific non-text payload path exists.
- [x] Define file-backed output persistence: MCP output files written under logsDir are owned by the runtime/session artifact scope and are preserved after manager disposal/query close because transcript rows contain their paths. Automatic cleanup is deferred to a future explicit retention policy.
- [x] Define fake client interfaces before adding SDK-backed real transports.
- [x] Define a thin SDK transport adapter boundary: config parsing produces normalized transport configs; manager activation creates only `StdioClientTransport` or `StreamableHTTPClientTransport` in Phase 1A.
- [x] Define startup/connect side-effect boundary: real stdio spawn or Streamable HTTP connect is allowed only inside the scoped MCP server manager/transport activation path for active host-provided config; Phase 1A active sources are REPL user/global `config.json` and SDK explicit overlay.
- [x] Define activation/listTools side-effect boundary: manager activation connects, initializes, and lists tools for enabled servers; tool catalog building reads already-discovered metadata only; a first MCP tool call may reuse an existing client but must not be the initial discovery path.

### 1.3 Types / Interfaces
- [x] Add pure MCP types under `packages/core/src/mcp/`.
- [x] Add name helpers that build and parse `mcp__<server>__<tool>` without relying on split parsing as execution truth.
- [x] Add config parser for SDK/session overlay input and persisted `config.json` shape, with one normalized internal `McpServerConfig` model.
- [x] Wire REPL runtime manager inputs from user/global runtime config `mcp.servers`; keep SDK runtime manager inputs limited to explicit SDK/session overlay.
- [x] Add result mapper following Claude Code-style plain mapping: text passthrough, `structuredContent` JSON stringify, MCP output token cap defaulting to `25_000` tokens with `tokens * 4` char truncation approximation, file-backed blobs/images <=10 MiB with path text, stable error for larger blobs, resource links as placeholder text without body injection, and preserved file-backed artifacts.
- [x] Add manager/client abstractions with fake-client-backed tests.
- [x] Add one MCP `ToolHandler` that dispatches known MCP tool names through the manager.
- [x] Add shared catalog resolver helpers so REPL/app-server/SDK merge builtin tools and MCP tools consistently.

### 1.4 Semantic decision table
| Decision | Accepted rule | Source | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|---|
| MCP architecture | Hybrid: dynamic catalog + one MCP dispatch handler, integrated with existing direct/deferred exposure modes | User-aligned; WebGPT-reviewed; Formax-existing tool runtime | Single broker tool; global registry patch; per-tool static modules; MCP-specific search tool | `mcp-client`, `tool-runtime`, `prompt-tool-exposure` | MCP tools appear as normal `ToolDefinition`s but execute through one handler |
| Phase 1 transport model | Use `@modelcontextprotocol/sdk` transports from day one: `stdio` and Streamable HTTP as `type: "http"`; reject legacy `sse` in Phase 1A while reserving the discriminant for a later compatibility scope | MCP SDK/spec-derived; User-aligned | Hand-rolled JSON-RPC transport; stdio-only types that require later union refactor; legacy SSE as primary | `mcp-client`, `config-settings`, `permissions-policy` | parser accepts/normalizes stdio/http shapes, rejects sse, and runtime creates SDK transports only in manager activation; SDK does not read disk config |
| Config storage | Persisted MCP config lives under existing `config.json` as `mcp.servers`; Phase 1A REPL reads only user/global config and ignores repo-local project MCP config until a trust gate exists; SDK uses explicit overlay with the same parser/schema across transports | User-aligned; Formax-existing config system; safety review | Separate `.mcp.json`; designing storage only after runtime ships; SDK reading local config files; repo-local MCP activation without trust gate | `config-settings`, `mcp-client` | REPL user/global config can activate supported transports; SDK overlay can activate supported transports; parsing alone never starts/lists/connects servers |
| Discovery | MCP tools are dynamic tools at the same catalog level as existing tools. In direct exposure mode they may enter initial provider tools; in global deferred mode they participate in the existing deferred exposure runtime like other deferred catalog tools. | User-aligned; Formax-existing prompt/tool exposure | MCP-only always-deferred behavior; MCP-specific search tool; broker-only tool | `prompt-tool-exposure` | Direct mode can expose `mcp__*`; deferred mode loads `mcp__*` through the existing deferred mechanism |
| Naming | `mcp__<server>__<tool>` with simple normalization and retained original `mcpInfo`. Builtins reserve names first; MCP duplicates are suppressed in stable normalized server/tool order and diagnostics stay internal. Formax Phase 1A does not add hash aliases. | Claude Code-derived; User-aligned | Hash suffix; alias registry; complex collision resolver | `mcp-client`, `tool-runtime` | duplicate names do not crash or overwrite builtins silently; diagnostics explain dropped/hidden MCP tools |
| Tool permission | MCP tool calls use existing tool permission / approval flow keyed by fully-qualified tool name. Default interactive path prompts; remember defaults to `mcp__<server>__<tool>` and does not include arguments. | Claude Code-derived; Formax-existing permissions; User-aligned | Reuse `Bash(...)` command matching; `net.fetch`; trust annotations; default allow; separate `mcp.server.start` approval action; argument-exact remember by default | `permissions-policy` | MCP calls prompt in interactive main path and deny non-interactive/subagent without a matching allow; remembered same-tool calls with different args do not prompt again |
| Server startup/connect | Startup/connect is host/runtime config activation, not a model tool call. Phase 1A activates supported transports from REPL user/global config and SDK explicit overlay only. Activation must never come from model output, REPL command, app-server RPC, Web UI, config parsing alone, catalog construction, deferred exposure resolution, status reads, or dry-run. | Claude Code-derived startup timing; User-aligned entrypoint boundary; safety review | Model/chat-created startup config; repo-local project MCP activation without trust gate; SDK local-file reads; activation outside manager lifecycle | `mcp-client`, `config-settings`, `permissions-policy` | parser/catalog/status tests assert no client spawn/connect/list side effects; REPL startup path is the only disk-backed activation path; SDK activation is explicit-overlay only |
| Result mapping | Follow SDK/Claude Code-style result mapping with Phase 1A bounds: text/JSON capped by MCP output budget defaulting to 25,000 tokens and first implemented as `tokens * 4` char truncation; blobs/images are file-backed up to 10 MiB under logsDir-owned output dir; resource bodies are not injected; file-backed artifacts are preserved after manager/query disposal | Claude Code-derived text/token cap; Formax-Phase-1 safety choice for byte/file caps | Raw base64/blob injection; custom structured AST; automatic resource context injection; provider image blocks through generic `ToolResult`; unbounded output | `tool-runtime`, `mcp-client` | mapper never emits unbounded raw binary payloads; media degrades to file-backed/text output; resource bodies stay out of prompt; oversized blobs return stable errors; transcript paths remain valid after shutdown |
| SDK controls | Support the strict `options.mcpServers` explicit overlay subset; keep SDK MCP control methods unsupported in Phase 1A, including `query.mcpServerStatus()` | Formax-existing unsupported control surface; User-aligned | Live set/status/reconnect/toggle in Phase 1A; SDK local config reads | `mcp-client`, SDK matrix | overlay query tools are exposed; control methods continue stable unsupported errors |

### 1.5 EntryPoint Matrix
| EntryPoint | Reads config? | Activates runtime? | Exposes capability? | UI/transcript behavior | Tests |
|---|---|---|---|---|---|
| REPL | Yes: user/global `config.json` `mcp.servers`; repo-local project MCP config ignored until trust gate | Yes: background manager activation after runtime/session setup | Yes: MCP dynamic tools enter active tool exposure mode after discovery | Generic REPL/TUI MCP presenter; no `/mcp` management UI | config activation, manager, exposure, permissions, generic presenter |
| SDK | No local config reads; public `options.mcpServers` supports the strict explicit overlay subset | Yes: awaits query/session manager activation before first model request | Yes: exposes supported overlay MCP tools through the shared runtime | No MCP management UI; live control methods stay unsupported | SDK query overlay, unsupported controls, cleanup |
| app-server | No local MCP config reads; explicit empty MCP overlay only | No manager activation, connect, initialize, or listTools in Phase 1A | No MCP tools exposed in Phase 1A | No management UI and no read-only status events | empty overlay, no config read, no activation, no MCP tools |
| Web | No MCP config reads | No MCP activation | Displays MCP transcript events produced by supported backend paths; does not expose/manage servers | Generic `mcp__*` tool block renderer; no management UI | generic MCP tool block renderer |
| Electron | No Electron-specific MCP config reads in Phase 1A | No Electron-specific activation in Phase 1A | No Electron-specific MCP management/exposure path | Uses existing surfaces only; no management UI | covered by shared app-server/Web/REPL tests; no separate Electron MCP tests in Phase 1A |

### 1.6 Review finding triage policy
- [x] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [x] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, bind the finding to a future loop or backlog item.
- [x] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test if needed.
- [x] Re-run review only after triage is documented and targeted tests pass.

## 2. Runtime / Platform
- [x] Add `packages/core/src/mcp/types.ts`.
- [x] Add `packages/core/src/mcp/names.ts`.
- [x] Add `packages/core/src/mcp/config.ts`.
- [x] Add `packages/core/src/mcp/resultMapper.ts`.
- [x] Add the MCP client internal interface module.
- [x] Add the deterministic fake MCP client module for manager tests.
- [x] Add the MCP server manager module.
- [x] Add the MCP tool binding module.
- [x] Add `packages/core/src/mcp/toolCatalog.ts`.
- [x] Add the MCP SDK transport adapter module as a thin adapter over `@modelcontextprotocol/sdk` transports after fake-client semantics are locked.
- [x] Add `packages/core/src/tools/modules/mcp/{index,handler,presenter}.tsx` with one Claude Code-style generic MCP presenter for all `mcp__*` tools in REPL/TUI.
- [x] Add shared catalog resolver code for builtin specs plus MCP dynamic specs.
- [x] Register the manager-bound MCP handler module from runtime bootstrap (`packages/core/src/runtime/bootstrap/tooling.ts`), not the static builtin module registry.
- [x] Update REPL/TUI tool presenter routing/registry so dynamic `mcp__*` tool names resolve to the generic MCP presenter without registering one presenter per MCP tool.
- [x] Update permission/preflight/approval code only after the contract defines MCP tool-name permission behavior; do not add a `mcp.call` `PolicyAction`.
- [x] Ensure all MCP lifecycle cleanup honors abort/query close/scope disposal.

## 3. Entrypoint Boundary
- [x] REPL passes user/global runtime config `mcp.servers`, session scope, cwd, and runtime inputs into shared MCP catalog helpers.
- [x] app-server Phase 1A passes thread scope/cwd/runtime inputs plus an explicit empty MCP overlay into shared MCP catalog helpers.
- [x] SDK only passes query/session overlay and control calls into shared MCP manager; it does not own a separate MCP executor.
- [x] SDK/query runner creates and closes a query/session-scoped manager while naming, config parsing, catalog, dispatch, policy, and result mapping stay in shared MCP/runtime modules.
- [x] app-server Phase 1A does not read `mcp.servers` from local config, does not create/activate an MCP manager, does not connect/list tools, and does not expose MCP tools. It only preserves shared resolver type/shape with an empty overlay.
- [x] No Web/Electron MCP management UI in Phase 1A.
- [x] Define Web transcript behavior separately from REPL/TUI: add a generic `mcp__*` renderer in `packages/web-reference-react/src/components/tool/toolBlocksRegistry.ts`; do not rely on default fallback rendering for MCP transcript rows.
- [x] No app-server MCP management RPC in Phase 1A.
- [x] Do not add app-server/Web read-only MCP status events in Phase 1A.

## 4. Tests
- [x] Add `packages/core/src/mcp/names.test.ts`.
- [x] Add `packages/core/src/mcp/config.test.ts`: accepts SDK/session and persisted `config.json` shapes for `stdio` and `http`, rejects legacy/unsupported transports and unsupported auth modes, ensures parsing alone never instantiates clients or starts/connects/list tools, and distinguishes REPL disk-backed activation from SDK overlay-only behavior.
- [x] Add `packages/core/src/mcp/resultMapper.test.ts`: maps text/errors, JSON-stringifies `structuredContent`, caps text/JSON by MCP output budget defaulting to 25,000 tokens with `tokens * 4` char approximation and truncation marker, saves images/audio/non-image blobs <=10 MiB to files with path text, rejects larger blobs with stable error text, maps resource links to placeholder text without body injection, and never emits raw base64/blob injection.
- [x] Add manager/query disposal tests proving file-backed MCP output is preserved after runtime cleanup.
- [x] Add MCP server manager tests.
- [x] Add MCP tool binding tests: stable binding, simple normalization, builtin-name reservation, duplicate suppression by normalized server/tool order, internal diagnostics for suppressed duplicates, retained original `mcpInfo`, and no hash suffixes or alias registry in Phase 1A.
- [x] Add `packages/core/src/mcp/toolCatalog.test.ts`: consumes already-discovered metadata only and never connects or starts servers.
- [x] Add MCP exposure tests: direct exposure mode can include `mcp__*` in provider tools; global deferred mode can expose/load `mcp__*` through existing deferred machinery.
- [x] Add MCP cases to `packages/core/src/adapters/permissions/matcher.test.ts`: `mcp__server__tool` matches the exact MCP tool, `mcp__server` / `mcp__server__*` match server-level MCP tools, arguments are never part of the permission key, and conflicts follow existing `deny > ask > allow` order rather than specificity.
- [x] Add MCP cases to `packages/core/src/tools/executor/index.test.ts`: `PreToolUse` receives full `mcp__server__tool`, can block before client call, and `PostToolUse` still runs after success/error.
- [x] Add MCP cases to `packages/core/src/tools/executor/policyPreflight.test.ts`: default interactive MCP tool call prompts, remembered fully-qualified MCP tool permits the same tool across different call arguments, deny/ask wins, and non-interactive/subagent fail closed without pending approval.
- [x] Add MCP approval side-effect cases to `packages/core/src/tools/executor/approvalService.test.ts`: `approve_remember` writes/remembers the exact fully-qualified MCP tool name, not arguments; hand-authored server/wildcard rules are matched but not auto-generated.
- [x] Add REPL/TUI MCP presenter/router tests: any `mcp__server__tool` transcript row uses the generic MCP presenter, shows normalized server/tool identity and concise params/result summary, and falls back cleanly for malformed names.
- [x] Add Web transcript MCP test: `mcp__server__tool` uses the generic MCP tool block renderer, without adding MCP management UI.
- [x] Add SDK MCP cases to `packages/core/src/sdk/query.test.ts` after runtime is available.
- [x] Add app-server Phase 1A tests asserting empty MCP overlay behavior: no local MCP parsing during initialize, no manager activation/connect/listTools, no MCP tools exposed, shared resolver shape still accepts the empty overlay.
- [x] Do not add coverage runs for this task.

## 5. Recommended Execution Order

### Loop 1 — Contracts and Review Scope

#### Loop Contract
- Purpose: Lock MCP Phase 1A semantics before runtime code.
- In scope: canonical docs, SDK matrix, no implementation.
- Out of scope: code behavior changes, stdio process spawning, SDK validation changes.
- Blocking findings: any safety default, lifecycle owner, or tool exposure ambiguity.
- Non-blocking / later-loop findings: UI management, advanced resources/prompts UX, resource templates, elicitation bridge, rich media polish. These are not "Claude Code did not do this" claims; several are existing Claude Code capabilities that Formax is explicitly deferring.
- Known unresolved semantics: none for public SDK MCP status in Phase 1A; `query.mcpServerStatus()` remains unsupported.
- Required targeted tests: none, documentation-only loop.
- Review prompt scope: review contracts for safety and consistency with existing tool/prompt/policy contracts.
- Exit criteria: contracts describe Phase 1A clearly enough to implement pure helpers.

- [x] Add `docs/contracts/mcp-client-contract.md`.
- [x] Update tool runtime, prompt/tool exposure, permissions/policy, hooks, and config contracts.
- [x] Lock Phase 1A startup authority: REPL user/global runtime config authorizes disk-backed server startup; SDK explicit overlay authorizes SDK-scoped server startup; MCP tool-call approval never authorizes or implies server startup.
- [x] Lock activation timing: REPL starts MCP manager activation in the background after runtime/session setup and does not block first render or guarantee first-turn MCP availability; one-shot SDK/non-interactive activation is awaited before the first model request for explicit overlay config.
- [x] Lock side-effect-free phases: config parsing, name normalization, pure catalog mapping, status reads, deferred exposure resolution, and dry-run do not spawn/connect/list tools.
- [x] Lock persisted config storage: MCP config belongs under existing `config.json` as `mcp.servers`, not a separate MCP config file.
- [x] Lock disk activation boundary: REPL is allowed to feed user/global `mcp.servers` into the active runtime manager; repo-local project MCP config is ignored until a project trust gate exists; SDK must not read or feed user/project local config files.
- [x] Lock no-startup-approval rule: do not add `mcp.server.start` as a separate approval action in Phase 1; future persisted activation should be handled as explicit config behavior.
- [x] Lock MCP exposure/executor parity: once MCP metadata is converted into `ToolDefinition`s, MCP tools follow the existing active exposure mode plus executor `allowTools`/`denyTools` behavior exactly like any other tool; do not define MCP-specific visibility, not-loaded, or fallback errors.
- [x] Lock MCP tool-name allow/remember semantics: remember defaults to the fully-qualified tool name; server/wildcard rules are explicit hand-authored permissions; matching excludes individual call arguments in Phase 1A.
- [x] Lock MCP permissions as an extension of the existing tool permission / approval flow, not a parallel MCP permission system.
- [x] Update SDK contract alignment matrix.
- [x] Triage review findings before continuing.
- [x] Run `codex review` for this loop after document verification passes.

### Loop 2 — Pure Types, Naming, Config Overlay, Result Mapping

#### Loop Contract
- Purpose: Add pure MCP definitions with no process I/O and no entrypoint behavior change.
- In scope: types, name normalization, SDK/session config parser, persisted config shape/parser, transport-discriminated config model, tool spec mapping, result mapper.
- Out of scope: real MCP protocol, stdio spawn, registry/executor wiring, REPL activation.
- Blocking findings: nondeterministic names, fail-open config parsing, raw binary/provider payload emission.
- Non-blocking / later-loop findings: explicit alias UX if duplicates become painful, provider-native media polish, app-server/Web activation/UX.
- Known unresolved semantics: none for truncation thresholds in Phase 1A; threshold changes require a later contract update.
- Required targeted tests: pure MCP unit tests.
- Review prompt scope: verify pure helpers match Loop 1 contracts and do not introduce side effects.
- Exit criteria: pure tests pass and no runtime entrypoint observes MCP yet.

- [x] Add pure MCP types.
- [x] Add deterministic name normalization and parsing helpers.
- [x] Add simple normalization and duplicate-name suppression by normalized server/tool order with internal diagnostics.
- [x] Add SDK/session overlay config parser and persisted `config.json` parser for the transport-discriminated `stdio` + `http` config model.
- [x] Add persisted `config.json` MCP shape parser for `mcp.servers` that reuses the normalized server config model.
- [x] Add MCP tool-to-Formax `ToolDefinition` mapping.
- [x] Add MCP result-to-`ToolResult` mapping.
- [x] Assert SDK active runtime resolution ignores user/project MCP config sources in Phase 1A.
- [x] Assert persisted `config.json` shape validation is pure and does not imply activation outside the explicit REPL startup path.
- [x] Assert config parsing never instantiates SDK transports/clients, spawns, connects, initializes, lists tools, calls tools, or mutates manager state for either `stdio` or `http`.
- [x] Assert pure tool definition/catalog mapping consumes already-provided MCP metadata only and never starts a server.
- [x] Assert roots behavior is single-root only: client capability handles `ListRoots` with exactly the current runtime `cwd` root and does not advertise or negotiate multiple roots.
- [x] Assert status projection helpers are read-only and side-effect-free.
- [x] Run targeted pure MCP tests.
- [x] Triage review findings before continuing.
- [x] Run `codex review` for this loop after targeted verification passes.

### Loop 3 — Fake-Client MCP Runtime Manager

#### Loop Contract
- Purpose: Prove lifecycle, tool discovery, binding, call dispatch, status, and client cleanup against a fake MCP client.
- In scope: internal client interface, fake client, scoped manager, tool binding, fake-backed handler execution helper.
- Out of scope: stdio transport, SDK public behavior, REPL/app-server wiring, policy side effects.
- Blocking findings: cross-scope leakage, stale binding execution, missing cleanup, manager owning `cwd` incorrectly.
- Non-blocking / later-loop findings: idle TTL, richer diagnostics, live reconnect/toggle.
- Known unresolved semantics: none for public status in this loop; runtime snapshots are internal-only.
- Required targeted tests: manager, binding, fake client, client cleanup, and manager call cancellation.
- Review prompt scope: verify manager scope and lifecycle are reusable by REPL/app-server/SDK.
- Exit criteria: fake manager can list and call MCP tools without process I/O.

- [x] Add internal MCP client interface.
- [x] Add fake client implementation for tests.
- [x] Add scoped server manager.
- [x] Add binding map and stable catalog generation.
- [x] Add manager runtime snapshot and cleanup behavior.
- [x] Add fake-backed call dispatch returning `ToolResult`.
- [x] Assert manager owns lifecycle outside SDK runner: SDK is allowed to create/close a manager scope, but shared MCP modules own naming, binding, catalog, dispatch, and result mapping.
- [x] Assert manager runtime snapshots read existing state only and do not start, reconnect, initialize, list tools, or call tools.
- [x] Assert unknown/stale bindings return stable `ToolResult` errors and do not call the fake client.
- [x] Run targeted MCP manager/binding tests.
- [x] Triage review findings before continuing.
- [x] Run `codex review` for this loop after targeted verification passes.

### Loop 4 — Catalog, Executor, and Policy Wiring

#### Loop Contract
- Purpose: Make MCP tools visible and callable through existing Formax tool runtime using fake-backed manager.
- In scope: MCP tool module, shared catalog merge, direct/deferred exposure integration, MCP tool-name permission rules, preflight default behavior.
- Out of scope: real stdio transport, SDK public unlock, app-server management RPC.
- Blocking findings: MCP bypasses executor/policy/hooks/audit, MCP-only discovery path, non-interactive prompt deadlock.
- Non-blocking / later-loop findings: app-server/Web activation and UI status. Web management UI remains out of scope; Web transcript rendering is covered by the generic `mcp__*` renderer.
- Known unresolved semantics: none for MCP-specific exposure or fallback; MCP follows existing Formax exposure and executor rules.
- Required targeted tests: catalog/exposure resolver, executor, policy preflight, chat engine if catalog merging changes request tools.
- Review prompt scope: verify MCP calls are ordinary tool calls and policy-protected.
- Exit criteria: fake MCP tools can be exposed in direct mode, loaded in deferred mode, and called only through executor/policy.
- Review triage:
  - Fixed review blocker: runtime bootstrap now registers the manager-bound MCP module, so MCP handlers/presenters/catalog patching are part of the real `ToolRegistry`.
  - Fixed review blocker: unknown/stale `mcp__*` names are rejected before `PermissionRequest` hooks or approval UI.
  - Fixed review blocker: SDK approval suggestions now include `tool.name`/MCP add-rule suggestions, so SDK `canUseTool` remember flow can round-trip to `approve_remember`.
  - Fixed review blocker: MCP approval `updated_input_json` is validated against the MCP tool input schema before mutating the call input.
  - Fixed review blocker: normal runtime now creates a real `McpServerManager`, wires the SDK-backed client factory, passes the manager into `ToolRegistry`, and starts REPL activation in the background after runtime setup.
  - Fixed review blocker: REPL MCP activation no longer blocks runtime bootstrap/first render; first-turn MCP tool availability is not guaranteed until the background activation has discovered tools.

- [x] Add MCP tool module with one dispatch handler.
- [x] Add one Claude Code-style generic MCP tool presenter for REPL/TUI; do not create presenter files/modules per MCP server tool.
- [x] Add a Web `toolBlocksRegistry` generic `mcp__*` renderer; do not rely on default renderer fallback for MCP calls.
- [x] Add shared resolver that merges builtin tools and MCP dynamic tools before applying the active direct/deferred exposure mode.
- [x] In direct exposure mode, allow MCP dynamic tools to enter provider tools like other available tools.
- [x] In any exposure mode, route MCP dynamic tools through the same resolver/executor allow-list flow as other tools; do not add MCP-specific fallback, not-loaded, or allow/deny behavior.
- [x] Add an MCP tool-name preflight branch before unknown tools fall through `toolCallToPolicyAction(...)=null`: `mcp__*` calls default to prompt in interactive main path, deny in subagent/non-interactive, and consult permissions by tool name.
- [x] Route MCP tool calls into the existing approval UI/service using the fully-qualified MCP tool name without adding a `mcp.call` policy action.
- [x] Add permission matching for fully-qualified MCP tool rules and explicit hand-authored server-level `mcp__server` / wildcard `mcp__server__*` rules, reusing existing matcher precedence (`deny > ask > allow`) without MCP-specific specificity ordering.
- [x] Add interactive prompt default and non-interactive/subagent deny behavior for MCP tool calls.
- [x] Ensure MCP annotations never downgrade policy.
- [x] Ensure `PreToolUse`, `PermissionRequest`, `PostToolUse`, and audit payloads carry the full qualified MCP tool name.
- [x] Run targeted catalog/exposure/executor/policy tests.
- [x] Triage review findings before continuing.
- [ ] Re-run `codex review` for this loop after targeted verification passes.

### Loop 5 — SDK Transport Adapter and Lifecycle

#### Loop Contract
- Purpose: Replace fake client with SDK-backed transports behind the same manager interface.
- In scope: dependency decision, thin SDK transport adapter, stdio and basic Streamable HTTP (`type: "http"`) SDK transports, connect/list tools/call tool/close, timeouts, cleanup.
- Out of scope: app-server/Web activation, OAuth browser flow, sampling, resource templates, elicitation UI, Web UI.
- Blocking findings: shell injection, inherited secrets, orphan child processes, unbounded output, missing close on query abort.
- Non-blocking / later-loop findings: reconnect controls, idle TTL, advanced diagnostics.
- Known unresolved semantics: none for dependency strategy in Phase 1A; if the official SDK dependency is rejected, stop before hand-rolling protocol details.
- Required targeted tests: SDK transport adapter, stdio fake server fixture, basic HTTP transport fixture or mocked SDK transport, cleanup, timeout, error status.
- Review prompt scope: verify SDK transport use stays thin and product glue does not reimplement MCP protocol details.
- Exit criteria: stdio and basic HTTP MCP servers can list and call tools through SDK `Client.connect(transport)` in controlled tests and close reliably.

- [x] Add the official MCP TypeScript SDK dependency.
- [x] Add a thin SDK transport adapter that dispatches normalized config to SDK `StdioClientTransport` or `StreamableHTTPClientTransport`.
- [x] Add SDK `Client` wrapper for connect/list tools/call tool/close and capability/status extraction.
- [x] Add controlled stdio MCP server fixture for tests.
- [x] Add mocked Streamable HTTP transport tests at the adapter boundary; do not require a real HTTP server fixture in Phase 1A.
- [x] Wire SDK client adapter into manager.
- [x] Assert stdio spawn and HTTP connect can occur only through the scoped manager/transport activation path, never from config parser, tool catalog, exposure resolver, status reads, SDK validation, or dry-run.
- [x] Assert manager activation performs connect/initialize/listTools for enabled servers and records failed/pending state without exposing tools from failed servers.
- [x] Assert catalog construction uses only existing manager tool metadata and never calls connect/initialize/listTools.
- [x] Assert stdio startup uses executable plus argv, not shell string interpolation.
- [x] Assert stdio startup inherits only the MCP SDK safe default environment plus a low-sensitivity runtime env allowlist, and applies per-server explicit `env` overrides without leaking unrelated parent-process secrets to the child process, model-facing output, or audit.
- [x] Add timeouts and bounded result handling.
- [x] Bound stdio protocol/output handling by delegating stdout to the SDK protocol stream, piping/draining stderr instead of inheriting it, and bounding MCP result payloads.
- [x] Ensure startup/list-tools timeout produces failed status and no dynamic tools.
- [x] Ensure stdio transport tests use explicit fixtures; add separate REPL activation tests for project/global persisted config files.
- [x] Add lifecycle handling for manager scope disposal, query close/interruption, and process shutdown path while preserving transcript-referenced file-backed MCP artifacts.
- [x] Run targeted SDK transport lifecycle tests.
- [x] Triage review findings before continuing.
- [ ] Run `codex review` for this loop after targeted verification passes.

### Loop 6 — SDK Surface and Shared Entrypoint Polish

#### Loop Contract
- Purpose: Expose the tested Phase 1A MCP runtime through REPL config activation, SDK overlay, and shared entrypoint wiring.
- In scope: REPL user/global `config.json` activation, SDK explicit `options.mcpServers` overlay activation, and app-server shared resolver shape with explicit empty MCP overlay.
- Out of scope: live dynamic MCP controls, REPL `/mcp` or status command, app-server/Web activation/UX, Web management UI.
- Blocking findings: SDK-only MCP path, entrypoint parity drift, unsupported methods silently no-op, session cleanup leaks.
- Non-blocking / later-loop findings: app-server status notification, REPL slash command, app-server/Web activation/UX.
- Known unresolved semantics: none for public SDK MCP status in Phase 1A; `query.mcpServerStatus()` remains unsupported.
- Required targeted tests: SDK query tests, REPL/app-server resolver tests if touched, cleanup tests.
- Review prompt scope: verify public surface matches contracts and does not over-promise.
- Exit criteria: REPL reads user/global `mcp.servers` from existing config resolution and ignores repo-local project MCP config; enabled runtime transports work through shared runtime; app-server remains empty-overlay/no-activation; public SDK `options.mcpServers` supports the strict explicit overlay subset.

- [x] Wire REPL runtime/session setup to pass user/global runtime config `mcp.servers` into the shared MCP manager and start background activation without blocking first render.
- [x] Support public SDK `options.mcpServers` for the strict transport-aware explicit overlay shape only.
- [x] Keep `strictMcpConfig` and live dynamic controls unsupported in Phase 1A.
- [x] Keep SDK `query.mcpServerStatus()` unsupported in Phase 1A with the existing stable unsupported error; do not add a REPL status command/API in Phase 1A; internal manager runtime snapshots are allowed only for tests/diagnostics and must not start, reconnect, discover, list tools, or call tools.
- [x] Wire app-server through shared catalog helper types with an explicit empty MCP overlay; keep app-server config reads, activation, connection, listTools, and MCP tool exposure disabled in Phase 1A.
- [x] Ensure query close/interruption disposes query-scoped MCP clients.
- [x] SDK/one-shot non-interactive MCP activation awaits manager activation before first model request for the explicit overlay path; live MCP control methods continue to return explicit unsupported errors.
- [x] Update SDK docs/matrix notes for supported and unsupported MCP behavior.
- [x] Run targeted SDK and entrypoint tests.
- [x] Triage review findings before continuing.
- [ ] Run `codex review` for this loop after targeted verification passes.

## 6. Stop Conditions
- [ ] Stop if the team wants SDK to read user/project local MCP config files.
- [ ] Stop if MCP tool-call default prompt is rejected without a replacement safety model.
- [ ] Stop if MCP tools require MCP-specific exposure, allow/deny, fallback, or not-loaded behavior instead of reusing existing Formax tool runtime rules.
- [ ] Stop if normalized MCP tool names require alias/hash design in Phase 1 instead of simple deterministic de-dupe.
- [ ] Stop if result payloads require a custom structured AST or provider media blocks through generic `ToolResult` in Phase 1A.
- [ ] Stop if MCP transport execution cannot use an accepted SDK/dependency and would require hand-rolling protocol details.
- [ ] Stop if non-interactive SDK behavior requires prompts without `canUseTool`/exact allow support.
- [ ] Stop if a required MCP server needs roots beyond the single current runtime `cwd` root.

## 7. Phase 2 Backlog
- [ ] app-server/Web MCP config activation through explicit config semantics.
- [ ] `/mcp` slash command or MCP management UI.
- [ ] App-server/Web/Electron MCP status and controls.
- [ ] OAuth and advanced Streamable HTTP session/reconnect UX beyond the basic SDK transport path.
- [ ] Legacy SSE transport compatibility only in a separately scoped later phase.
- [ ] MCP resources as explicit list/read tools and optional `@server:uri` attachment UX.
- [ ] MCP prompts as slash commands, not model tools.
- [ ] Advanced MCP roots negotiation beyond current cwd.
- [ ] MCP elicitation bridge with cancel/queue/UI semantics.
- [ ] MCP sampling bridge.
- [ ] MCP tasks / long-running operation integration.
- [ ] Provider-native media/result support beyond Phase 1A file-backed image/audio/blob fallback.
- [ ] Idle TTL and long-lived server health diagnostics.
