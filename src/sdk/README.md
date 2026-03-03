# Formax SDK (TypeScript)

`src/sdk` provides a unified in-process SDK surface for TypeScript callers.

## Unified Entry

Primary unified entry module:
- `src/sdk/api.ts`

Package-level re-export entry:
- `src/sdk/index.ts`

Exported function set:
- `query(args): Query` (`AsyncGenerator<QueryMessage, void, unknown>` + `interrupt()` + `close()` + `initializationResult()` + `supportedCommands()` + `supportedAgents()` + `supportedModels()` + `accountInfo()` + `mcpServerStatus()` + MCP control methods + task control methods + control methods)
- `listSessions(options?): Promise<SDKSessionInfo[]>`
- `getSessionMessages(sessionId, options?): Promise<SessionMessage[]>`
- `unstable_v2_createSession(options): SDKSession`
- `unstable_v2_resumeSession(sessionId, options): SDKSession`
- `unstable_v2_prompt(message, options): Promise<ResultMessage>`
- `HOOK_EVENTS` (SDK 当前支持的 hook 事件常量子集)
- `EXIT_REASONS` (SDK 当前支持的退出原因常量子集)
- `AbortError`（中断相关统一错误类型）

## Quick Start

```ts
import {
  getSessionMessages,
  listSessions,
  query,
  unstable_v2_createSession,
  unstable_v2_prompt,
} from './src/sdk/api.js'

for await (const message of query({ prompt: 'Summarize this repository' })) {
  if (message.type === 'assistant') {
    console.log(message.text)
  }
}

await using session = unstable_v2_createSession({ model: 'claude-sonnet-4-6' })
await session.send('hello')
for await (const message of session.stream()) {
  if (message.type === 'assistant') {
    console.log(message.text)
  }
}

const oneShot = await unstable_v2_prompt('What is 2 + 2?', { model: 'claude-sonnet-4-6' })
console.log(oneShot.subtype, oneShot.result)

const sessions = await listSessions({ limit: 5 })
if (sessions.length > 0) {
  const recentMessages = await getSessionMessages(sessions[0].sessionId, { limit: 4 })
  console.log(recentMessages.map((m) => m.type))
}
```

## Supported Now

Implemented and available now:
- Query streaming (`query`)
- Query control handle (`query(...).interrupt()` / `query(...).close()` + `initializationResult()` + `supportedCommands()` + `supportedAgents()` + `supportedModels()` + `accountInfo()` + `mcpServerStatus()` + `setMcpServers/reconnectMcpServer/toggleMcpServer` (currently explicit unsupported) + `streamInput/stopTask/rewindFiles` (currently explicit unsupported) + `setModel/setPermissionMode/setMaxThinkingTokens` pre-start overrides)
- Query prompt stream alignment (`prompt` supports `AsyncIterable<SDKUserMessage>` user/text subset)
- Query mode alignment (`permissionMode` official values accepted; unsupported ones fail explicitly)
- Query cancellation alignment (`abortController`, compatible with existing `signal`)
- Query system prompt alignment (`systemPrompt` supports official `preset` object shape)
- Query thinking alignment (`thinking` supports adaptive/enabled/disabled subset)
- Query token-thinking alignment (`maxThinkingTokens` accepted for legacy compatibility)
- Query turn-limit alignment (`maxTurns=1` accepted; larger values fail explicitly)
- Query budget alignment (`maxBudgetUsd` accepted as contract input; currently fails explicitly as unsupported)
- Query resume-option alignment (`resume/sessionId/resumeSessionAt` accepted as contract inputs; currently fail explicitly as unsupported)
- Query debug-option alignment (`debug/debugFile` accepted as contract inputs; currently fail explicitly as unsupported)
- Query stderr alignment (`stderr` accepted as contract input; currently fails explicitly as unsupported)
- Query process-spawn alignment (`pathToClaudeCodeExecutable/spawnClaudeCodeProcess` accepted as contract inputs; currently fail explicitly as unsupported)
- Query cli-exec alignment (`extraArgs/executable/executableArgs/betas` accepted as contract inputs; currently fail explicitly as unsupported)
- Query permission-prompt alignment (`allowDangerouslySkipPermissions/permissionPromptToolName/promptSuggestions` accepted as contract inputs; currently fail explicitly as unsupported)
- Query continuation alignment (`continue/fallbackModel` accepted as contract inputs; currently fail explicitly as unsupported)
- Query strict MCP alignment (`strictMcpConfig` accepted as contract input; currently fails explicitly as unsupported)
- Query persistence alignment (`persistSession/forkSession/enableFileCheckpointing` accepted as contract inputs; currently fail explicitly as unsupported)
- Query filesystem-sandbox alignment (`additionalDirectories/sandbox` accepted as contract inputs; currently fail explicitly as unsupported)
- Query agent alignment (`agent/agents` accepted as contract inputs; currently fail explicitly as unsupported)
- Query tools/MCP alignment (`tools/mcpServers` accepted as contract inputs; currently fail explicitly as unsupported)
- Query hook-permission alignment (`hooks/canUseTool` accepted as contract inputs; currently fail explicitly as unsupported)
- Query extension alignment (`plugins/settingSources/onElicitation` accepted as contract inputs; currently fail explicitly as unsupported)
- Session discovery (`listSessions`)
- Session transcript read (`getSessionMessages`)
- Multi-turn session flow (`unstable_v2_*`)
- In-process session resume (`unstable_v2_resumeSession`)
- Interactive input handling (`approval_request`, `ask_user_question`)
- Structured output (`outputFormat` + `structured_output`)
- SDK boundary validation for untrusted external input
- SDK hook constants export (`HOOK_EVENTS`)
- SDK exit-reason constants export (`EXIT_REASONS`)
- SDK literal type exports (`HookEvent`, `ExitReason`)
- SDK official-aligned type aliases (`Options`, `SDKMessage`, `SDKSystemMessage`, `SDKAssistantMessage`, `SDKResultMessage`, `SDKResultSuccess`, `SDKResultError`)
- SDK abort error export (`AbortError`)

