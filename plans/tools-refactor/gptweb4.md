我先按你提的 5 个重点逐条给“可落地”的建议，然后给 **下一步最值得做的 3 个改动（ROI 排序）**，每个都写清 **接口形态 / 落点文件 / 渐进式兼容策略**。我基于你这包 repomix + 0034 请求 + traffic-logs 的 .simple.json 来判断当前状态与缺口（关键引用见文内）。

---

## 1) tokens 统计：事件总线里怎么表示/累计最合理？

### 你现在的“事实现状”

* `StreamEvent` 里还没有 usage/tokens 事件（只有 assistant_delta/tool_*）
* SSE parser 对 `message_delta` 只处理了 `stop_reason`，没读 `usage`
* 但你抓到的真实请求/响应里 **确实存在 usage 字段**（例如 `message_delta.usage` 里有 `input_tokens/output_tokens/cache_*`）

### 我建议的“最小侵入”数据结构

新增一个 **可累加** 的 usage 结构（不要直接用单次快照）：

```ts
// src/usage/types.ts
export type TokenUsage = Partial<{
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}>

export type UsageScope = 'turn' | 'subagent' | 'meta'

export type UsageDelta = {
  scope: UsageScope
  /** 绑定到 UI 上的“归属者”，比如 Task tool_use_id */
  ownerId?: string
  model?: string
  usage: TokenUsage
}
```

然后把它接入你现有 event bus（保持你“事件驱动流水线”的优势）：

```ts
// src/streaming/types.ts
export type StreamEvent =
  | ...
  | { type: 'usage'; delta: UsageDelta }
```

### 累计策略（关键：别算错 Anthropic 的 cache 字段）

Claude Code 那个 “66.6k tokens” 很可能不是单纯 input+output；你的抓包里 usage 可能分拆成 `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` + `output_tokens`。
所以 UI **建议默认展示 breakdown**，而不是强行给一个“总计=xxxx”：

* `total_for_display = input + output + cache_read + cache_creation`（仅展示）
* 旁边小字：`(in/out/cacheR/cacheC)`，避免用户误解“计费口径”。

### 落点（你这套代码最顺的插入点）

1. `src/streaming/anthropic/sseParser.ts`：在 `message_start` / `message_delta` 里读取 `usage`，触发 `callbacks.onUsage(...)`（你现在 `message_delta` 只看 stop_reason）
2. `src/streaming/anthropic/StreamClient.ts`：把 `onUsage` 转换成 `onEvent({type:'usage'})` 往上抛
3. **Task(Explore) 的聚合**：在 `createTaskSubAgentToolHandler` 的 `onSubEvent` 里新增一个分支，监听 `ev.type === 'usage'` 并累加到本次 Task 的 stats（你现在已经在这里聚合 toolUses 与动态行，非常合适）

---

## 2) Meta topic/title router：最小接入点、触发策略、失败降级

### 你抓包里的“Claude Code 事实模式”

在 `proxy/traffic-logs/*simple.json` 里能看到专门的元请求：

* 用 **Haiku** 之类便宜模型
* `tools: []`（完全不需要 tools JSON）
* 系统提示要求输出 JSON（title、isNewTopic 等）

### 最小接入点（我建议：不要阻塞主对话）

放在 **每次 user submit 后**，以 “sidecar background job” 的方式跑：

* **触发时机**（MVP）

  1. 新会话：当前 session 没 title
  2. 每 N 次 user turn（比如 6~10）
  3. 或者当 user 消息长度/代码块明显增大（阈值触发）

* **并发策略**

  * 不 await，不影响主对话 latency
  * 如果上一次 meta job 还在跑：直接取消旧的（AbortController）或丢弃结果（只保留最新）

* **失败降级**

  * JSON parse fail / timeout：忽略，title 不变
  * 兜底 title：取用户输入前 20~30 个字符 + “…”（本地生成）

### 最小实现形态

```ts
export interface MetaRouter {
  maybeUpdate(args: {
    sessionId: string
    recentMessages: PromptMessage[]  // 截断后的
    lastUserText: string
    signal?: AbortSignal
  }): Promise<void> // 内部自行 setState/dispatch
}
```

