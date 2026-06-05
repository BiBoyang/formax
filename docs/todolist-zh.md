# MCP Client Todo（中文）

## 0. 背景和边界

### 0.1 已确认事实
- [x] Formax 是 code agent，因此本任务是增加 MCP client/host 支持，不是实现 MCP server。
- [x] 现有 Formax tool 语义以 `ToolDefinition`、`ToolCall`、`ToolResult` 为中心。
- [x] Tool 执行必须继续经过现有 executor gates：abort、subagent deny、allow/deny list、handler resolution、hooks、policy preflight、handler execution。
- [x] 现有 deferred exposure runtime 已经为 global deferred mode 提供 session-scoped catalog、loaded tool state、search/select 行为。
- [x] REPL、app-server、SDK 已经共享 prompt/tool exposure 语义，不能长出单独 MCP 路径。
- [x] SDK types 暴露 `options.mcpServers` 和 MCP control methods；Phase 1A 已支持 explicit `options.mcpServers` overlay 子集，live MCP control methods 仍保持 unsupported。
- [x] WebGPT review 回复收敛到 hybrid 架构：dynamic MCP tool catalog + 一个 MCP dispatch handler，并兼容现有 direct/deferred tool exposure modes。
- [x] Claude Code 参考行为把 MCP server config trust/activation 和 MCP tool-call permissions 分开；MCP tool remember 默认记 fully-qualified tool name，不记 arguments。
- [x] Claude Code 对动态 MCP tools 使用一个 generic `MCPTool` / MCP UI renderer，不是每个 server tool 一个 UI presenter。

### 0.2 目标
- [x] Phase 1 增加 MCP client 支持，使用 `@modelcontextprotocol/sdk` client transports：stdio 和 Streamable HTTP。
- [x] MCP tools 以 `mcp__<server>__<tool>` 形状暴露给模型。
- [x] MCP tools 作为动态 `ToolDefinition` 注册在和现有 tools 同一个 runtime 层级；具体暴露方式跟随当前 Formax tool exposure mode。
- [x] MCP tool calls 通过现有 executor、hooks、policy、approval、audit 路径执行。
- [x] runtime 语义经过测试后，解锁安全子集的 SDK `options.mcpServers`。
- [x] REPL、app-server、SDK 都通过 shared MCP runtime/catalog helpers 接线。
- [x] Phase 1A 中 REPL MCP server config 使用现有 `config.json` 存储；SDK 只使用 explicit overlay，不能读取本地 config files。

### 0.3 非目标
- [x] Phase 1 不实现 Formax MCP server。
- [x] 不手写 MCP protocol 或 transport；使用 `@modelcontextprotocol/sdk` `Client` 和 SDK transports。
- [x] Phase 1A 不做 OAuth browser flow；HTTP config 只支持 static `headers` 和环境变量引用。
- [x] Phase 1A 不执行 legacy SSE；`type: "sse"` 只为后续 compatibility scope 保留，Phase 1A parser 必须拒绝。
- [x] Claude Code 除了 tools 以外，还处理两类非 tool MCP capability：`resources/list` 和 `prompts/list`。它可以把 prompts 暴露成 slash-style commands，把 resources 通过 explicit list/read tools 暴露。Formax Phase 1A 只把 MCP `tools/list` 结果转换成 `mcp__<server>__<tool>` tools；MCP resources 和 prompts 不进入 model context/tool exposure，延后到 Phase 2 explicit UX/tools。
- [x] Claude Code 声明 MCP roots，并对 `ListRoots` 返回当前工作目录。Formax Phase 1A 只声明当前 runtime `cwd` root，并对 `ListRoots` 返回这一个 root；Phase 1A 不做 multi-root negotiation 或 project-root selection UX。
- [x] Claude Code 有 MCP elicitation handling。Formax Phase 1A 在没有真实 cancel/queue/UI bridge 前，不声明 MCP elicitation capability。
- [x] MCP sampling bridge、resource templates、resource subscribe/poll、tasks 不在 Formax Phase 1A；不要把这些写成 Claude Code parity 结论，除非后续单独查证 reference code。
- [x] Phase 1 不做 app-server/Web/Electron MCP 管理 UI；Web transcript rendering 第一版增加 generic `mcp__*` tool block renderer，不做管理 UI。
- [x] Phase 1 不做 `/mcp` slash command。
- [x] Phase 1A 不做 live `setMcpServers`、`reconnectMcpServer`、`toggleMcpServer` runtime mutation。
- [x] 不增加 `.mcp.json` 这类单独 MCP config 文件；持久化 MCP config 必须使用现有 Formax `config.json` 系统。
- [x] SDK runtime 不消费 user/project local config files；SDK MCP servers 必须来自 explicit SDK/session overlay。
- [x] Phase 1A 中 config parsing、catalog construction、status reads、deferred exposure resolution、dry-run request construction 都不能启动 MCP server。
- [x] Phase 1A 不支持 user/chat/model-created MCP session overlay。
- [x] Phase 1A 不增加可启动 MCP servers 的 app-server protocol field、REPL command、Web UI path。
- [x] Phase 1 不增加 MCP-specific broker/search tool；MCP tools 使用当前 mode 下 Formax 正常 tool exposure 机制。

### 0.4 Review 范围
- [x] MCP 横跨 tool runtime、prompt exposure、policy、hooks、SDK、child-process lifecycle，因此每个 loop 编辑前都需要明确 scope。
- [x] code changes 前必须先分类 review findings；Phase 1A 中在当前 loop notes/todo 里做，不新增 dedicated findings-log 文件。
- [x] 当前 loop review 由各 loop 的 `Loop Contract` 限定。
- [x] later-loop findings 只记录，不在当前 loop 追。
- [x] spec ambiguity 会停止实现，直到 contracts/todo/user alignment 更新。
- [x] 如果一个 loop 中 targeted tests 已通过，但两轮 review 仍产生新的 P1/P2 semantic findings，则停止实现 edits 并做 convergence pass。

