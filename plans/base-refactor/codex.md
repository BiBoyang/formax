# Base Refactor（REPL 分层重构方案）

目标：让 `src/screens/REPL.tsx` 只负责 Ink UI/交互，把提示词、工具加载/执行、流式 loop、配置与日志等下沉到可复用模块，便于后续扩展 `sub_agent`（例如新增 `Task/Agent` 工具处理器）。

## 现状痛点（以 `src/screens/REPL.tsx` 为例）

- UI 与业务逻辑强耦合：提示词（`SYSTEM_PROMPT`/`/init` prompt）、工具加载（读 `proxy/tools.json`）、流式回调与 tool 执行、消息拼装全在一个组件内。
- 扩展成本高：后续接入 `sub_agent` 本质是“新增工具类型 + 新的执行策略 + 可能的多轮 tool-loop”，现状需要直接改 UI。
- 配置分散：`StreamClient` 通过 env 读取 `ANTHROPIC_*`，REPL 自己读 `process.env`，日志目录也硬编码在 `StreamClient` 内。

## 推荐目录树（树状图）

```text
formax/
├─ .agent/
│  └─ subagents/                   # (新增) Claude Code 风格 sub-agent 定义
│     └─ *.md
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
│  ├─ subagents/                   # (新增) sub-agent registry/runner
│  │  ├─ types.ts
│  │  ├─ registry.ts
│  │  └─ runner.ts
│  ├─ tools/
│  │  ├─ types.ts
│  │  ├─ loader.ts
│  │  └─ executor/
│  │     ├─ index.ts
│  │     └─ handlers/
│  │        └─ taskSubAgent.ts     # (新增) Task/sub-agent ToolHandler
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

> 说明：旧实现目录已完成迁移并删除；底层实现位于 `src/streaming/anthropic/*` 与 `src/tools/executor/*`，但最终 UI 不应直接依赖这些底层细节。

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
    subagentsDir: string
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
- `types.ts`：全局唯一的 tool 类型源（避免在 UI/streaming/executor 等多处重复定义）。
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
  execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult>
}

export function createToolExecutor(handlers: ToolHandler[]): ToolExecutor
```

建议补一个统一的执行上下文（用于白名单、禁止嵌套等策略下沉到 executor 层集中控制）：

```ts
export type ExecutionContext = {
  cwd: string
  signal?: AbortSignal

  // 0 = main agent, 1 = sub-agent, ...
  agentDepth: number

  // 允许/禁止工具名（executor 层二次校验）
  allowTools?: string[]
  denyTools?: string[]
}
```

实现上可以把 `createToolExecutor()` 做成“策略 + handlers”的组合：先做 `allow/deny/agentDepth` 校验，再 dispatch 到具体 `ToolHandler`，避免每个 handler 自己重复写安全逻辑。

> sub_agent 扩展点：实现 `Task` 的 `ToolHandler`（对接 `.agent/subagents/*.md`），无需改 REPL；只在 wiring 处把 handler 注入 executor。

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
- 避免在 `StreamClient` 内读 env 或硬编码路径：配置由 `RuntimeConfig` 注入，日志由上层注入 logger（可选）。

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
- `subAgentRegistry = createSubAgentRegistry(); await subAgentRegistry.loadFromDirectory(cfg.paths.subagentsDir)`
- `client = new AnthropicStreamClient(cfg.llm, { logsDir: cfg.paths.logsDir })`
- `localExecutor = createToolExecutor([localToolsHandler])`
- `subAgentRunner = createSubAgentRunner({ client, executor: localExecutor, allTools: tools /* isolated history + tool whitelist */ })`
- `taskSubAgentHandler = createTaskSubAgentHandler({ registry: subAgentRegistry, runner: subAgentRunner })`
- `executor = createToolExecutor([taskSubAgentHandler, localToolsHandler])`
- `engine = createChatEngine({ client, executeTool: executor })`

2) `src/screens/REPL.tsx` 只负责 UI：
- `const { state, actions } = useReplController({ engine, tools, cfg })`
- `InputBar.onSubmit -> actions.send(input)`
- `Ctrl+C -> actions.abort(); onExit?.()`
- 渲染 `state.messages`（assistant/user/tool），tool 消息继续用现有 `ToolMessage` 组件显示即可。

## 基于 claude-code-research 的补强点（Sub-Agent）

对齐 `plans/sub-agent/claude-code-research.md` 的 4 个强约束：**隔离上下文 / 工具白名单 / 禁止嵌套 / 仅返回摘要**。因此在本方案上补充如下改动点：

### A) sub-agent 定义：Markdown + YAML frontmatter

新增目录：`.agent/subagents/*.md`

- `name`: sub-agent 唯一 id（用于 `Task.subagent_type`）
- `description`: 用于主 agent 选择/展示
- `tools`: 白名单（工具名数组，如 `["Read","Grep","Glob"]`）
- body：sub-agent 的 system prompt（要求输出摘要，限制字数）

### B) SubAgentRegistry：加载与查询

新增：`src/subagents/registry.ts`

```ts
export type SubAgentConfig = {
  name: string
  description: string
  tools: string[]
  systemPrompt: string
}

export interface SubAgentRegistry {
  loadFromDirectory(dir: string): Promise<void>
  get(name: string): SubAgentConfig | undefined
  list(): Array<{ name: string; description: string }>
}
```

### C) SubAgentRunner：隔离执行 + 生成摘要

新增：`src/subagents/runner.ts`

关键策略：
- 每次运行都从空白 history 开始（不接收 parentSession/history）
- `tools` 只传白名单且强制剔除 `Task/Agent/Dispatch`（禁止嵌套）
- tool executor 二次校验：即使模型“幻觉调用”非白名单工具也直接拒绝
- 产出只回 `summary`（可选携带 `artifacts`），避免把完整上下文注回主会话

```ts
export type SubAgentResult = {
  summary: string
  success: boolean
  artifacts?: string[]
  error?: string
}

export interface SubAgentRunner {
  run(args: { agent: SubAgentConfig; task: string; signal?: AbortSignal }): Promise<SubAgentResult>
}
```

### D) Task ToolHandler：把 sub-agent 作为工具实现（补齐现状缺口）

背景：当前 `proxy/tools.json` 已包含 `Task`（描述会引导模型使用 `subagent_type`），但其 `input_schema` 可能与本实现不一致（例如仍是 Claude Code 的 `command/timeout` schema）。因此 `Task` handler 以 `call.input.subagent_type` + `call.input.prompt` 为准并做严格校验；后续可在 `loadToolDefinitions()` 后对 `Task` 的 `description/input_schema` 做运行时 patch，进一步降低模型生成错字段的概率。

新增：`src/tools/executor/handlers/taskSubAgent.ts`

- `canHandle(name) => name === "Task"`
- 从 `call.input.subagent_type` 找 sub-agent（优先 `.agent/subagents`，可选再支持内置类型映射）
- 调用 `SubAgentRunner.run({ task: call.input.prompt })`
- 返回 `ToolResult.content = result.summary`（必要时 JSON stringify），`is_error = !success`

这样主会话收到的只是一个工具结果摘要，天然符合“结果汇总、避免 context 膨胀”的原则。

### E) 避免循环依赖（runner 不依赖主 ChatEngine）

在 wiring 时容易出现循环：`main ChatEngine -> executor -> TaskHandler -> SubAgentRunner -> (再依赖 main ChatEngine)`。

推荐做法：
- `SubAgentRunner` **不要**复用主 `ChatEngine` 实例；而是用同一个底层 `StreamClient`（HTTP/SSE）+ 一个“受限 executor”（仅本地工具、强制白名单、强制禁用 `Task/Agent/Dispatch`）在 runner 内部跑隔离回合。
- 主会话的 `TaskSubAgentToolHandler` 只是桥接：取配置、调用 runner、把摘要塞回 `ToolResult`。

### F) Task tool 定义对齐（防止模型用错 subagent_type）

现状：`proxy/tools.json` 里的 `Task` 描述会引导模型使用内置 `subagent_type`（例如 `Plan/Explore/...`），但你的实现将以 `.agent/subagents/*.md` 为准。

建议两条防线（至少做一条）：
- **提示词防线**：在主 system prompt 中动态插入“可用 sub-agents 列表”（来自 `subAgentRegistry.list()`），并明确要求 `Task.subagent_type` 只能取这些值。
- **工具描述防线**：在 `loadToolDefinitions()` 后对 `Task` 的 `description` 做一次运行时覆盖/追加，把“可用 sub-agents 列表”写进去（比只写在 system prompt 更稳）。

如果你希望完全兼容 `Task` 描述中提到的那些类型，也可以在 `.agent/subagents/` 提供同名的内置 sub-agent（例如 `Plan`/`Explore`），并把它们映射到不同的白名单与 system prompt 模板。

### G) 测试覆盖（建议作为“第一道防线”）

已补齐的单测（无网络、可本地跑）：
- `src/subagents/registry.test.ts`：frontmatter 解析 + 忽略无效文件
- `src/subagents/runner.test.ts`：工具白名单/禁止嵌套 + 摘要截断（≤500 chars）
- `src/tools/executor/handlers/taskSubAgent.test.ts`：参数校验、not found、artifacts、失败路径

验证命令：
- `npm test`
- `npm run type-check`
