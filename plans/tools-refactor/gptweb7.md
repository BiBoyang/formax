下面是基于你点名的 4 个证据文件（0030/0031/0035/0039）的“更新版结论 + 可落地接口/模板”，按你要求的 5 点输出。

---

## 1) 逐字提取 0030 的注入块模板 + Formax 的 TTL/截断/visibility 策略

### 0030 注入块（逐字模板）

**A) Plan mode reminder（system-reminder）**
在 0030 的 user content 里出现（注意：这是“塞进消息内容”的提醒块，不是 system 数组）。

> 由于 repomix 包里该段在一行中被省略成 `....`，我这里“逐字”只能按你证据文件里呈现的原样（包含省略号）提取。

**B) Caveat + local-command-stdout（完整可逐字拷贝）** 

```text
Caveat: The output you see below is the output of running the local command: /plan

<local-command-stdout>
  ? for shortcuts
 ⏵⏵ accept edits on (shift+tab to cycle)
  ⏸ plan mode on (shift+tab to cycle) 
</local-command-stdout>
```

> 这个块非常关键：它把“本地命令 stdout”作为一种 **LLM 可读的上下文注入**，同时用 Caveat 明确来源/可信度边界。

---

### Formax 建议：TTL / 截断 / visibility（按块类型）

我建议把注入块统一抽象成 **InjectedBlock**，每个块显式声明 “给 LLM？给 UI？进 history？”：

```ts
type Visibility = {
  toLLM: boolean
  toUI: boolean
  toHistory: "never" | "summary" | "full"
}

type InjectedBlock = {
  kind: "system-reminder" | "local-command-stdout" | "caveat"
  text: string
  visibility: Visibility
  ttlTurns: number          // 在多少个 turn 内可被自动附带
  maxCharsForLLM?: number   // 进入 LLM 的截断
  maxLinesForUI?: number    // UI 折叠阈值
  redaction?: "none" | "secrets" | "paths" // 可选
}
```

#### A) Plan mode reminder（system-reminder）

* **toLLM**: ✅ 每个 turn 都要注入（因为你不想靠“历史里残留的提醒”来维持模式约束）
* **toUI**: ❌ 不展示正文，只展示一个状态灯（Plan Mode On）
* **toHistory**: `never`（不要污染对话历史；你可以由本地 modeState 决定每次注入）
* **ttlTurns**: `1`（每次 buildMessages 时生成一次）
* **截断**：不用截断（短）

#### B) Caveat

* **toLLM**: ✅（和 stdout 一起出现，帮助模型正确理解“这不是用户说的”）
* **toUI**: ✅（UI 可以展示一行轻提示即可）
* **toHistory**: `never`
* **ttlTurns**: `1`

#### C) local-command-stdout

* **toLLM**: ✅ *但只建议“默认仅附带最近一次，并且严格截断”*
* **toUI**: ✅（UI 要显示，且建议默认折叠）
* **toHistory**: 推荐 `summary`（比如只保留 command + hash + 前 N 行；全文不要进历史）
* **ttlTurns**: `1~2`（建议 1；如果你想支持“用户下一句问上面的输出”，可给 2）
* **maxCharsForLLM**: 建议 `2k~6k`（超过就 head+tail）
* **maxLinesForUI**: 建议 `12~20` 行折叠（展开看全文）

> 关键点：**把“LLM history”与“UI transcript”解耦**。UI 可以显示完整 stdout，但 LLM 注入要短、可控、可丢弃。

---

## 2) 0031 的 bash-policy 元请求：可能用途 + Formax 最小实现与落点

你这次补齐的证据非常像 Claude Code 的“Bash 前置识别/前缀归一化”链路。

### 0031 可能在做什么？

从工具清单里能看到 Claude Code 把 Bash 拆成了大量“带前缀约束”的变体，例如 `Bash(claude tasks:*)`、`Bash(rm:*)`、`Bash(wc:*)` 等。
这强烈暗示：**它需要先把用户/系统即将执行的 command 归一成一个“prefix”**，再用 prefix 去：

1. 命中 allowlist（免确认执行）
2. 命中 denylist（直接拒绝）
3. 否则进入 “需确认/需提升权限/需解释风险” 流程

你把 0031 描述为 “Bash policy / command 识别元请求”，结合上面的 `Bash(prefix:*)` 体系，基本可以确定它就是在给 Bash 做 **policy routing**。

### Formax 最小实现（不需要先上小模型）

**先做本地规则版**（ROI 更高、可控、可 debug），把 0031 的“元请求”降维成一个纯函数：

```ts
type BashRisk = "allow" | "confirm" | "deny"

type BashPolicyDecision = {
  prefix: string            // e.g. "git", "npm run build", "claude tasks"
  risk: BashRisk
  reason?: string
  matchedRule?: string
}

interface BashPolicy {
  classify(command: string, mode: { planMode: boolean }): BashPolicyDecision
}
```

**落点建议（两种都行，推荐 1）**

1. ✅ **Bash handler 前置校验**：在真正 spawn 之前调用 `policy.classify()`

   * 好处：离执行最近，不会漏
2. 或者 **统一 ToolPolicy middleware**：ToolExecutor 调度前做

   * 好处：以后可扩展到 Edit/Write/NotebookEdit 等

> 你现在已经有“plan mode 限制只读工具”的概念，这里只要把 planMode 作为 policy 的输入即可。

---

## 3) 0035 的 filepaths-extract：怎么集成到 Formax（规则优先 vs 小模型优先）+ 数据结构 + UI

