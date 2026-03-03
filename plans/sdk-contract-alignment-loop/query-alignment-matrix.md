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
| `query(params)` | `prompt: string \| AsyncIterable<SDKUserMessage>` | `query({ prompt: string, options? })` | Partial |
| `Query` 返回对象 | `AsyncGenerator + interrupt/setModel/...` 方法集 | 直接返回 `AsyncGenerator<QueryMessage>`，不带方法集 | Backlog |

说明：
- 当前仅对齐“可迭代消息流”的核心能力。
- `Query` 对象方法（`interrupt`/`setModel`/`supported*`/`mcp*` 等）暂不纳入一期范围。

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
| `permissionMode` | `options.permissionMode` | Partial | 目前支持 `default`/`acceptEdits`/`plan`。 |
| `systemPrompt` | `options.systemPrompt` | Partial | 支持字符串/PromptBlock 数组，不支持官方 preset 对象。 |
| `maxTurns` | - | Backlog | 当前未提供 query 多轮上限参数。 |
| `maxBudgetUsd` | - | Backlog | 当前未支持。 |
| `thinking` | - | Backlog | 当前使用 `thinkingEnabled` 布尔开关（非官方字段）。 |
| `maxThinkingTokens` | - | Backlog | 当前未支持。 |
| `hooks` | - | Backlog | 当前不暴露。 |
| `canUseTool` | - | Backlog | 当前不暴露。 |
| `mcpServers` | - | Backlog | 当前不支持。 |
| `plugins` | - | Backlog | 当前不支持。 |
| `settingSources` | - | Backlog | 当前不支持。 |
| `resume`/`sessionId`/`resumeSessionAt` | - | Backlog | 当前 query 不支持官方会话恢复参数。 |
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