## Planned

These are intentionally not implemented in this phase:
- Cross-process session resume
- `settingSources`
- Other official Agent SDK options not yet mapped in Formax SDK

## Not Supported In This Phase

These remain out of scope for SDK phase-1:
- `createSdkMcpServer`
- `tool` (SDK MCP helper)
- `mcpServers`
- `query(...).mcpServerStatus()` capability data (method exists but currently returns explicit unsupported error)
- `query(...).setMcpServers()` capability data (method exists but currently returns explicit unsupported error)
- `query(...).reconnectMcpServer()` capability data (method exists but currently returns explicit unsupported error)
- `query(...).toggleMcpServer()` capability data (method exists but currently returns explicit unsupported error)
- `query(...).streamInput()` capability data (method exists but currently returns explicit unsupported error)
- `query(...).stopTask()` capability data (method exists but currently returns explicit unsupported error)
- `query(...).rewindFiles()` capability data (method exists but currently returns explicit unsupported error)
- `hooks`
- `canUseTool`
- `plugins`

## Query Alignment Reference

- Query contract alignment matrix:
  - `plans/sdk-contract-alignment-loop/query-alignment-matrix.md`
- SDK exports alignment index:
  - `src/sdk/EXPORTS-ALIGNMENT.md`
- Exports source reference:
  - `plans/claude-agent-sdk/claude-agent-sdk-exports-reference.md`

## Structured Output (`outputFormat`)

```ts
import { query, type QueryMessage } from './src/sdk/api.js'

const messages: QueryMessage[] = []

for await (const message of query({
  prompt: 'Return the project name and language',
  options: {
    outputFormat: {
      type: 'json_schema',
      maxRetries: 1,
      schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['project_name', 'language'],
        additionalProperties: false,
      },
    },
  },
})) {
  messages.push(message)
}

const result = messages.findLast((m) => m.type === 'result')
if (result?.type === 'result') {
  console.log(result.subtype)
  console.log(result.structured_output)
}
```

Result subtypes:
- `success`
- `error_max_structured_output_retries`
- `error_during_execution`

## Session Resume Limitation

- `unstable_v2_resumeSession` currently supports in-process resume only.
- The `sessionId` must come from a session created in the same Node.js process.

## Session Query Notes

- `listSessions` and `getSessionMessages` reuse Formax local session storage reader behavior.
- `listSessions` is scoped by `options.dir` (or current working directory when omitted).
- `getSessionMessages` resolves `sessionId` within the same `options.dir` scope.
- `getSessionMessages` currently returns user/assistant prompt history messages.
- `SDKSessionInfo.firstPrompt` is derived from `ui_stats.firstUserPrompt` in session tail events.
- `SDKSessionInfo.fileSize` uses filesystem bytes from the session file.
- If a session file cannot be read during enrichment, `listSessions` keeps the entry with base fields.

## Internal Layout (for contributors)

- Unified API: `src/sdk/api.ts`
- Query facade: `src/sdk/query.ts`
- Query runtime implementation: `src/sdk/query/runner.ts`
- Session query facade: `src/sdk/sessions.ts`
- Session facade: `src/sdk/v2.ts`
- Session runtime implementation: `src/sdk/session/core.ts`
- Validation: `src/sdk/validation.ts`
- Structured output helpers: `src/sdk/structuredOutput.ts`