### 0.5 决策草案摘要
- [x] Storage/config source：持久化 MCP config 存在现有 Formax `config.json` 的 `mcp.servers` 下；REPL Phase 1A 只读取 user/global runtime config，repo-local project MCP config 先忽略，直到有 project MCP trust/approval gate；SDK 只使用 explicit `options.mcpServers` / session overlay；Phase 1A 中 app-server/Web/Electron 不读取本地 MCP config。
- [x] Schema/defaults/rejected fields：Phase 1A 支持 strict `stdio` 和 Streamable HTTP `type: "http"` config；`enabled?: boolean` 默认 `true`；未知 transport fields 拒绝；OAuth/session/reconnect fields 拒绝；reserved `type: "sse"` 拒绝。
- [x] Startup/activation timing：config parsing、catalog construction、status reads、deferred exposure resolution、dry-run 都是纯只读；REPL 在 runtime/session setup 后后台启动 manager activation；SDK/one-shot non-interactive 对 explicit overlay path 在第一次 model request 前 await manager activation；Phase 1A 中 app-server/Web/Electron 不激活 MCP。
- [x] Permission model：MCP tool calls 复用现有 Formax tool permission / approval / hook flow，key 为 fully-qualified tool name；不新增 `mcp.call` `PolicyAction`，也不新增 `mcp.server.start` approval action。
- [x] Capability level：MCP `tools/list` 结果变成和现有 tools 同层级的 dynamic `ToolDefinition`；使用一个 generic MCP dispatch handler 执行；不做 MCP broker/search tool，也不定义 MCP-specific ToolSearch 语义。
- [x] Result/IO/persistence bounds：text/JSON output 使用 Claude Code-derived `MAX_MCP_OUTPUT_TOKENS = 25_000` 和 `tokens * 4` 字符近似；image/blob byte caps 是 Formax Phase 1A safety choices；binary payloads 写到 logsDir 下的 file-backed artifacts，并在 manager/query close 后保留，因为 transcript 里会引用这些 path。
- [x] Explicit non-goals：Phase 1A 不做 Formax MCP server、OAuth、legacy SSE runtime、resources/prompts exposure、multi-root negotiation、elicitation、sampling、app-server/Web/Electron management UI、`/mcp`、live SDK controls、SDK local config reads。

## 1. 先定义

### 1.1 Canonical docs
- [x] 新增 `docs/contracts/mcp-client-contract.md`，作为 MCP client 唯一事实源。
- [x] 更新 `docs/contracts/tool-runtime-contract.md`，加入 MCP dynamic tool handler 和 result mapping 规则。
- [x] 在 `docs/contracts/mcp-client-contract.md` 中定义 Phase 1A active server sources：REPL 使用 user/global runtime config `mcp.servers`，repo-local project MCP config 先忽略直到有 trust gate；SDK 只使用 explicit `options.mcpServers` / session overlay。
- [x] 在 `docs/contracts/mcp-client-contract.md` 中定义 config parsing、name normalization、pure catalog mapping、status reads、dry-run preview 都是 side-effect-free：不能 spawn、connect、initialize、list tools。
- [x] 在 `docs/contracts/mcp-client-contract.md` 中定义对齐 Claude Code 的 activation timing：config reads 纯只读；interactive REPL 在 runtime/session setup 后后台启动 enabled MCP servers 的 connect/listTools，不阻塞首屏，也不保证首轮一定已有 MCP tools；one-shot SDK/non-interactive runs 对 explicit overlay path 在第一次 model request 前 await manager activation。
- [x] 在 `docs/contracts/mcp-client-contract.md` 中定义 MCP tool-call approval 只授权模型请求的 tool invocation；server startup 是 host/runtime config activation，不是 model tool-call permission。
- [x] 更新 `docs/contracts/prompt-tool-exposure-contract.md`：MCP 是 dynamic tool catalog input，不自动注入 resources/prompts。
- [x] 在 `docs/contracts/prompt-tool-exposure-contract.md` 中定义 MCP tools 跟随同一套 active exposure mode：legacy/direct mode 下可 direct exposure；global deferred mode 下通过现有 deferred 机制 search/load。
- [x] 在 `docs/contracts/prompt-tool-exposure-contract.md` 中定义 deferred discovery controls 只影响 global deferred mode；在 direct exposure mode 下不能让 MCP 特殊不可用。
- [x] 更新 `docs/contracts/permissions-policy-contract.md`：MCP 使用 tool-name permission 语义，并且 Phase 1 不增加独立 `mcp.server.start` approval action。
- [x] 在 `docs/contracts/permissions-policy-contract.md` 中定义 MCP permissions 匹配 tool names，而不是新增 `PolicyAction`：默认 exact `mcp__<server>__<tool>`，并支持 hand-authored server-level `mcp__<server>` 和 wildcard `mcp__<server>__*` rules。MCP 必须复用现有 permission decision 顺序 `deny > ask > allow`；list precedence 先于 match specificity。
- [x] 在 `docs/contracts/permissions-policy-contract.md` 中定义 Phase 1A MCP remember 不绑定单次调用 arguments；一个 MCP tool 的 remembered approval 适用于后续同一个 fully-qualified tool 的不同 arguments。
- [x] 在 `docs/contracts/permissions-policy-contract.md` 中定义 Phase 1A MCP `approve_remember` 是现有 permission/approval remember behavior 针对 fully-qualified MCP tool name；arguments 只进入 prompt/audit。
- [x] 更新 `docs/contracts/hooks-contract.md`：MCP tool names 和 MCP policy payload fields 使用现有 hook events。
- [x] 更新 `docs/contracts/config-settings-contract.md`：在现有 `config.json` 下预留 persisted MCP config，长期 envelope 为 `mcp.servers`。
- [x] 在 `docs/contracts/config-settings-contract.md` 中定义 REPL Phase 1A 只从 user/global `config.json` 读取 `mcp.servers`，repo-local project MCP config 先忽略直到有 trust gate；SDK Phase 1A 不能读取 local config files。
- [x] 更新 `plans/sdk-contract-alignment-loop/query-alignment-matrix.md`，加入 Phase 1 SDK 子集。
- [x] 只有新增 MCP runtime entrypoints 或 ownership modules 时才更新 `CODEMAP.md`。

### 1.2 数据模型
- [x] 定义 `McpServerConfig` 为 discriminated union，对齐 Claude Code / SDK config vocabulary：
  - Shared field：`enabled?: boolean`，默认 `true`。Phase 1A 不支持单独的 `disabled` 字段。
  - `type: "stdio"`：包含 `command`，可选 `args`、`env`、`cwd`、`timeoutMs`、`enabled`。
  - `type: "http"`：表示 MCP Streamable HTTP，包含 `url`，可选 `headers`、`timeoutMs`、`enabled`。
  - `type: "sse"`：只保留 discriminant，Phase 1A parser 拒绝；本计划不创建 runtime transport support。
