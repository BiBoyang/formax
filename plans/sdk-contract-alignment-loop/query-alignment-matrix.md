# Query Contract Alignment Matrix

更新时间：2026-03-04  
需求来源：`plans/claude-agent-sdk/claude-agent-sdk-exports-reference.md`（`query` 与 `Options` 章节）

## 目标与边界

- 目标：给出 `query` 相关外部契约的“官方导出 -> Formax SDK”一对一索引。
- 边界：只标记现阶段真实支持能力，不做未支持能力占位实现。
- 对齐策略：名称尽量对齐，语义以 Formax 现有稳定实现优先。

## Query 入口对齐

| 官方导出 | 官方形态 | Formax SDK 现状 | 状态 |
|---|---|---|---|
| `query(params)` | `prompt: string \| AsyncIterable<SDKUserMessage>` | `query({ prompt: string \| AsyncIterable<SDKUserMessage>, options? })` | Partial |
| `Query` 返回对象 | `AsyncGenerator + interrupt/setModel/...` 方法集 | 返回 `Query`（`AsyncGenerator<QueryMessage>` + `interrupt()` + `close()` + `initializationResult()` + `supportedCommands()` + `supportedAgents()` + `supportedModels()` + `accountInfo()` + `mcpServerStatus()` + `setMcpServers()/reconnectMcpServer()/toggleMcpServer()` + `streamInput()/stopTask()/rewindFiles()` + `setModel()/setPermissionMode()/setMaxThinkingTokens()` 启动前覆盖） | Partial |

说明：
- 当前已支持 `AsyncIterable<SDKUserMessage>`（user/text 子集）。
- `Query` 已支持 `interrupt()`、`close()`、`initializationResult()`、`supportedCommands()`、`supportedAgents()`、`supportedModels()`、`accountInfo()`、`mcpServerStatus()/setMcpServers()/reconnectMcpServer()/toggleMcpServer()/streamInput()/stopTask()/rewindFiles()`（当前显式报未支持）、`setModel()`、`setPermissionMode()`、`setMaxThinkingTokens()`；其余 `Query` 对象方法（`supported*`/`mcp*` 等）暂不纳入一期范围。
- `supportedCommands()` 返回命令项同时包含 `name/argumentHint`（官方同名）与 `command/argHint`（Formax 兼容）字段。
- `supportedModels()` 返回模型项同时包含 `value/displayName/supportsEffort`（官方常用）与 `model/provider/supports_reasoning_effort`（Formax 兼容）字段。
- `setMcpServers()/rewindFiles()` 在当前能力下仍显式报未支持，但返回类型已与官方同名结果类型对齐。

## Options 对齐矩阵（官方 -> Formax）

状态说明：
- `Supported`：已支持且有测试覆盖。
- `Partial`：存在能力，但与官方形态/取值范围不完全一致。
- `Backlog`：当前不支持。