它依赖你的“多模型路由”（下一条我会说怎么统一做），并且发请求时 **tools 直接传 []**，完全绕开 tools schema 体积。

---

## 3) Task schema 演进：怎么渐进加回 description/model/resume 又不让模型乱填？

### 你当前 handler 的事实约束

`Task` handler 现在只硬读 3 个字段：`subagent_type/prompt/run_in_background`，并在缺失时直接返回 error。

### 我建议的渐进路线（关键点：**schema 严格 + handler 宽容**）

* **Schema 保持 `additionalProperties:false`**（这是防“模型乱填”的核心）
* 但 handler 端做到：**新字段可读可忽略**（不破坏旧 presenter）

#### Phase A（低风险）：加回 `description`

* schema：`description?: string`
* handler：不用于执行逻辑，只用于 UI header（提升可读性）
* 成本很低，收益立刻体现

#### Phase B（中风险高收益）：加回 `model`，但用 enum 锁死

你不要让模型自由输出任意 model 字符串，应该把 `model` 变成 enum（比如 `'default' | 'haiku' | 'sonnet'`），并在本地映射成真实模型 ID。

#### Phase C（高风险）：`resume`

抓包里 Task 的 usage notes 明确提了可 `resume`，并且“agent ID 可复用”。
但你现在的 SubAgentRunner 是 `history: []` 的一次性执行（无持久上下文）。
所以 **建议暂时别把 resume 放进 schema**，除非你准备同时落地：

* subagent session store（agentId -> history snapshot/tool state）
* TaskManager 支持“resume 继续跑”而不是开新会话

---

## 4) 子代理模型路由：放 Task.input 还是本地映射？

### 你当前的事实

SubAgentRunner 直接复用同一个 `AnthropicStreamClient`，也就是同一 model 配置跑所有子代理。
而你抓包里的 Claude Code Explore 明显倾向用更便宜模型（Haiku）。

### 我建议：**本地按 subagent_type 映射为默认 + Task.input 可选 override**

原因：

* 你能控制成本与稳定性（避免模型“自作主张选贵模型”）
* 仍然保留 debug/高级用户 override 的能力

接口建议：

```ts
export interface ModelRouter {
  forMainTurn(): string
  forSubagent(subagentType: string): string
  forMeta(): string
  /** 可选：把 'haiku'/'sonnet' 之类映射到真实 model id */
  resolve(aliasOrId: string): string | null
}
```

并且让 `streamOnce` 支持 override `model`（现在 engine 调用 `deps.client.streamOnce({...})` 没法传 model）
这是你实现“Explore 用 Haiku”的关键改动之一。

---

## 5) ToolResult envelope：怎么渐进演进到 content_for_model vs data_for_ui，不破坏 presenter？

### 你当前的事实

* `ToolResult` 最终进到对话历史时，只用了 `r.content`（纯文本）
* `tool_update` 现在传的是 `middleLines/toolUses`（UI 强耦合字段）
* Task handler 里动态行就是通过 `tool_update.middleLines` 在跑（做得很好）

### 最稳的渐进方案：ToolResult 增加 `ui`，但**不改变 content 的含义**

```ts
export type ToolResult = {
  tool_use_id: string
  content: string            // 永远是 content_for_model（纯文本）
  is_error?: boolean
  ui?: {
    summary?: string         // 给 presenter 的一行总结
    middleLines?: string[]   // 最终态也可存一份
    stats?: {
      toolUses?: number
      durationMs?: number
      usage?: TokenUsage
    }
    data?: unknown           // 结构化 UI 数据（以后再用）
  }
}
```

然后你的 presenter 逐步切换：

* 先：`ui.summary` 存在就用；否则 fallback 到旧的 `formatToolResult(content)`
* `ui.middleLines` 存在就直接渲染；否则用旧的 `message.toolInfo.middleLines`

这样不会破坏现有 presenter，也不会影响发给模型的 tool_result（因为 engine 仍然只取 `content`）。

---

# 下一步最值得做的 3 个改动（ROI 排序）

下面这 3 个我按 **“收益/成本/对后续架构解耦价值”** 排序。

---