- [x] 明确定义 dynamic-key 边界：`mcp.servers` 是以 normalized server id 为 key 的 record；`stdio.env` 和 `http.headers` 是 typed records；但每个 server config object 仍保持 strict，拒绝未知 transport fields。
- [x] 跨 transports 一致定义 `McpServerConfig` secret handling；`env` 和 `headers` 不进入 model-facing output 或 audit，stdio startup 只继承 MCP SDK safe default environment、低敏 runtime env allowlist 和 per-server explicit overrides。
- [x] 文档明确 `type: "http"` 表示 MCP Streamable HTTP，不是任意 HTTP fetch。
- [x] 在 `config.json` 的 `mcp.servers` 下定义 persisted config shape，复用同一个 normalized server config model。Phase 1A 不把 source/fingerprint metadata 持久化到 user config；实现里使用的 source/fingerprint metadata 只能是 internal derived state。
- [x] Phase 1A schema 拒绝 HTTP session policy、reconnect policy、OAuth/browser auth、legacy SSE fields；parser 必须拒绝这些 unknown fields，而不是保留。
- [x] 定义 internal MCP server runtime snapshots：这是 manager 的 read-only derived state，只用于 tests/diagnostics；读取 snapshots 不得 start、reconnect、initialize、list tools 或 call tools。
- [x] 定义 `McpToolBinding`：model-facing name 到 server id、original tool name、schema fingerprint；Phase 1A generation 隐含在 manager snapshot 中。
- [x] 定义 MCP permission keys：默认 remember key 是 fully-qualified tool `mcp__<server>__<tool>`；server-level `mcp__<server>` 和 wildcard `mcp__<server>__*` 只作为 hand-authored rule forms。冲突时沿用现有 matcher 顺序：任一 matching deny 胜过 ask/allow，任一 matching ask 胜过 allow，allow 只在没有 deny/ask match 时生效。
- [x] 定义 MCP call arguments 只作为 prompt/audit payload；arguments 不得序列化进 permission allow/ask/deny keys。
- [x] 定义 Claude Code-style server/tool name normalization：非法字符替换为 `_`，生成 `mcp__<server>__<tool>`，并在 `mcpInfo` 保留原始 server/tool names 用于 logging/calls。
- [x] 定义简单 collision 行为：user/global config resolution 先产出 effective `mcp.servers` map；builtin/static tools 先占用 names；随后 MCP bindings 按 normalized server id 和 normalized tool name 的稳定顺序处理。两个 MCP bindings 生成同一个 `mcp__<server>__<tool>` name 时，保留第一个 binding，suppress 后续 duplicates。Suppressed duplicates 只进入 internal runtime snapshots/debug logs；不暴露给模型、不写入 user config、Phase 1A 不用 hash suffix 或 alias 自动修复。Claude Code tool names 使用 normalized `mcp__<server>__<tool>` 并保留原始 `mcpInfo`；connector/server-name 层可能有 human-readable numeric suffix，但 Formax Phase 1A 不需要 hash aliases。
- [x] 定义 Claude Code-style MCP result mapping 到现有 `ToolResult`：text 保持 text，`structuredContent` 变 JSON text，images/audio/non-image blobs 保存为文件并返回 path text，resource links 只返回 placeholder text 且不注入 body，所有大输出/二进制输出都必须 bounded。
- [x] 定义 Phase 1A result bounds：text 和 JSON-stringified `structuredContent` 使用 Claude Code 对齐的 MCP output budget：默认 `MAX_MCP_OUTPUT_TOKENS = 25_000`，第一版允许在 mapper 里先用 `maxTokens * 4` 作为字符预算，直到 Formax 有 token estimator。截断输出必须追加明确 marker，并写明 token limit。Binary/blob payloads 永远不 inline/base64 发给模型；Formax Phase 1A 本地安全边界允许 `10 MiB` 以内的 blobs 写入 manager-owned `mcp-output/<session-id>/` 目录，并放在 `cfg.paths.logsDir` 下。更大的 blobs 返回带 size metadata 的 error text result，不写文件。
- [x] 定义 image handling：Phase 1A generic `ToolResult` mapping 不发 provider image blocks，也不发 raw image base64；images 走和其他 blobs 相同的 file-backed path flow；provider-native image blocks 延后到 adapter-specific non-text payload path 存在后再做。
- [x] 定义 file-backed output persistence：写到 logsDir 下的 MCP output files 归 runtime/session artifact scope 所有，并在 manager disposal/query close 后保留，因为 transcript rows 会引用这些 path。自动清理延后到未来明确 retention policy。
- [x] 添加 SDK-backed real transports 前，先定义 fake client interfaces。
- [x] 定义薄 SDK transport adapter 边界：config parsing 产出 normalized transport configs；Phase 1A manager activation 只创建 `StdioClientTransport` 或 `StreamableHTTPClientTransport`。
- [x] 定义 startup/connect side-effect 边界：真实 stdio spawn 或 Streamable HTTP connect 只能发生在 scoped MCP server manager/transport activation path 中，且 active host-provided config 来源为 REPL user/global `config.json` 和 SDK explicit overlay。
- [x] 定义 activation/listTools side-effect 边界：manager activation 负责对 enabled servers connect、initialize、list tools；tool catalog building 只读 already-discovered metadata；第一次 MCP tool call 可以 reuse existing client，但不得作为 initial discovery path。

### 1.3 Types / Interfaces
- [x] 在 `packages/core/src/mcp/` 下新增 pure MCP types。
- [x] 新增 name helpers 构造和解析 `mcp__<server>__<tool>`，但执行真实调用时不能依赖 split parsing 作为唯一依据。
- [x] 新增 config parser，用于 SDK/session overlay input 和 persisted `config.json` shape，并产出单一 normalized internal `McpServerConfig` model。
- [x] REPL runtime manager inputs 来自 user/global runtime config `mcp.servers`；SDK runtime manager inputs 只来自 explicit SDK/session overlay。
- [x] 新增 result mapper，遵循 Claude Code-style plain mapping：text passthrough、`structuredContent` JSON stringify、MCP output token cap 默认 `25_000` tokens 并用 `tokens * 4` 近似字符截断、file-backed blobs/images <=10 MiB 并返回 path text、larger blobs stable error、resource links 作为不含 body 的 placeholder text、file-backed artifacts 持久保留。
- [x] 新增 manager/client abstractions，并用 fake-client-backed tests 覆盖。
- [x] 新增一个 MCP `ToolHandler`，通过 manager dispatch 已知 MCP tool names。
- [x] 新增 shared catalog resolver helpers，让 REPL/app-server/SDK 一致合并 builtin tools 和 MCP tools。

