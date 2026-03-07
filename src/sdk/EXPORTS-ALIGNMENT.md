# Formax SDK Exports Alignment (Phase 1)

当前对齐锚点：
- `src/sdk/api.ts`
- `src/sdk/index.ts`
- `src/sdk/query.ts`
- `src/sdk/query.test.ts`
- `src/sdk/query.options-alignment.test.ts`
- `src/sdk/v2.test.ts`

相关合同：
- `docs/contracts/semantics-contract.md`
- `docs/contracts/interactive-input-contract.md`
- `docs/contracts/permissions-policy-contract.md`

说明：
- 本文档仅记录“当前已对齐/已暴露”的 SDK 导出状态。
- 不做 `@anthropic-ai/claude-agent-sdk` 全量 1:1 映射。
- 未支持能力不做占位实现；若已暴露同名方法，则应明确“显式未支持”语义。
- 本文档是当前导出状态的自包含记录，不以 `plans/*` 过程文档作为上游。

## Top-level Exports

| 官方导出 | Formax SDK | 状态 | 备注 |
|---|---|---|---|
| `query` | `query` | Supported | Query 句柄方法已收口，部分高级方法为显式未支持语义。 |
| `getSessionMessages` | `getSessionMessages` | Supported | 复用本地 session reader 能力。 |
| `listSessions` | `listSessions` | Supported | 复用本地 session reader 能力。 |
| `unstable_v2_createSession` | `unstable_v2_createSession` | Supported | in-process session。 |
| `unstable_v2_resumeSession` | `unstable_v2_resumeSession` | Supported | in-process resume 语义。 |
| `unstable_v2_prompt` | `unstable_v2_prompt` | Supported | 单次 prompt facade。 |
| `HOOK_EVENTS` | `HOOK_EVENTS` | Supported | 按当前 hooks 能力导出子集。 |
| `EXIT_REASONS` | `EXIT_REASONS` | Supported | 常量子集导出。 |
| `AbortError` | `AbortError` | Supported | SDK 统一中断错误类型。 |
| `createSdkMcpServer` | - | Not Supported | 本期不实现。 |
| `tool` | - | Not Supported | 本期不实现。 |

## Query Handle Methods

| 官方 Query 方法 | Formax SDK | 状态 | 备注 |
|---|---|---|---|
| `interrupt` | `interrupt` | Supported | 已支持。 |
| `close` | `close` | Supported | 已支持。 |
| `initializationResult` | `initializationResult` | Supported | 已支持。 |
| `setModel` | `setModel` | Supported | 启动前覆盖。 |
| `setPermissionMode` | `setPermissionMode` | Supported | 启动前覆盖。 |
| `setMaxThinkingTokens` | `setMaxThinkingTokens` | Supported | 启动前覆盖。 |
| `supportedCommands` | `supportedCommands` | Supported | 返回当前 slash command 子集，包含 `name/argumentHint` 与 `command/argHint` 兼容字段。 |
| `supportedAgents` | `supportedAgents` | Supported | 返回当前子代理子集；当底层子代理配置包含模型信息时返回 `model` 字段。 |
| `supportedModels` | `supportedModels` | Supported | 返回 provider 可用模型子集，包含 `value/displayName/supportsEffort/supportsAdaptiveThinking` 等官方常用兼容字段；活动模型回填项在可推导时补齐 effort、`max_tokens/contextWindowTokens` 与 `supports_vision/supports_function_calling` 兼容字段。 |
| `accountInfo` | `accountInfo` | Supported | 返回当前账号配置子集，并补齐 `tokenSource/apiKeySource` 兼容字段；`apiKeySource` 输出官方兼容值，`tokenSource` 保留 Formax 来源细节。 |
| `mcpServerStatus` | `mcpServerStatus` | Partial | 显式未支持。 |
| `setMcpServers` | `setMcpServers` | Partial | 显式未支持；返回类型已对齐为 `McpSetServersResult`。 |
| `reconnectMcpServer` | `reconnectMcpServer` | Partial | 显式未支持。 |
| `toggleMcpServer` | `toggleMcpServer` | Partial | 显式未支持。 |
| `streamInput` | `streamInput` | Partial | 显式未支持。 |
| `stopTask` | `stopTask` | Partial | 显式未支持。 |
| `rewindFiles` | `rewindFiles` | Partial | 显式未支持；返回类型已对齐为 `RewindFilesResult`。 |

## Type Exports (Supported Subset)

| 官方类型导出 | Formax SDK | 状态 | 备注 |
|---|---|---|---|
| `Options` | `Options` | Supported | `QueryOptions` 的官方同名别名。 |
| `SDKMessage` | `SDKMessage` | Supported | `QueryMessage` 的官方同名别名。 |
| `SDKSystemMessage` | `SDKSystemMessage` | Supported | `SystemMessage` 的官方同名别名。 |
| `SDKPartialAssistantMessage` | `SDKPartialAssistantMessage` | Supported | `PartialAssistantMessage` 的官方同名别名。 |
| `SDKAssistantMessage` | `SDKAssistantMessage` | Supported | `AssistantMessage` 的官方同名别名。 |
| `SDKResultMessage` | `SDKResultMessage` | Supported | `ResultMessage` 的官方同名别名。 |
| `SDKResultSuccess` | `SDKResultSuccess` | Supported | `subtype='success'` 的结果类型别名。 |
| `SDKResultError` | `SDKResultError` | Supported | 非 success 子类型的结果类型别名。 |
| `McpSetServersResult` | `McpSetServersResult` | Supported | MCP server set 控制结果的官方同名类型别名。 |
| `RewindFilesResult` | `RewindFilesResult` | Supported | rewind 控制结果的官方同名类型子集。 |
| `PromptRequest` | `PromptRequest` | Supported | 对齐到当前 `ask_user_question` 请求类型子集。 |
| `PromptRequestOption` | `PromptRequestOption` | Supported | 对齐到当前 `ask_user_question.options` 选项类型子集。 |
| `PromptResponse` | `PromptResponse` | Supported | 对齐到当前 `ask_user_question` 回答结果类型子集。 |
| `OutputFormatType` | `OutputFormatType` | Supported | 对齐到当前 `outputFormat.type` 子集（`json_schema`）。 |
| `BaseOutputFormat` | `BaseOutputFormat` | Supported | 对齐到当前 `outputFormat` 基础类型子集。 |
| `ElicitationRequest` | `ElicitationRequest` | Supported | 对齐到当前 elicitation 请求类型子集。 |
| `ElicitationResult` | `ElicitationResult` | Supported | 对齐到当前 elicitation 结果类型子集。 |
| `OnElicitation` | `OnElicitation` | Supported | 对齐到当前 `options.onElicitation` 回调签名子集。 |
| `ApiKeySource` | `ApiKeySource` | Supported | 对齐官方 `apiKeySource` 枚举值子集并保留 legacy 兼容。 |

## Note

- 更完整的 query / options 对齐请交叉阅读：
  - `src/sdk/query.ts`
  - `src/sdk/query.test.ts`
  - `src/sdk/query.options-alignment.test.ts`
