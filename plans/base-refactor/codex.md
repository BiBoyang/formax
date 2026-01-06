# Base Refactor（REPL 分层重构方案）

目标：让 `src/screens/REPL.tsx` 只负责 Ink UI/交互，把提示词、工具加载/执行、流式 loop、配置与日志等下沉到可复用模块，便于后续扩展 `sub_agent`（例如新增 `Task/Agent` 工具处理器）。

## 现状痛点（以 `src/screens/REPL.tsx` 为例）

- UI 与业务逻辑强耦合：提示词（`SYSTEM_PROMPT`/`/init` prompt）、工具加载（读 `proxy/tools.json`）、流式回调与 tool 执行、消息拼装全在一个组件内。
- 扩展成本高：后续接入 `sub_agent` 本质是“新增工具类型 + 新的执行策略 + 可能的多轮 tool-loop”，现状需要直接改 UI。
- 配置分散：`StreamClient` 通过 env 读取 `ANTHROPIC_*`，REPL 自己读 `process.env`，日志目录也硬编码在 `StreamClient` 内。

## 推荐目录树（树状图）

```text
formax/
├─ src/
│  ├─ entrypoints/
│  │  └─ cli.tsx
│  ├─ screens/
│  │  └─ REPL.tsx
│  ├─ features/
│  │  └─ repl/
│  │     └─ useReplController.ts
│  ├─ chat/
│  │  └─ engine.ts
│  ├─ prompts/
│  │  ├─ index.ts
│  │  ├─ system.ts
│  │  ├─ init.ts
│  │  └─ user.ts
│  ├─ tools/
│  │  ├─ types.ts
│  │  ├─ loader.ts
│  │  └─ executor/
│  │     └─ index.ts
│  ├─ streaming/
│  │  ├─ types.ts
│  │  └─ anthropic/
│  │     └─ StreamClient.ts
│  └─ env/
│     └─ config.ts
├─ proxy/
│  ├─ tools.json
│  └─ logs/
└─ package.json
```

> 说明：`src/agent2/*` 可作为迁移来源（例如把 `src/agent2/streaming/StreamClient.ts` 迁移/薄封装到 `src/streaming/anthropic/StreamClient.ts`），但最终 UI 不应直接依赖 `agent2/*` 的底层细节。

## 分层与模块边界（职责 + 导出接口）

### 1) env/config：运行时配置聚合（UI 不读 env）

文件：`src/env/config.ts`

职责：
- 统一读取并校验 `baseUrl/apiKey/model/timeout/logDir/toolsJsonPath` 等运行时配置。
- 输出一个稳定的 `RuntimeConfig`，供 wiring（entrypoint）注入给上层。

导出签名（示例）：
```ts
export type RuntimeConfig = {
  llm: {
    provider: 'anthropic'
    baseUrl: string
    apiKey: string
    model: string
    timeoutMs: number
  }
  paths: {
    toolsJsonPath: string
    logsDir: string
  }
}

export function loadRuntimeConfig(
  env?: NodeJS.ProcessEnv,
  cwd?: string
): RuntimeConfig
```

### 2) prompts：提示词/命令提示词（纯函数）

目录：`src/prompts/*`

职责：
- `system/init/user` 等提示词与命令提示词生成（纯函数、可测试）。
- REPL 只调用 prompt builder，不拼字符串、不关心 cache_control 等细节。

导出签名（示例）：
```ts
export type PromptBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

export function buildSystemPrompt(ctx: { appName: string; version: string }): PromptBlock[]
export function buildInitPrompt(ctx: { cwd: string }): PromptBlock[]
export function buildUserContent(input: string, ctx: { cwd: string }): PromptBlock[]
```

### 3) tools：工具定义、加载、执行（UI 只接收工具列表/事件）

目录：`src/tools/*`

职责拆分：
- `types.ts`：全局唯一的 tool 类型源（避免 `src/agent2/*` 与 UI 重复定义）。
- `loader.ts`：从 `proxy/tools.json`（后续可扩展为多来源）加载 + schema/字段校验 + 默认值归一化。
- `executor/*`：执行策略组合（本地工具、未来 sub_agent 工具、远程工具等），以 `ToolHandler` 插件式扩展。

导出签名（示例）：
```ts
// types.ts
export type ToolDefinition = { name: string; description: string; input_schema: unknown }
export type ToolCall = { id: string; name: string; input: Record<string, unknown> }
export type ToolResult = { tool_use_id: string; content: string; is_error?: boolean }

// loader.ts
export function loadToolDefinitions(opts: { filePath: string }): Promise<ToolDefinition[]>

// executor/index.ts
export type ToolExecutor = (
  call: ToolCall,
  ctx: { cwd: string; signal?: AbortSignal }
) => Promise<ToolResult>

export interface ToolHandler {
  canHandle(name: string): boolean
  execute(call: ToolCall, ctx: { cwd: string; signal?: AbortSignal }): Promise<ToolResult>
}

export function createToolExecutor(handlers: ToolHandler[]): ToolExecutor
```