### 1.4 语义决策表
| 决策 | 接受规则 | 来源 | 拒绝 / 延后的替代方案 | Contract 目标 | 测试含义 |
|---|---|---|---|---|---|
| MCP 架构 | Hybrid：dynamic catalog + 一个 MCP dispatch handler，并接入现有 direct/deferred exposure modes | User-aligned；WebGPT-reviewed；Formax-existing tool runtime | 单一 broker tool；global registry patch；per-tool static modules；MCP-specific search tool | `mcp-client`, `tool-runtime`, `prompt-tool-exposure` | MCP tools 以普通 `ToolDefinition` 出现，但通过一个 handler 执行 |
| Phase 1 transport model | 从第一天使用 `@modelcontextprotocol/sdk` transports：`stdio` 和 Streamable HTTP `type: "http"`；Phase 1A 拒绝 legacy `sse`，但为后续 compatibility scope 保留 discriminant | MCP SDK/spec-derived；User-aligned | 手写 JSON-RPC transport；stdio-only types 导致后续 union 返工；legacy SSE 作为主路径 | `mcp-client`, `config-settings`, `permissions-policy` | parser 接受/normalize stdio/http shapes，拒绝 sse；runtime 只在 manager activation 创建 SDK transports；SDK 不读 disk config |
| Config storage | persisted MCP config 存在现有 `config.json` 的 `mcp.servers` 下；Phase 1A REPL 只读 user/global config，repo-local project MCP config 先忽略直到有 trust gate；SDK explicit overlay 与 REPL 跨 transports 共享 parser/schema | User-aligned；Formax-existing config system；safety review | 单独 `.mcp.json`；runtime 先 ship 后再设计 storage；SDK 读取 local config files；没有 trust gate 就激活 repo-local MCP config | `config-settings`, `mcp-client` | REPL user/global config 可激活支持的 transports；SDK overlay 可激活支持的 transports；单纯 parsing 不启动/list/connect servers |
| Discovery | MCP tools 是和现有 tools 同层级的 dynamic tools。direct exposure mode 下可以进入 initial provider tools；global deferred mode 下像其他 deferred catalog tools 一样进入现有 deferred exposure runtime | User-aligned；Formax-existing prompt/tool exposure | MCP-only always-deferred 行为；MCP-specific search tool；broker-only tool | `prompt-tool-exposure` | direct mode 可暴露 `mcp__*`；deferred mode 通过现有 deferred 机制加载 `mcp__*` |
| Naming | `mcp__<server>__<tool>`，简单 normalization，保留原始 `mcpInfo`。Builtins 先占用 names；MCP duplicates 按 normalized server/tool 稳定顺序 suppress，diagnostics 只保留 internal。Formax Phase 1A 不增加 hash aliases | Claude Code-derived；User-aligned | Hash suffix；alias registry；复杂 collision resolver | `mcp-client`, `tool-runtime` | duplicate names 不 crash，也不静默覆盖 builtins；diagnostics 解释 dropped/hidden MCP tools |
| Tool permission | MCP tool calls 使用现有 tool permission / approval flow，key 为 fully-qualified tool name。默认 interactive path prompt；remember 默认 `mcp__<server>__<tool>`，不包含 arguments | Claude Code-derived；Formax-existing permissions；User-aligned | 复用 `Bash(...)` command matching；`net.fetch`；trust annotations；default allow；独立 `mcp.server.start` approval action；默认 argument-exact remember | `permissions-policy` | MCP calls 在 interactive main path prompt；non-interactive/subagent 在没有匹配 allow 时 deny；remembered same-tool 不因不同 args 再 prompt |
| Server startup/connect | Startup/connect 是 host/runtime config activation，不是 model tool call。Phase 1A 只从 REPL user/global config 和 SDK explicit overlay 激活支持的 transports。Activation 不能由 model output、REPL command、app-server RPC、Web UI、config parsing、catalog construction、deferred exposure resolution、status reads、dry-run 触发 | Claude Code-derived startup timing；User-aligned entrypoint boundary；safety review | Model/chat-created startup config；没有 trust gate 就激活 repo-local project MCP config；SDK local-file reads；manager lifecycle 外 activation | `mcp-client`, `config-settings`, `permissions-policy` | parser/catalog/status tests 断言没有 client spawn/connect/list side effects；REPL startup path 是唯一 disk-backed activation path；SDK activation 只来自 explicit overlay |
| Result mapping | 遵循 SDK/Claude Code-style result mapping，并采用 Phase 1A bounds：text/JSON 由 MCP output budget 限制，默认 25,000 tokens，第一版用 `tokens * 4` 近似字符截断；blobs/images file-backed up to 10 MiB under logsDir-owned output dir；resource bodies 不注入；file-backed artifacts 在 manager/query disposal 后保留 | Claude Code-derived text/token cap；Formax-Phase-1 safety choice for byte/file caps | Raw base64/blob injection；custom structured AST；automatic resource context injection；generic `ToolResult` 里的 provider image blocks；unbounded output | `tool-runtime`, `mcp-client` | mapper 不发 unbounded raw binary payloads；media 降级为 file-backed/text output；resource bodies 不进 prompt；oversized blobs 返回 stable errors；transcript paths 在 shutdown 后仍有效 |
| SDK controls | 支持 strict `options.mcpServers` explicit overlay 子集；Phase 1A 中 SDK MCP control methods 保持 unsupported，包括 `query.mcpServerStatus()` | Formax-existing unsupported control surface；User-aligned | Phase 1A 做 live set/status/reconnect/toggle；SDK 读取 local config | `mcp-client`, SDK matrix | overlay query tools 可暴露；control methods 继续返回 stable unsupported errors |

### 1.5 EntryPoint Matrix
| EntryPoint | Reads config? | Activates runtime? | Exposes capability? | UI/transcript behavior | Tests |
|---|---|---|---|---|---|
| REPL | 是：user/global `config.json` `mcp.servers`；repo-local project MCP config 先忽略直到有 trust gate | 是：runtime/session setup 后后台 manager activation | 是：discovery 后 MCP dynamic tools 进入当前 active tool exposure mode | generic REPL/TUI MCP presenter；不做 `/mcp` management UI | config activation、manager、exposure、permissions、generic presenter |
| SDK | 不读 local config；public `options.mcpServers` 支持 strict explicit overlay 子集 | 是：第一次 model request 前 await query/session manager activation | 是：通过 shared runtime 暴露 supported overlay MCP tools | 无 MCP management UI；live control methods 保持 unsupported | SDK query overlay、unsupported controls、cleanup |
| app-server | 不读 local MCP config；只传 explicit empty MCP overlay | 否：Phase 1A 不 manager activation、connect、initialize、listTools | 否：Phase 1A 不暴露 MCP tools | 无 management UI；无 read-only status events | empty overlay、不读 config、不 activation、不暴露 MCP tools |
| Web | 不读 MCP config | 不激活 MCP | 只展示 supported backend paths 产生的 MCP transcript events；不暴露/管理 servers | generic `mcp__*` tool block renderer；无 management UI | generic MCP tool block renderer |
| Electron | Phase 1A 无 Electron-specific MCP config reads | Phase 1A 无 Electron-specific activation | 无 Electron-specific MCP management/exposure path | 仅使用现有 surfaces；无 management UI | 由 shared app-server/Web/REPL tests 覆盖；Phase 1A 无单独 Electron MCP tests |

### 1.6 Review finding triage policy
- [x] 每个 review finding 分类为 `true blocker`、`valid but later-loop`、`spec ambiguity`、`reviewer preference`、`conflicts with accepted contract`。
- [x] 当前 loop 内只修 true blockers、accepted contract violations、或 localized low-risk implementation bugs。
- [x] later-loop findings 绑定到 future loop 或 backlog item。
- [x] spec ambiguity 时停止实现，先更新 contracts/todo 或询问用户。
- [x] reviewer preference 默认不采纳，除非它低风险、局部、且不改变行为或 scope。
- [x] contract conflicts 不实现；引用 accepted contract，并在需要时加 focused regression test。
- [x] 只有 triage 已记录且 targeted tests 通过后才重新 review。

