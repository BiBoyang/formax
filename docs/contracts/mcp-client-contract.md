# MCP Client 合同（唯一事实源）

最后更新：2026-06-05
状态：规范性（Normative）

本文档定义 Formax 作为 MCP client/host 的 Phase 1A 合同。

范围：
- MCP server config 存储与入口读取边界
- stdio / Streamable HTTP transport config 形状
- MCP server activation timing 与 side-effect-free 阶段
- MCP tools 到 Formax `ToolDefinition` 的映射
- MCP tool permission / approval / hook 语义
- MCP result mapping、输出边界、file-backed blobs、roots
- REPL / SDK / app-server / Web / Electron entrypoint 行为

不在范围内：
- Formax 作为 MCP server
- OAuth browser flow
- legacy SSE runtime support
- MCP resources/prompts/sampling/elicitation/tasks 的 Phase 1A 实现
- app-server/Web/Electron MCP management UI
- `/mcp` slash command
- live `setMcpServers` / reconnect / toggle controls

相关文档（信息性镜像）：
- `docs/contracts/tool-runtime-contract.md`
- `docs/contracts/prompt-tool-exposure-contract.md`
- `docs/contracts/permissions-policy-contract.md`
- `docs/contracts/hooks-contract.md`
- `docs/contracts/config-settings-contract.md`
- `plans/sdk-contract-alignment-loop/query-alignment-matrix.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 角色与入口边界

`MCP-001`  
Formax Phase 1A MUST 只实现 MCP client/host 支持。Formax MUST NOT 实现 MCP server。

`MCP-002`  
REPL 是 Phase 1A 唯一 disk-backed MCP activation 入口。REPL MUST 只从 user/global `config.json` 的 `mcp.servers` 读取启用的 MCP servers。Repo-local project `config.json` 中的 MCP config MUST be ignored in Phase 1A until a project MCP trust/approval gate exists.

`MCP-003`  
SDK MUST NOT 读取 user/project local MCP config files。SDK Phase 1A MCP servers MUST 只来自 explicit `options.mcpServers` / session overlay。

`MCP-004`  
app-server Phase 1A MUST pass explicit empty MCP overlay into shared resolver shape, and MUST NOT read local MCP config, create/activate an MCP manager, connect, initialize, list tools, or expose MCP tools.

`MCP-005`  
Web / Electron Phase 1A MUST NOT provide MCP config activation or management UI. Web MAY render MCP tool transcript events produced by supported backend paths, but MUST NOT become an MCP server activation authority.

## 2. Config 存储与 Schema

`MCP-101`  
Persisted MCP config MUST live under existing Formax `config.json` storage as `mcp.servers`. Formax MUST NOT introduce a separate `.mcp.json` or MCP-specific config file in Phase 1A.

`MCP-102`  
`mcp.servers` MUST be a record keyed by normalized server id. Server ids MUST be deterministic and MUST NOT contain secrets.

`MCP-103`  
`McpServerConfig` Phase 1A MUST be a strict discriminated union:

1. shared fields: `enabled?: boolean`, default `true`; `timeoutMs?: number`
2. `type: "stdio"` with `command`, optional `args`, optional `env`, optional `cwd`, optional shared fields
3. `type: "http"` for MCP Streamable HTTP with `url`, optional `headers`, optional shared fields
4. reserved `type: "sse"` rejected by the Phase 1A parser

`MCP-104`  
The parser MUST reject unknown transport fields, OAuth/browser auth fields, HTTP session policy fields, reconnect policy fields, and legacy SSE runtime fields.

`MCP-105`  
`stdio.env` and `http.headers` MAY reference environment variables. Raw secrets MUST NOT be emitted to model-facing output, prompt helper blocks, transcript summaries, diagnostics shown to the model, or audit text.

For stdio servers, Formax Phase 1A MUST spawn the configured command with the MCP SDK safe default environment plus a small allowlist of non-secret runtime environment variables needed for local process startup (for example PATH, temporary-directory, locale, and SSH agent variables), then apply `stdio.env` as explicit overrides. Formax MUST NOT inherit the entire parent process environment into stdio MCP children by default.

`MCP-106`  
Source/fingerprint metadata MUST NOT be persisted into user config in Phase 1A. Any source/fingerprint metadata used by implementation MUST be internal derived state only.

## 3. Activation 与 Side Effects

`MCP-201`  
The following phases MUST be side-effect-free and MUST NOT spawn, connect, initialize, list tools, call tools, or mutate manager state:

1. config parsing
2. name normalization
3. pure catalog mapping
4. status snapshot reads
5. deferred exposure resolution
6. dry-run request construction

`MCP-202`  
Interactive REPL MUST start enabled MCP server connect/initialize/listTools in a background manager activation after runtime/session setup. This activation MUST NOT block first render and MUST NOT guarantee first-turn MCP tool availability.

`MCP-203`  
SDK / one-shot non-interactive query setup MUST await MCP manager activation before the first model request. SDK activation MUST use only the explicit `options.mcpServers` / session overlay shape and MUST NOT read user/project local MCP config files.

`MCP-204`  
Server startup/connect is host/runtime config activation. It MUST NOT be authorized by model output and MUST NOT be represented as a model tool-call permission.

`MCP-205`  
MCP tool-call approval authorizes only the model-requested MCP tool invocation. It MUST NOT authorize server startup, config mutation, reconnect, or live server toggling.

## 4. Tool Catalog 与 Naming

`MCP-301`  
MCP `tools/list` entries MUST be converted into dynamic Formax `ToolDefinition`s at the same catalog level as existing tools.

`MCP-302`  
MCP tool names exposed to the model MUST use `mcp__<server>__<tool>` after simple normalization. Original server/tool names MUST be retained in internal `mcpInfo` for logging and calls.

`MCP-303`  
Built-in/static tools reserve names first. MCP bindings are then considered in stable order by normalized server id and normalized tool name.

`MCP-304`  
If two MCP bindings produce the same model-facing name, Formax Phase 1A MUST keep the first binding and suppress later duplicates. Suppressed duplicates MUST be reported only through internal runtime snapshots/debug logs; Phase 1A MUST NOT add hash suffixes or alias registries.

`MCP-305`  
MCP tools with missing `inputSchema` MAY use the default empty object schema. MCP tools with non-object-root input schemas MUST be suppressed with internal diagnostics in Phase 1A, because Formax tool calls are object-shaped.

`MCP-306`  
MCP tools MUST follow the active Formax tool exposure mode:

1. direct/legacy mode: MCP dynamic tools are eligible to enter provider tools like other tools
2. global deferred mode: MCP dynamic tools participate in the existing deferred exposure runtime like other catalog tools

MCP MUST NOT define MCP-specific search, broker, not-loaded, fallback, allow-list, or deny-list semantics.

## 5. Permissions、Approval、Hooks

`MCP-401`  
MCP tool calls MUST reuse the existing Formax tool permission / approval flow. Phase 1A MUST NOT add a new `mcp.call` `PolicyAction`.

`MCP-402`  
MCP tool permission keys MUST match model-facing tool names. Default remember key MUST be the fully-qualified `mcp__<server>__<tool>` name.

`MCP-403`  
Hand-authored server-level `mcp__<server>` and wildcard `mcp__<server>__*` rules MAY be matched by permissions settings. Formax MUST NOT auto-generate server-level or wildcard remember rules in Phase 1A.

`MCP-404`  
MCP permission matching MUST reuse existing matcher precedence: `deny > ask > allow`; list precedence wins before match specificity. MCP MUST NOT add MCP-specific specificity ordering.

`MCP-405`  
MCP call arguments MUST be prompt/audit payload only. Arguments MUST NOT be serialized into permission allow/ask/deny keys.

`MCP-406`  
Interactive main path MCP tool calls MUST prompt by default when no matching allow exists. Non-interactive and sub-agent paths MUST fail closed without pending approval.

`MCP-407`  
Plan mode MUST fail closed for MCP tool calls in Phase 1A. Formax Phase 1A does not infer MCP tools' filesystem effects or target paths, so MCP tools MUST NOT bypass plan-mode's existing "only edit the active plan file" protection.

`MCP-408`  
`PreToolUse`, `PermissionRequest`, `PostToolUse`, and audit payloads MUST carry the full qualified MCP tool name.

## 6. Result Mapping 与 IO 边界

`MCP-501`  
MCP tool results MUST map into existing `ToolResult`.

`MCP-502`  
Text content MUST pass through as text. `structuredContent` MUST be JSON-stringified into text.

`MCP-503`  
Text and JSON-stringified output MUST use the Claude Code-derived MCP output budget: default `MAX_MCP_OUTPUT_TOKENS = 25_000`, with Phase 1A allowed to approximate character budget as `maxTokens * 4`. Truncated output MUST append an explicit marker naming the token limit.

`MCP-504`  
Raw binary/blob payloads MUST NOT be emitted inline/base64 to the model.

`MCP-505`  
Formax Phase 1A generic `ToolResult` mapping MUST NOT emit provider image blocks or raw image base64. Provider-native MCP image blocks are deferred until Formax has an adapter-specific non-text payload path that cannot be stringified by generic transcript/pruning/provider fallbacks.

`MCP-506`  
Images, audio, and non-image blobs up to `10 MiB` MAY be saved as file-backed output under manager-owned `mcp-output/<session-id>/`, rooted in `cfg.paths.logsDir`. Larger blobs MUST return stable error text with size metadata and no file write.

`MCP-507`  
File-backed MCP output written under the configured logs directory MUST be preserved after manager disposal / query close because transcript output contains filesystem path placeholders. Cleanup of these persisted artifacts is deferred to an explicit future retention policy and MUST NOT run implicitly during normal runtime shutdown.

## 7. Roots 与非 Tool Capability

`MCP-601`  
Formax Phase 1A MUST declare roots only as the current runtime `cwd` root and answer `ListRoots` with exactly that single root.

`MCP-602`  
Formax Phase 1A MUST NOT implement multi-root negotiation or project-root selection UX.

`MCP-603`  
Formax Phase 1A MUST convert only MCP `tools/list` entries into model-facing tools. MCP resources and prompts MUST NOT be injected into model context or tool exposure in Phase 1A.

`MCP-604`  
Formax Phase 1A MUST NOT declare MCP elicitation capability until a real cancel/queue/UI bridge exists.

`MCP-605`  
Sampling, resource templates, resource subscribe/poll, and MCP tasks are out of Phase 1A.

## 8. SDK Surface

`MCP-701`  
SDK `options.mcpServers` is supported in Phase 1A only for the strict transport-aware overlay shape. It MUST use the shared MCP parser/runtime path, support `stdio` and Streamable HTTP `type: "http"`, and reject OAuth/session/reconnect/legacy SSE fields.

`MCP-702`  
`strictMcpConfig`, `query.mcpServerStatus()`, `setMcpServers()`, `reconnectMcpServer()`, and `toggleMcpServer()` MUST remain stable unsupported surfaces in Phase 1A.

## 9. 一致性测试映射

Phase 1A MCP conformance MUST be covered by targeted tests in these areas:

1. `packages/core/src/mcp/*`
2. tool catalog / exposure resolver tests
3. permissions matcher / preflight / approval service tests
4. executor hook/audit tests
5. REPL/TUI generic MCP presenter tests
6. Web generic `mcp__*` tool block renderer tests
7. SDK query overlay / unsupported control tests
8. app-server empty overlay tests

## 10. 变更流程

When changing MCP config, activation, tool catalog, permissions, result mapping, SDK surface, or roots behavior:

1. Update this file first.
2. Update the relevant summary contracts: tool runtime, prompt/tool exposure, permissions, hooks, config settings, SDK matrix.
3. Update implementation and targeted tests.
4. Keep app-server/Web/Electron activation out of Phase 1A unless a later contract explicitly scopes it.

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