## 改动 1（最高 ROI）：打通 usage/tokens 事件链路 + Task(Explore) 聚合显示

**为什么 ROI 最高**

* 你已经对齐了 Claude Code 的 Task(Explore) 动态行与 Done 行，只差 tokens 就能“形态闭环”
* 你的 event bus 已经很适配（不是 raw SSE）——加一个 `usage` event 是顺滑的增量

**落点建议**

1. `src/streaming/types.ts`：新增 `{type:'usage'}`（当前没有）
2. `src/streaming/anthropic/sseParser.ts`：解析 `message_start/message_delta` 的 usage（你现在 message_delta 只看 stop_reason）
3. `src/tools/executor/handlers/taskSubAgent.ts`：在 `onSubEvent` 增加 usage 聚合，把 usage 放进 `tool_update`（实时）+ `ToolResult.ui.stats`（最终）

   * 你现在已经在这里聚合 toolUses + 动态行了，扩展一个 usage accumulator 很自然

**接口/事件形态**

* `tool_update` 增加可选字段：`stats?: { usage?: TokenUsage }`
* Done 行渲染：`Done (${toolUses} tool uses · ${fmtTokens(usage)} · ${duration})`

---

## 改动 2：引入 ModelRouter（main/subagent/meta 三路）+ 最小 Meta title/topic sidecar

**为什么 ROI 高**

* 你最关心的成本控制点（Explore 用 Haiku）必须靠它
* meta 请求可以完全无 tools（节省 prompt 体积），抓包也验证了这一模式

**落点建议**

1. `src/services/modelRouter.ts`（新增）：统一管理模型选择
2. `src/streaming/anthropic/StreamClient.ts`：让 `streamOnce({ model?: string })` 支持覆盖（否则 subagent 永远跟主模型走）
3. `src/subagents/runner.ts`：`run({ model?: string })`，把 model 透传到 engine/client（目前没有）
4. `src/repl/useReplController`（你说已有）：在 user submit 后 `metaRouter.maybeUpdate()` 异步触发，不阻塞主对话

**失败降级**

* meta 超时/解析失败：忽略
* modelRouter resolve 不到：回退主模型

---

## 改动 3：ToolResult 增加 ui envelope（content_for_model vs data_for_ui），并做“兼容式迁移”

**为什么值得现在做**

* 你现在 UI 依赖 `message.content + toolInfo.middleLines`，后续只要工具形态一多，就会把 controller/presenter 越写越乱
* engine 侧已经天然支持“ToolResult 附带额外字段但不进入 tool_result content”（它只用 `r.content`）

**落点建议**

1. `src/tools/types.ts`：扩展 `ToolResult.ui?`
2. `src/tools/executor/handlers/*`：逐步把“展示信息”塞进 `ui.summary/ui.stats`（先从 Task 做起）
3. `src/components/tool/*` / presenters：优先读 `result.ui`，否则 fallback 旧路径（不破坏现有）

**兼容策略（关键）**

* **永远不改 `ToolResult.content` 的语义**：它就是发给模型的文本结果
* UI 只“可选读取” `ui`，缺失则旧逻辑兜底

---

# 需要你补充的证据（如果你愿意给，我能把 tokens / cache 口径做得更准）

你已经说可以补，我建议优先补这 3 类（每类 1 条就够）：

1. **完整 SSE 序列**：包含 `message_start` 与 `message_delta` 的 usage（看看 usage 是“增量”还是“最终快照”）
2. **prompt caching 相关 usage**：出现 `cache_creation_input_tokens/cache_read_input_tokens` 的一条（你抓包里提到 ephemeral/prompt caching，我想对齐 UI 的 breakdown）
3. **失败工具的 tool_result**：`is_error: true` 时 content 的形态（是否总是字符串？是否会返回结构化 JSON？），方便我给你更稳的 presenter 兼容建议（你 engine 会把 `is_error` 透传回 messages）

---

如果你愿意，我也可以基于你现在 `TaskSubAgentToolHandler` 的实现（你动态行渲染做得很接近 Claude Code 了）直接给一份“最小 diff 级别”的伪代码：把 `usage` 从 SSE → StreamEvent → onSubEvent 聚合 → Done 行展示，一次性打通。