## 2. Runtime / Platform
- [x] 新增 `packages/core/src/mcp/types.ts`。
- [x] 新增 `packages/core/src/mcp/names.ts`。
- [x] 新增 `packages/core/src/mcp/config.ts`。
- [x] 新增 `packages/core/src/mcp/resultMapper.ts`。
- [x] 新增 MCP client internal interface 模块。
- [x] 新增 deterministic fake MCP client 模块，用于 manager tests。
- [x] 新增 MCP server manager 模块。
- [x] 新增 MCP tool binding 模块。
- [x] 新增 `packages/core/src/mcp/toolCatalog.ts`。
- [x] 新增 MCP SDK transport adapter 模块，在 fake-client semantics 锁定后作为 `@modelcontextprotocol/sdk` transports 的薄 adapter。
- [x] 新增 `packages/core/src/tools/modules/mcp/{index,handler,presenter}.tsx`，在 REPL/TUI 中为所有 `mcp__*` tools 提供一个 Claude Code-style generic MCP presenter。
- [x] 新增 shared catalog resolver code，用于 builtin specs + MCP dynamic specs。
- [x] 在 runtime bootstrap（`packages/core/src/runtime/bootstrap/tooling.ts`）注册 manager-bound MCP handler module，而不是放进静态 builtin module registry。
- [x] 更新 REPL/TUI tool presenter routing/registry，让动态 `mcp__*` tool names resolve 到 generic MCP presenter，而不是每个 MCP tool 注册一个 presenter。
- [x] contract 定义 MCP tool-name permission behavior 后，再更新 permission/preflight/approval code；不要新增 `mcp.call` `PolicyAction`。
- [x] 确保所有 MCP lifecycle cleanup 尊重 abort/query close/scope disposal。

## 3. Entrypoint Boundary
- [x] REPL 把 user/global runtime config `mcp.servers`、session scope、cwd、runtime inputs 传入 shared MCP catalog helpers。
- [x] Phase 1A app-server 把 thread scope/cwd/runtime inputs 加 explicit empty MCP overlay 传入 shared MCP catalog helpers。
- [x] SDK 只把 query/session overlay 和 control calls 传入 shared MCP manager；不拥有单独 MCP executor。
- [x] SDK/query runner 创建并关闭 query/session-scoped manager，但 naming、config parsing、catalog、dispatch、policy、result mapping 保留在 shared MCP/runtime modules。
- [x] Phase 1A app-server 不从 local config 读取 `mcp.servers`，不创建/activate MCP manager，不 connect/list tools，不暴露 MCP tools。它只用 empty overlay 保持 shared resolver type/shape。
- [x] Phase 1A 不做 Web/Electron MCP management UI。
- [x] Web transcript 行为要独立于 REPL/TUI 定义：在 `packages/web-reference-react/src/components/tool/toolBlocksRegistry.ts` 增加 generic `mcp__*` renderer；MCP transcript rows 不依赖 default fallback rendering。
- [x] Phase 1A 不做 app-server MCP management RPC。
- [x] Phase 1A 不增加 app-server/Web read-only MCP status events。

## 4. Tests
- [x] 新增 `packages/core/src/mcp/names.test.ts`。
- [x] 新增 `packages/core/src/mcp/config.test.ts`：接受 SDK/session 和 persisted `config.json` 的 `stdio`/`http` shapes；拒绝 legacy/unsupported transports 和 unsupported auth modes；确保 parsing alone 不 instantiate clients、不 starts/connects/list tools；区分 REPL disk-backed activation 和 SDK overlay-only 行为。
- [x] 新增 `packages/core/src/mcp/resultMapper.test.ts`：映射 text/errors；JSON-stringify `structuredContent`；text/JSON 按 MCP output budget 截断，默认 25,000 tokens，用 `tokens * 4` 近似字符预算并加 marker；images/audio/non-image blobs <=10 MiB 保存文件并返回 path text；larger blobs 返回 stable error text；resource links 映射为不含 body 的 placeholder text；永不 raw base64/blob injection。
- [x] 增加 manager/query disposal tests，断言 file-backed MCP artifacts 在正常 shutdown 后仍可用于 transcript path inspection。
- [x] 新增 MCP server manager tests。
- [x] 新增 MCP tool binding tests：stable binding、simple normalization、builtin-name reservation、按 normalized server/tool 顺序 suppress duplicates、suppressed duplicates 的 internal diagnostics、保留原始 `mcpInfo`，Phase 1A 不出现 hash suffixes 或 alias registry。
- [x] 新增 `packages/core/src/mcp/toolCatalog.test.ts`：只消费 already-discovered metadata，永不 connect/start servers。
- [x] 增加 MCP exposure tests：direct exposure mode 可以把 `mcp__*` 放进 provider tools；global deferred mode 可以通过现有 deferred 机制暴露/加载 `mcp__*`。
- [x] 在 `packages/core/src/adapters/permissions/matcher.test.ts` 增加 MCP cases：`mcp__server__tool` exact match；`mcp__server` / `mcp__server__*` match server-level MCP tools；arguments 永远不进入 permission key；冲突沿用现有 `deny > ask > allow` 顺序，而不是 specificity。
- [x] 在 `packages/core/src/tools/executor/index.test.ts` 增加 MCP cases：`PreToolUse` 收到完整 `mcp__server__tool`，可在 client call 前 block；`PostToolUse` 在 success/error 后仍运行。
- [x] 在 `packages/core/src/tools/executor/policyPreflight.test.ts` 增加 MCP cases：默认 interactive MCP tool call prompts；remembered fully-qualified MCP tool 对不同 call arguments 仍允许；deny/ask wins；non-interactive/subagent fail closed without pending approval。
- [x] 在 `packages/core/src/tools/executor/approvalService.test.ts` 增加 MCP approval side-effect cases：`approve_remember` 写入/记住 exact fully-qualified MCP tool name，不记 arguments；hand-authored server/wildcard rules 可匹配但不自动生成。
- [x] 增加 REPL/TUI MCP presenter/router tests：任意 `mcp__server__tool` transcript row 使用 generic MCP presenter，展示 normalized server/tool identity 和 concise params/result summary，malformed names clean fallback。
- [x] 增加 Web transcript MCP test：`mcp__server__tool` 使用 generic MCP tool block renderer，且不增加 MCP management UI。
- [x] runtime 可用后，在 `packages/core/src/sdk/query.test.ts` 增加 SDK MCP cases。
- [x] 增加 app-server Phase 1A tests，断言 empty MCP overlay behavior：initialize 不解析 local MCP config、不 manager activation/connect/listTools、不暴露 MCP tools，shared resolver shape 仍接受 empty overlay。
- [x] 本任务不跑 coverage。