### 0035 在做什么（从输出形态看）

0035 的输出非常“结构化且轻量”：返回 `<filepaths>...</filepaths>` 以及 `<is_displaying_contents>false</is_displaying_contents>`。
这说明它想解决两件事：

1. **从 stdout/上下文中提取文件路径集合**
2. 判断 stdout 是否在“展示文件内容”（如果展示了，后续就不要重复 Read / 或要小心把大量内容塞进上下文）

### 集成策略：规则优先，模型兜底（建议）

* **规则优先**：regex/path heuristic（快、稳定、不会“凭空编造路径”）
* **小模型兜底**：当规则提取“低召回/低置信”时，才发一次 `filepaths-extract` 控制面请求（Haiku，无 tools）

### 数据结构建议（你点名的 touched/read/modified）

```ts
type FilepathExtract = {
  touchedFiles: string[]
  readFiles: string[]
  modifiedFiles: string[]
  isDisplayingContents: boolean
  confidence: number // 0~1
  source: "rule" | "llm"
}
```

### UI 展示建议（折叠/展开）

* 默认折叠一行摘要：`Files: 3 read · 1 modified`（可点击展开）
* 展开后分组展示：

  * Read: …
  * Modified: …
  * Touched: …
* 如果 `isDisplayingContents=true`：

  * 摘要行加一个标记：`(contents shown)`
  * 并把这些文件加入 “AlreadyInTranscript” 集合，避免下一步 agent 再 Read 一遍导致上下文爆炸

---

## 4) 0039 “控制面 JSON 流式截断/失败”怎么降级（忽略/重试/回退 title）

你给的 0039 证据很典型：topic router 要求只输出 JSON，但流式结果只到 `{` 就断了。

### 推荐降级策略（简单且不误导）

按优先级：

1. **忽略本次结果**（不更新 title/topic，不影响主对话）
2. **回退 title/topic**：

   * 保留上一次有效 title
   * 或用本地 heuristic（取用户输入前 10~20 字，去标点）生成临时标题
3. **可选：重试一次**

   * 条件：仅当这是“新会话/新 topic 强相关”的关键控制面请求
   * 重试策略：`stream=false` + 更小 `max_tokens` + 更严格 JSON-only 提示
   * 仍失败：立刻放弃，避免卡死主流程

### 实现模板

```ts
type ControlPlaneResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "truncated" | "invalid_json" | "timeout"; raw: string }

function safeParseJson<T>(raw: string): ControlPlaneResult<T> { /* ... */ }

type TopicRouterOut = { isNewTopic: boolean; title: string | null }

async function runTopicRouter(...): Promise<ControlPlaneResult<TopicRouterOut>> { /* ... */ }
```

---

## 5) 3 步“最小改动”落地清单（改哪些文件 + 关键函数签名）

> 目标：先把 **mode 注入 + local command 注入 + bash policy + filepaths extract + 控制面失败降级** 串起来，但不大改你现有 StreamEvent/REPL 架构。

### Step 1 — Prompt 注入层：把 0030 的三段注入做成可组合的 InjectedBlock

**改动文件**

* `src/prompts/...`（新增一个：`src/prompts/injections.ts`）
* `src/chat/engine.ts`（buildMessages 处接入）

**关键签名**

```ts
// src/prompts/injections.ts
export function buildInjectedBlocks(input: {
  mode: { planMode: boolean }
  lastLocalCommand?: { command: string; stdout: string }
}): InjectedBlock[]

// src/chat/engine.ts
export function buildMessages(args: {
  history: Msg[]
  userText: string
  injected?: InjectedBlock[]
}): AnthropicMessagesPayload
```

### Step 2 — REPL 控制面：记录 local command，并决定“注入到下一条 user turn”

**改动文件**

* `src/features/repl/useReplController.ts`
* （如有）`src/features/repl/replUiContext.ts`

**关键签名**

```ts
type LocalCommandRecord = { command: string; stdout: string; ts: number }

function appendLocalCommand(rec: LocalCommandRecord): void
function applyMode(patch: Partial<{ planMode: boolean }>): void
```

注：**history 里不要存 InjectedBlock**；只存纯 userText + assistant/tool 结果。InjectedBlock 每次发送前从 state 计算生成。

### Step 3 — Bash 前置 policy + filepaths-extract 后处理 + 0039 topic router 降级

**改动文件**

* Bash handler：`src/tools/.../bash.ts`（或你项目里 Bash module 的具体文件）
* ToolExecutor 或统一 middleware：`src/agent2/tools/ToolExecutor.ts`（示例名）
* 控制面请求模块：`src/controlPlane/...`（新增）

**关键签名**

```ts
// bash policy
interface ToolPolicyEngine {
  beforeToolCall(call: { name: string; input: any }, ctx: { mode: ModeState }): Promise<void>
}

// filepaths extract (rule-first, llm-fallback)
function extractFilepathsFromOutput(args: {
  command: string
  stdout: string
}): Promise<FilepathExtract>

// topic router safe parse
function safeParseJson<T>(raw: string): ControlPlaneResult<T>
```

---

如果你愿意，我下一步可以直接按你现有代码结构（你 repomix 里真实的文件路径/类型名）把上述接口“对齐到你项目里的实际命名”（比如你现在的 StreamEvent 枚举、ToolPresenter 的 message.toolInfo、TaskSubAgentToolHandler 的聚合位置等），做到你复制接口就能开干。