| 官方 `Options` 字段 | Formax 对应 | 状态 | 说明 |
|---|---|---|---|
| `abortController` | `options.abortController` | Supported | 与现有 `signal` 合并兼容。 |
| `allowedTools` | `options.allowedTools` | Supported | 已对齐。 |
| `cwd` | `options.cwd` | Supported | 已对齐。 |
| `disallowedTools` | `options.disallowedTools` | Supported | 已对齐。 |
| `env` | `options.env` | Supported | 已对齐。 |
| `includePartialMessages` | `options.includePartialMessages` | Supported | 已对齐。 |
| `model` | `options.model` | Supported | 已对齐。 |
| `outputFormat` | `options.outputFormat` | Partial | 目前仅 `json_schema` 子集。 |
| `permissionMode` | `options.permissionMode` | Partial | 接受官方全集；`default`/`acceptEdits`/`plan` 已落地，`dontAsk`/`bypassPermissions` 显式报“暂不支持”。 |
| `systemPrompt` | `options.systemPrompt` | Supported | 支持字符串与官方 preset 对象（`claude_code` + `append`）；另外扩展支持 PromptBlock 数组。 |
| `maxTurns` | `options.maxTurns` | Partial | 兼容入口已支持：`1` 通过，`>1` 显式报当前不支持。 |
| `maxBudgetUsd` | `options.maxBudgetUsd` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `thinking` | `options.thinking` | Partial | 支持 `adaptive/enabled/disabled`；`budgetTokens` 仅校验，不做预算控制。 |
| `effort` | `options.effort` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `maxThinkingTokens` | `options.maxThinkingTokens` | Partial | 输入契约已支持（含 `0`）；`thinking`/`thinkingEnabled` 优先，不做预算控制。 |
| `hooks` | `options.hooks` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `canUseTool` | `options.canUseTool` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `mcpServers` | `options.mcpServers` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `plugins` | `options.plugins` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `settingSources` | `options.settingSources` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `resume`/`sessionId`/`resumeSessionAt` | `options.resume` / `options.sessionId` / `options.resumeSessionAt` | Partial | `resume/sessionId` 已支持（基于本地持久化会话恢复历史）；`continue+sessionId` 在匹配最新会话或 `forkSession=true` 时支持；`resumeSessionAt` 仍显式报“暂不支持”。 |
| `agent`/`agents` | `options.agent` / `options.agents` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `tools`（preset 语义） | `options.tools` | Partial | 已支持：可作为 base-tool 过滤（数组子集 + `preset` 默认集）；`default` 不能与显式列表混用。 |
| `sandbox` | `options.sandbox` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `additionalDirectories` | `options.additionalDirectories` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `onElicitation` | `options.onElicitation` | Partial | 输入契约已支持；当前统一显式报“暂不支持”（继续使用 Formax `onInputRequest` 语义）。 |
| `continue` | `options.continue` | Partial | 已支持：读取当前 cwd 最新本地会话并恢复历史；如无历史则按新会话继续。 |
| `persistSession`/`forkSession`/`enableFileCheckpointing` | `options.persistSession` / `options.forkSession` / `options.enableFileCheckpointing` | Partial | 已支持：`persistSession=true` 可将 query turn 落盘到本地会话；`forkSession=true` 可将 `resume/continue` 历史重绑定到新 session；`enableFileCheckpointing=true` 触发持久化并写入历史快照。 |
| `fallbackModel` | `options.fallbackModel` | Partial | 已支持：在 in-process SDK 模式下作为兼容 no-op 参数接受。 |
| `permissionPromptToolName` | `options.permissionPromptToolName` | Partial | 已支持：在 in-process SDK 模式下作为兼容 no-op 参数接受。 |
| `allowDangerouslySkipPermissions` | `options.allowDangerouslySkipPermissions` | Partial | 部分支持：`false` 作为兼容 no-op；`true` 仍显式报“暂不支持”（不降权限安全语义）。 |
| `promptSuggestions` | `options.promptSuggestions` | Partial | 已支持：在 in-process SDK 模式下作为兼容 no-op 参数接受。 |
| `strictMcpConfig` | `options.strictMcpConfig` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `debug`/`debugFile` | `options.debug` / `options.debugFile` | Partial | 已支持：`debug=true` 通过环境变量开启 hook debug 路径；`debugFile` 作为调试日志文件输出路径。 |
| `stderr` | `options.stderr` | Partial | 已支持：作为 SDK 错误输出回调（在 query 错误路径写入）。 |
| `pathToClaudeCodeExecutable`/`spawnClaudeCodeProcess` | `options.pathToClaudeCodeExecutable` / `options.spawnClaudeCodeProcess` | Partial | 已支持：在 in-process SDK 模式下作为兼容 no-op 参数接受。 |
| `extraArgs`/`executable`/`executableArgs`/`betas` | `options.extraArgs` / `options.executable` / `options.executableArgs` / `options.betas` | Partial | 已支持：在 in-process SDK 模式下作为兼容 no-op 参数接受。 |

## Formax 扩展字段（非官方同名）

以下字段由 Formax SDK 提供，但不是官方 `Options` 同名字段：

| Formax 字段 | 说明 |
|---|---|
| `appendSystemPrompt` | 在 system prompt 末尾附加额外块。 |
| `signal` | 直接传入 `AbortSignal`。 |
| `interactive` | 控制是否允许交互输入请求。 |
| `onInputRequest` | 处理 `approval_request` 与 `ask_user_question`。 |
| `onMessage` | 每条 SDK 消息回调。 |
| `promptProfile` | Formax system prompt profile。 |
| `thinkingEnabled` | Formax 布尔 thinking 开关。 |
| `replMode` | Formax 内部执行模式。 |

## 路线结论（下一步优先级）

1. 优先补齐 query 输入契约对齐（已支持能力的同名字段优先）。
2. 保持“外部契约对齐 + 内部实现解耦”，不把未支持能力做成空壳 API。
3. 对 `Backlog` 字段只做文档标记，不在一期新增实现。