## 5. 推荐执行顺序

### Loop 1 — Contracts and Review Scope

#### Loop Contract
- Purpose：runtime code 前锁定 MCP Phase 1A 语义。
- In scope：canonical docs、SDK matrix，无实现。
- Out of scope：code behavior changes、stdio process spawning、SDK validation changes。
- Blocking findings：任何 safety default、lifecycle owner、tool exposure ambiguity。
- Non-blocking / later-loop findings：UI management、advanced resources/prompts UX、resource templates、elicitation bridge、rich media polish。这些不是 “Claude Code 没做” 的结论；其中有些是 Claude Code 已有能力，但 Formax 明确 defer。
- Known unresolved semantics：Phase 1A public SDK MCP status 没有未决语义；`query.mcpServerStatus()` 保持 unsupported。
- Required targeted tests：无，documentation-only loop。
- Review prompt scope：review contracts 的 safety 与现有 tool/prompt/policy contracts 一致性。
- Exit criteria：contracts 清晰到足以实现 pure helpers。

- [x] 新增 `docs/contracts/mcp-client-contract.md`。
- [x] 更新 tool runtime、prompt/tool exposure、permissions/policy、hooks、config contracts。
- [x] 锁定 Phase 1A startup authority：REPL user/global runtime config 可授权 disk-backed server startup；SDK explicit overlay 授权 SDK-scoped server startup；MCP tool-call approval 永远不授权或暗示 server startup。
- [x] 锁定 activation timing：REPL 在 runtime/session setup 后后台启动 MCP manager activation，不阻塞首屏，也不保证首轮 MCP 可用；one-shot SDK/non-interactive activation 对 explicit overlay config 在第一次 model request 前 await。
- [x] 锁定 side-effect-free phases：config parsing、name normalization、pure catalog mapping、status reads、deferred exposure resolution、dry-run 都不能 spawn/connect/list tools。
- [x] 锁定 persisted config storage：MCP config 属于现有 `config.json` 的 `mcp.servers`，不是单独 MCP config file。
- [x] 锁定 disk activation boundary：REPL 可把 user/global `mcp.servers` 传入 active runtime manager；repo-local project MCP config 先忽略，直到有 project trust gate；SDK 不能读取或喂入 user/project local config files。
- [x] 锁定 no-startup-approval rule：Phase 1 不增加 `mcp.server.start` 独立 approval action；未来 persisted activation 应作为显式 config behavior 处理。
- [x] 锁定 MCP exposure/executor parity：MCP metadata 转成 `ToolDefinition` 后，MCP tools 像其他 tools 一样遵守现有 active exposure mode 和 executor `allowTools`/`denyTools` 行为；不定义 MCP-specific visibility、not-loaded 或 fallback errors。
- [x] 锁定 MCP tool-name allow/remember semantics：remember 默认 fully-qualified tool name；server/wildcard rules 是 explicit hand-authored permissions；matching 排除 individual call arguments。
- [x] 锁定 MCP permissions 是现有 tool permission / approval flow 的扩展，不是 parallel MCP permission system。
- [x] 更新 SDK contract alignment matrix。
- [x] 继续前先 triage review findings。
- [x] document verification 通过后运行 `codex review`。

### Loop 2 — Pure Types, Naming, Config Overlay, Result Mapping

#### Loop Contract
- Purpose：增加无 process I/O、无 entrypoint 行为变化的 pure MCP definitions。
- In scope：types、name normalization、SDK/session config parser、persisted config shape/parser、transport-discriminated config model、tool spec mapping、result mapper。
- Out of scope：real MCP protocol、stdio spawn、registry/executor wiring、REPL activation。
- Blocking findings：nondeterministic names、fail-open config parsing、raw binary/provider payload emission。
- Non-blocking / later-loop findings：duplicates 造成痛点时再做 explicit alias UX、provider-native media polish、app-server/Web activation/UX。
- Known unresolved semantics：Phase 1A truncation thresholds 没有未决语义；threshold changes 需要后续 contract update。
- Required targeted tests：pure MCP unit tests。
- Review prompt scope：确认 pure helpers 符合 Loop 1 contracts 且不引入 side effects。
- Exit criteria：pure tests pass，且没有 runtime entrypoint 能观察到 MCP。

- [x] 增加 pure MCP types。
- [x] 增加 deterministic name normalization 和 parsing helpers。
- [x] 增加 simple normalization，并按 normalized server/tool 顺序做 duplicate-name suppression 与 internal diagnostics。
- [x] 增加 SDK/session overlay config parser 和 persisted `config.json` parser，支持 transport-discriminated `stdio` + `http` config model。
- [x] 增加 persisted `config.json` MCP shape parser for `mcp.servers`，复用 normalized server config model。
- [x] 增加 MCP tool 到 Formax `ToolDefinition` 的 mapping。
- [x] 增加 MCP result 到 `ToolResult` 的 mapping。
- [x] 断言 SDK active runtime resolution 忽略 user/project MCP config sources in Phase 1A。
- [x] 断言 persisted `config.json` shape validation 是 pure，且不暗示 explicit REPL startup path 之外的 activation。
- [x] 断言 config parsing 对 `stdio`/`http` 都不 instantiate SDK transports/clients、不 spawn、不 connect、不 initialize、不 list tools、不 call tools、不 mutate manager state。
- [x] 断言 pure tool definition/catalog mapping 只消费 already-provided MCP metadata，永不 start server。
- [x] 断言 roots behavior 是 single-root only：client capability 对 `ListRoots` 只返回当前 runtime `cwd` root，不 advertise 或 negotiate multiple roots。
- [x] 断言 status projection helpers read-only 且 side-effect-free。
- [x] 运行 targeted pure MCP tests。
- [x] 继续前 triage review findings。
- [x] targeted verification 通过后运行 `codex review`。

### Loop 3 — Fake-Client MCP Runtime Manager

#### Loop Contract
- Purpose：用 fake MCP client 证明 lifecycle、tool discovery、binding、call dispatch、status、client cleanup。
- In scope：internal client interface、fake client、scoped manager、tool binding、fake-backed handler execution helper。
- Out of scope：stdio transport、SDK public behavior、REPL/app-server wiring、policy side effects。
- Blocking findings：cross-scope leakage、stale binding execution、missing cleanup、manager owning `cwd` incorrectly。
- Non-blocking / later-loop findings：idle TTL、richer diagnostics、live reconnect/toggle。
- Known unresolved semantics：本 loop 不定义 public status；runtime snapshots 仅 internal。
- Required targeted tests：manager、binding、fake client、client cleanup、manager call cancellation。
- Review prompt scope：确认 manager scope 和 lifecycle 可被 REPL/app-server/SDK 复用。
- Exit criteria：fake manager 可在无 process I/O 下 list/call MCP tools。