> sub_agent 扩展点：新增一个 `ToolHandler`（例如处理 `Task/Agent`），无需改 REPL；只在 wiring 处把 handler 注入 executor。

### 4) streaming/types：流式 loop 的“事件协议”（UI 只消费事件）

文件：`src/streaming/types.ts`

职责：
- 定义 UI/业务之间的事件边界：assistant delta、tool start/input/end、error、complete。
- UI 不直接依赖 Anthropic SSE 的 event 细节。

导出签名（示例）：
```ts
import type { ToolResult } from '../tools/types'

export type StreamEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_input'; id: string; input: unknown }
  | { type: 'tool_end'; id: string; result: ToolResult }
  | { type: 'error'; error: Error }
  | { type: 'complete' }

export type StreamSink = (ev: StreamEvent) => void
```

### 5) streaming/anthropic：SSE + tool-loop（底层实现，可替换）

文件：`src/streaming/anthropic/StreamClient.ts`

职责：
- 负责与 Anthropic API 通信、解析 SSE、驱动 tool-loop。
- 通过 `StreamSink` 向上层发事件，不关心 UI。
- 建议把现有 `src/agent2/streaming/StreamClient.ts` 的 env/log 硬编码拆出去：配置由 `RuntimeConfig` 注入，日志由上层注入 logger（可选）。

导出接口（示例）：
```ts
import type { ToolDefinition, ToolCall } from '../../tools/types'
import type { PromptBlock } from '../../prompts'
import type { StreamSink } from '../types'

export interface StreamClient {
  runTurn(args: {
    messages: { role: 'user' | 'assistant'; content: PromptBlock[] }[]
    system: PromptBlock[]
    tools: ToolDefinition[]
    onEvent: StreamSink
    executeTool: (call: ToolCall) => Promise<string>
    signal?: AbortSignal
  }): Promise<void>
}
```

### 6) chat/engine：应用层用例（把 prompts/tools/streaming 粘合）

文件：`src/chat/engine.ts`

职责：
- 单一职责：完成“一次发送 -> 流式输出 -> 可能多轮 tool-loop -> 产出最终 history”的用例。
- REPL 只调用 `engine.runTurn`，不关心 tool-loop 是否发生。

导出签名（示例）：
```ts
import type { PromptBlock } from '../prompts'
import type { ToolDefinition } from '../tools/types'
import type { StreamSink } from '../streaming/types'

export type ChatHistory = { role: 'user' | 'assistant'; content: PromptBlock[] }[]

export interface ChatEngine {
  runTurn(args: {
    history: ChatHistory
    user: { content: PromptBlock[] }
    system: PromptBlock[]
    tools: ToolDefinition[]
    onEvent: StreamSink
    signal?: AbortSignal
  }): Promise<ChatHistory>
}
```

### 7) features/repl：REPL 控制器（UI 状态机/Reducer，Ink 无关）

文件：`src/features/repl/useReplController.ts`

职责：
- 把 `StreamEvent` 映射成 UI 需要的 `messages/isLoading/error/loadingText`。
- 封装“中断/重试/命令处理（如 /init）”策略。
- 复用现有 `ToolMessage`/`formatToolResult` 逻辑，但 REPL 不再自己维护复杂的 tool 消息拼装细节。

导出接口（示例）：
```ts
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { ChatEngine } from '../../chat/engine'

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
}): {
  state: { messages: any[]; isLoading: boolean; loadingText: string; error: string | null }
  actions: { send(text: string): Promise<void>; abort(): void }
}
```

## REPL.tsx 的调用流程（示例）

1) `src/entrypoints/cli.tsx`（或 `src/app/replWiring.ts`）负责“组装依赖”：
- `cfg = loadRuntimeConfig(process.env, process.cwd())`
- `tools = await loadToolDefinitions({ filePath: cfg.paths.toolsJsonPath })`
- `executor = createToolExecutor([localToolsHandler, /* futureSubAgentHandler */])`
- `client = new AnthropicStreamClient(cfg.llm, { logsDir: cfg.paths.logsDir })`
- `engine = createChatEngine({ client, executeTool: executor })`

2) `src/screens/REPL.tsx` 只负责 UI：
- `const { state, actions } = useReplController({ engine, tools, cfg })`
- `InputBar.onSubmit -> actions.send(input)`
- `Ctrl+C -> actions.abort(); onExit?.()`
- 渲染 `state.messages`（assistant/user/tool），tool 消息继续用现有 `ToolMessage` 组件显示即可。
