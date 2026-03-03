# Query Contract Alignment Matrix

更新时间：2026-03-03  
需求来源：`plans/claude-agent-sdk/claude-agent-sdk-exports-reference.md`（`query` 与 `Options` 章节）

## 目标与边界

- 目标：给出 `query` 相关外部契约的“官方导出 -> Formax SDK”一对一索引。
- 边界：只标记现阶段真实支持能力，不做未支持能力占位实现。
- 对齐策略：名称尽量对齐，语义以 Formax 现有稳定实现优先。

## Query 入口对齐

| 官方导出 | 官方形态 | Formax SDK 现状 | 状态 |
|---|---|---|---|
| `query(params)` | `prompt: string \| AsyncIterable<SDKUserMessage>` | `query({ prompt: string \| AsyncIterable<SDKUserMessage>, options? })` | Partial |
| `Query` 返回对象 | `AsyncGenerator + interrupt/setModel/...` 方法集 | 返回 `Query`（`AsyncGenerator<QueryMessage>` + `interrupt()` + `close()`）；其余方法暂未支持 | Partial |

说明：
- 当前已支持 `AsyncIterable<SDKUserMessage>`（user/text 子集）。
- `Query` 已支持 `interrupt()` 与 `close()`；其余 `Query` 对象方法（`setModel`/`supported*`/`mcp*` 等）暂不纳入一期范围。

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
| `maxThinkingTokens` | `options.maxThinkingTokens` | Partial | 输入契约已支持（含 `0`）；`thinking`/`thinkingEnabled` 优先，不做预算控制。 |
| `hooks` | - | Backlog | 当前不暴露。 |
| `canUseTool` | - | Backlog | 当前不暴露。 |
| `mcpServers` | - | Backlog | 当前不支持。 |
| `plugins` | - | Backlog | 当前不支持。 |
| `settingSources` | - | Backlog | 当前不支持。 |
| `resume`/`sessionId`/`resumeSessionAt` | `options.resume` / `options.sessionId` / `options.resumeSessionAt` | Partial | 输入契约已支持；当前统一显式报“暂不支持”。 |
| `agent`/`agents` | - | Backlog | 当前不支持。 |
| `tools`（preset 语义） | - | Backlog | 当前不支持官方 preset 形态。 |
| `sandbox` | - | Backlog | 当前不支持。 |
| `additionalDirectories` | - | Backlog | 当前不支持。 |
| `onElicitation` | - | Backlog | 当前仅提供 `onInputRequest`（Formax 语义）。 |
| `continue` | - | Backlog | 当前不支持。 |
| `persistSession`/`forkSession`/`enableFileCheckpointing` | - | Backlog | 当前不支持。 |
| `fallbackModel` | - | Backlog | 当前不支持。 |
| `permissionPromptToolName` | - | Backlog | 当前不支持。 |
| `allowDangerouslySkipPermissions` | - | Backlog | 当前不支持。 |
| `promptSuggestions` | - | Backlog | 当前不支持。 |
| `strictMcpConfig` | - | Backlog | 当前不支持。 |
| `debug`/`debugFile` | - | Backlog | 当前不支持官方 debug 字段。 |
| `stderr` | - | Backlog | 当前不支持。 |
| `pathToClaudeCodeExecutable`/`spawnClaudeCodeProcess` | - | Backlog | 当前不支持（Formax 为进程内实现）。 |
| `extraArgs`/`executable`/`executableArgs`/`betas` | - | Backlog | 当前不支持。 |

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