- [x] 增加 internal MCP client interface。
- [x] 增加 fake client implementation for tests。
- [x] 增加 scoped server manager。
- [x] 增加 binding map 和 stable catalog generation。
- [x] 增加 manager runtime snapshot 和 cleanup behavior。
- [x] 增加 fake-backed call dispatch，返回 `ToolResult`。
- [x] 断言 manager 在 SDK runner 外拥有 lifecycle：SDK 允许创建/关闭 manager scope，但 shared MCP modules 拥有 naming、binding、catalog、dispatch、result mapping。
- [x] 断言 manager runtime snapshots 只读 existing state，不 start、reconnect、initialize、list tools 或 call tools。
- [x] 断言 unknown/stale bindings 返回 stable `ToolResult` errors，且不 call fake client。
- [x] 运行 targeted MCP manager/binding tests。
- [x] 继续前 triage review findings。
- [x] targeted verification 通过后运行 `codex review`。

### Loop 4 — Catalog, Executor, and Policy Wiring

#### Loop Contract
- Purpose：使用 fake-backed manager，让 MCP tools 通过现有 Formax tool runtime 可见且可调用。
- In scope：MCP tool module、shared catalog merge、direct/deferred exposure integration、MCP tool-name permission rules、preflight default behavior。
- Out of scope：real stdio transport、SDK public unlock、app-server management RPC。
- Blocking findings：MCP bypass executor/policy/hooks/audit、MCP-only discovery path、non-interactive prompt deadlock。
- Non-blocking / later-loop findings：app-server/Web activation、UI status。Web management UI 仍 out of scope；Web transcript rendering 由 generic `mcp__*` renderer 覆盖。
- Known unresolved semantics：MCP-specific exposure 或 fallback 没有未决语义；MCP 复用现有 Formax exposure 和 executor rules。
- Required targeted tests：catalog/exposure resolver、executor、policy preflight；如果 catalog merging 改 request tools，还要 chat engine tests。
- Review prompt scope：确认 MCP calls 是普通 tool calls，且受 policy 保护。
- Exit criteria：fake MCP tools 可在 direct mode 暴露、在 deferred mode 加载，并且只能通过 executor/policy 调用。
- Review triage：
  - 已修 review blocker：runtime bootstrap 现在注册 manager-bound MCP module，所以 MCP handlers/presenters/catalog patching 已进入真实 `ToolRegistry`。
  - 已修 review blocker：unknown/stale `mcp__*` names 在 `PermissionRequest` hooks 或 approval UI 前直接 rejected。
  - 已修 review blocker：SDK approval suggestions 现在包含 `tool.name`/MCP add-rule suggestions，所以 SDK `canUseTool` remember flow 可以 round-trip 到 `approve_remember`。
  - 已修 review blocker：MCP approval 的 `updated_input_json` 会先按 MCP tool input schema 校验，再允许 mutation call input。
  - 已修 review blocker：普通 runtime 现在创建真实 `McpServerManager`，接入 SDK-backed client factory，把 manager 传进 `ToolRegistry`，并在 runtime setup 后后台启动 REPL activation。
  - 已修 review blocker：REPL MCP activation 不再阻塞 runtime bootstrap/首屏；首轮是否已经有 MCP tools 取决于后台 discovery 是否完成。

- [x] 增加 MCP tool module，包含一个 dispatch handler。
- [x] 增加一个 Claude Code-style generic MCP tool presenter for REPL/TUI；不要为每个 MCP server tool 创建 presenter files/modules。
- [x] 增加 Web `toolBlocksRegistry` generic `mcp__*` renderer；MCP calls 不依赖 default renderer fallback。
- [x] 增加 shared resolver：先合并 builtin tools 和 MCP dynamic tools，再应用当前 direct/deferred exposure mode。
- [x] direct exposure mode 下，允许 MCP dynamic tools 像其他可用 tools 一样进入 provider tools。
- [x] 任意 exposure mode 下，MCP dynamic tools 都通过与其他 tools 相同的 resolver/executor allow-list flow；不增加 MCP-specific fallback、not-loaded 或 allow/deny behavior。
- [x] 在 unknown tools fall through `toolCallToPolicyAction(...)=null` 前增加 MCP tool-name preflight branch：`mcp__*` calls 在 interactive main path 默认 prompt，在 subagent/non-interactive deny，并按 tool name 查询 permissions。
- [x] 使用 fully-qualified MCP tool name 把 MCP tool calls 路由到现有 approval UI/service，不新增 `mcp.call` policy action。
- [x] 增加 permission matching，支持 fully-qualified MCP tool rules 和 explicit hand-authored server-level `mcp__server` / wildcard `mcp__server__*` rules，复用现有 matcher precedence（`deny > ask > allow`），不增加 MCP-specific specificity ordering。
- [x] 增加 MCP tool calls 的 interactive prompt default 和 non-interactive/subagent deny behavior。
- [x] 确保 MCP annotations 永不降低 policy。
- [x] 确保 `PreToolUse`、`PermissionRequest`、`PostToolUse`、audit payloads 携带完整 qualified MCP tool name。
- [x] 运行 targeted catalog/exposure/executor/policy tests。
- [x] 继续前 triage review findings。
- [ ] targeted verification 通过后，复跑 `codex review`。

### Loop 5 — SDK Transport Adapter and Lifecycle

#### Loop Contract
- Purpose：用 SDK-backed transports 替换 fake client，并保持同一个 manager interface。
- In scope：dependency decision、thin SDK transport adapter、stdio 和 basic Streamable HTTP (`type: "http"`) SDK transports、connect/list tools/call tool/close、timeouts、cleanup。
- Out of scope：app-server/Web activation、OAuth browser flow、sampling、resource templates、elicitation UI、Web UI。
- Blocking findings：shell injection、inherited secrets、orphan child processes、unbounded output、query abort 时未 close。
- Non-blocking / later-loop findings：reconnect controls、idle TTL、advanced diagnostics。
- Known unresolved semantics：Phase 1A dependency strategy 没有未决语义；如果 official SDK dependency 被拒绝，必须停止，不能手写 protocol details。
- Required targeted tests：SDK transport adapter、stdio fake server fixture、basic HTTP transport fixture 或 mocked SDK transport、cleanup、timeout、error status。
- Review prompt scope：确认 SDK transport use 保持 thin，product glue 不重写 MCP protocol details。
- Exit criteria：stdio 和 basic HTTP MCP servers 可在 controlled tests 中通过 SDK `Client.connect(transport)` list/call tools，并可靠 close。

- [x] 增加 official MCP TypeScript SDK dependency。
- [x] 增加 thin SDK transport adapter，把 normalized config dispatch 到 SDK `StdioClientTransport` 或 `StreamableHTTPClientTransport`。
- [x] 增加 SDK `Client` wrapper：connect/list tools/call tool/close 和 capability/status extraction。
- [x] 增加 controlled stdio MCP server fixture for tests。
- [x] 在 adapter boundary 增加 mocked Streamable HTTP transport tests；Phase 1A 不要求真实 HTTP server fixture。
- [x] 将 SDK client adapter 接入 manager。
- [x] 断言 stdio spawn 和 HTTP connect 只能发生在 scoped manager/transport activation path，不能来自 config parser、tool catalog、exposure resolver、status reads、SDK validation、dry-run。
- [x] 断言 manager activation 对 enabled servers 执行 connect/initialize/listTools，并记录 failed/pending state；failed servers 不暴露 tools。
- [x] 断言 catalog construction 只使用已有 manager tool metadata，永不调用 connect/initialize/listTools。
- [x] 断言 stdio startup 使用 executable + argv，不做 shell string interpolation。
- [x] 断言 stdio startup 只继承 MCP SDK safe default environment 加低敏 runtime env allowlist，并应用 per-server explicit `env` overrides；不能把无关 parent-process secrets 泄露给 child process、model-facing output 或 audit。
- [x] 增加 timeouts 和 bounded result handling。
- [x] 限制 stdio protocol/output handling：stdout 交给 SDK protocol stream，stderr 改为 pipe/drain 而不是 inherit，MCP result payloads 有边界。
- [x] 确保 startup/list-tools timeout 产生 failed status，且没有 dynamic tools。
- [x] stdio transport tests 使用 explicit fixtures；为 project/global persisted config files 增加单独 REPL activation tests。
- [x] 在 manager scope disposal、query close/interruption、process shutdown path 增加 lifecycle handling，但保留 transcript 引用的 file-backed MCP artifacts。
- [x] 运行 targeted SDK transport lifecycle tests。
- [x] 继续前 triage review findings。
- [ ] targeted verification 通过后运行 `codex review`。

### Loop 6 — SDK Surface and Shared Entrypoint Polish

#### Loop Contract
- Purpose：通过 REPL config activation、SDK overlay、shared entrypoint wiring 暴露经过测试的 Phase 1A MCP runtime。
- In scope：REPL user/global `config.json` activation、SDK explicit `options.mcpServers` overlay activation、app-server explicit empty MCP overlay 的 shared resolver shape。
- Out of scope：live dynamic MCP controls、REPL `/mcp` 或 status command、app-server/Web activation/UX、Web management UI。
- Blocking findings：SDK-only MCP path、entrypoint parity drift、unsupported methods silently no-op、session cleanup leaks。
- Non-blocking / later-loop findings：app-server status notification、REPL slash command、app-server/Web activation/UX。
- Known unresolved semantics：Phase 1A public SDK MCP status 没有未决语义；`query.mcpServerStatus()` 保持 unsupported。
- Required targeted tests：SDK query tests、如果 touched 则 REPL/app-server resolver tests、cleanup tests。
- Review prompt scope：确认 public surface 符合 contracts 且不 over-promise。
- Exit criteria：REPL 从现有 config resolution 读取 user/global `mcp.servers` 并忽略 repo-local project MCP config；enabled runtime transports 通过 shared runtime 工作；app-server 保持 empty-overlay/no-activation；public SDK `options.mcpServers` 支持 strict explicit overlay 子集。

- [x] REPL runtime/session setup 把 user/global runtime config `mcp.servers` 传入 shared MCP manager，并后台启动 activation，不阻塞首屏。
- [x] 支持 public SDK `options.mcpServers` strict transport-aware explicit overlay shape。
- [x] Phase 1A 中 `strictMcpConfig` 和 live dynamic controls 保持 unsupported。
- [x] Phase 1A 中 SDK `query.mcpServerStatus()` 保持 unsupported，并沿用现有 stable unsupported error；Phase 1A 不增加 REPL status command/API；internal manager runtime snapshots 只允许用于 tests/diagnostics，且不得 start、reconnect、discover、list tools 或 call tools。
- [x] 通过 shared catalog helper types 接入 app-server，并传 explicit empty MCP overlay；Phase 1A 中 app-server config reads、activation、connection、listTools 和 MCP tool exposure 都保持 disabled。
- [x] 确保 query close/interruption dispose query-scoped MCP clients。
- [x] SDK/one-shot non-interactive MCP activation 对 explicit overlay path 在第一次 model request 前 await manager activation；live MCP control methods 继续返回 explicit unsupported errors。
- [x] 更新 SDK docs/matrix notes，说明 supported 和 unsupported MCP behavior。
- [x] 运行 targeted SDK 和 entrypoint tests。
- [x] 继续前 triage review findings。
- [ ] targeted verification 通过后运行 `codex review`。

## 6. Stop Conditions
- [ ] 如果团队希望 SDK 读取 user/project local MCP config files，停止。
- [ ] 如果 MCP tool-call default prompt 被否决且没有替代 safety model，停止。
- [ ] 如果 MCP tools 需要 MCP-specific exposure、allow/deny、fallback 或 not-loaded behavior，而不是复用现有 Formax tool runtime rules，停止。
- [ ] 如果 normalized MCP tool names 需要 Phase 1 做 alias/hash design，而不是 simple deterministic de-dupe，停止。
- [ ] 如果 result payloads 在 Phase 1A 需要 custom structured AST 或通过 generic `ToolResult` 传 provider media blocks，停止。
- [ ] 如果 MCP transport execution 不能使用 accepted SDK/dependency，且需要手写 protocol details，停止。
- [ ] 如果 non-interactive SDK behavior 需要在没有 `canUseTool`/exact allow support 时 prompt，停止。
- [ ] 如果 required MCP server 需要超过 single current runtime `cwd` root 的 roots，停止。

## 7. Phase 2 Backlog
- [ ] app-server/Web MCP config activation，通过 explicit config semantics。
- [ ] `/mcp` slash command 或 MCP management UI。
- [ ] App-server/Web/Electron MCP status 和 controls。
- [ ] OAuth 和 advanced Streamable HTTP session/reconnect UX，超出 basic SDK transport path 的部分。
- [ ] Legacy SSE transport compatibility 只放到单独 scope 的后续阶段。
- [ ] MCP resources 作为 explicit list/read tools，并可选支持 `@server:uri` attachment UX。
- [ ] MCP prompts 作为 slash commands，不作为 model tools。
- [ ] 超出 current cwd 的 advanced MCP roots negotiation。
- [ ] MCP elicitation bridge，包含 cancel/queue/UI semantics。
- [ ] MCP sampling bridge。
- [ ] MCP tasks / long-running operation integration。
- [ ] 比 Phase 1A file-backed image/audio/blob fallback 更广的 provider-native media/result support。
- [ ] Idle TTL 和 long-lived server health diagnostics。
