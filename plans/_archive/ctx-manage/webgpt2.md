## 最终架构图 / 数据流（文字版）

```
┌─────────────────────────┐
│        Ink UI            │
│  messages[] (完整保留)   │
│  - user/assistant/tool    │
│  - 显示“Thread compacted” │
│  - Context Meter UI       │
└────────────┬────────────┘
             │(用户输入 text)
             v
┌─────────────────────────┐
│ useReplController.send() │
│ - commandRegistry.dispatch("/...")         │
│ - historyRef: ChatHistory (prompt 侧)      │
│   与 messages[] 解耦（UI 不回收）          │
└───────┬───────────┬─────┘
        │           │
        │           ├─(注入) injectedBlocks (ephemeral)
        │           │   - CLAUDE.md（<=200k chars）
        │           │   - todo reminders
        │           │   - plan mode reminder
        │           │   - local-command-stdout
        │           │  （写入模型前拼接，写入 history 后再 strip 掉）
        │           │
        │           v
        │    ┌──────────────────────────┐
        │    │ PreflightContextCheck     │
        │    │ 1) resolveContextWindow() │
        │    │ 2) tokenEstimate/usage    │
        │    │ 3) auto-compact?          │
        │    └──────────┬───────────────┘
        │               │(需要 compact)
        │               v
        │    ┌──────────────────────────┐
        │    │ CompactManager            │
        │    │ - summarize(prefix)       │
        │    │ - rebuild prompt-history  │
        │    │ - 保证 tool_use/result 成对│
        │    │ - UI 插入事件行           │
        │    └──────────┬───────────────┘
        │               │
        v               v
┌─────────────────────────────────────────┐
│ ChatEngine.runTurn() (tool loop)        │
│ - client.streamOnce() 产出 StreamEvent  │
│ - tool_use → executeTool → tool_result  │
│ - tool_result 写入 prompt-history 前做 truncate │
└──────────┬──────────────────────────────┘
           │ StreamEvent: assistant_delta / tool_* / usage
           v
┌─────────────────────────┐
│ UI 更新: messages[]      │
│ - assistant streaming    │
│ - tool message + usage   │
│ - meter 使用 usage 或估算│
└─────────────────────────┘
```

关键“事实约束”映射到你现有 Formax：

* **UI messages 与 prompt-history 解耦**：`useReplController` 同时维护 `messages` state 与 `historyRef`（prompt 侧历史）
* **注入块会在写入 history 后剥离**：`stripInjectedBlocksFromHistory(...)`
* **已有 usage 数据结构（provider 可缺失）**：`StreamEvent` 里有 `usage` 与 tool_update.usage，`TokenUsage` 为可选字段集合
* **已有 CLAUDE.md 注入且有字符上限**：`MAX_CLAUDE_MD_CHARS = 200_000`
* **slash command kind 至少覆盖 local/local_async/llm（send 分支可见）**（你要求不要假设其它 kind；即使代码里出现 unimplemented，也不依赖它）

---

## 超细 Checklist（P0 / P1 / P2）

> 说明：下面两块是你点名的**关键缺口**（context window 数据源表 + /compact 总结模板&边界用例）。我先把“可直接拷进代码/配置”的内容给全，然后再给按阶段的超细落地 checklist。

---

### A) Provider / Model Context Window 数据源策略 + 对照表（可直接落地）

#### A1) 数据源优先级（实现时按这个顺序 resolve）

1. **用户显式 override（最可信）**

   * `cfg.llm.contextWindowTokens` 或 `cfg.llm.modelContextWindows[model]`（建议支持按 model 前缀匹配）
2. **provider 返回的模型元数据（如果有）**

   * 自建 proxy / 自定义 provider 可能在 models 接口返回 `context_length / context_window` 等字段（你现有 `models.ts` 已经读取了 `context_length`，但目前把它塞进 `max_tokens` 了——建议改为“分别存 max_output_tokens 与 context_window_tokens”，见 P0 checklist）
3. **内置静态表（官方文档可追溯）**

   * 本次你要补齐的主要缺口：给 Anthropic / OpenAI 常见模型提供 context window
4. **兜底**（缺证据，需要验证）

   * 若仍未知：UI meter 显示 `unknown`；auto-compact 关闭或使用非常保守的默认（例如 8k），并打印一次 warning 引导用户配置 override

#### A2) Context window 对照表（Anthropic + OpenAI 常见模型）

> 说明：Formax `getDefaultModels()` 已内置 Anthropic 与 OpenAI 的常见 model id（如 `claude-3-5-sonnet-latest`, `gpt-4o` 等）。下面表按这些“常见/默认”优先覆盖。

| Provider  | Model（alias / 常见 id）                                            | Context window (tokens) | 官方来源                                                                             |
| --------- | --------------------------------------------------------------- | ----------------------: | -------------------------------------------------------------------------------- |
| Anthropic | `claude-3-5-sonnet-latest`（及 snapshot 前缀 `claude-3-5-sonnet-*`） |                 200,000 | Claude 3.5 Sonnet 发布说明明确写 “200K token context window”                            |
| Anthropic | `claude-3-5-haiku-latest`（及 `claude-3-5-haiku-*`）               |                 200,000 | Claude Docs 的 legacy models 表里包含 “Claude Haiku 3.5 … Context window 200K tokens” |
| Anthropic | `claude-3-opus-latest`（及 `claude-3-opus-*`）                     |                 200,000 | Claude 3 family 发布说明：Context window 200K（并在 Opus/Haiku 等处出现）                     |
| Anthropic | `claude-3-sonnet-latest`（及 `claude-3-sonnet-*`）                 |                 200,000 | 同上：Claude 3 family Context window 200K                                           |
| Anthropic | `claude-3-haiku-latest`（及 `claude-3-haiku-*`）                   |                 200,000 | 同上：Claude 3 family Context window 200K                                           |
| OpenAI    | `gpt-4o`（及 `gpt-4o-*`）                                          |                 128,000 | GPT-4o 模型页写明 “128,000 context window”                                            |
| OpenAI    | `gpt-4o-mini`（及 `gpt-4o-mini-*`）                                |                 128,000 | GPT-4o mini 模型页写明 “128,000 context window”                                       |
| OpenAI    | `gpt-4.1`（及 `gpt-4.1-*`）                                        |               1,047,576 | GPT-4.1 模型页写明 “1,047,576 context window”                                         |
| OpenAI    | `gpt-4.1-mini`（及 `gpt-4.1-mini-*`）                              |               1,047,576 | GPT-4.1 mini 模型页写明 “1,047,576 context window”                                    |
| OpenAI    | `o1`（及 `o1-*`）                                                  |                 200,000 | o1 模型页写明 “200,000 context window”                                                |

补充（对实现很关键）：

* OpenAI 文档强调 context window 是**input+output（以及某些模型还含 reasoning tokens）**的总量，并提到可用 `/responses/compact` 做 compaction（这是 OpenAI 官方“压缩”路线，可当对标参考）

#### A3) 建议默认值（effective_window_percent / auto_compact_percent / baseline_tokens）

> 目标：**provider-agnostic** + **对缺失 token usage 友好** + **不轻易溢出**。

1. `effective_window_percent = 0.95`（默认）

   * 原因：你在没有精准 tokenizer 或 provider token 统计不全时，需要留 5% buffer 抵抗估算误差、系统块/工具 schema 变动、以及模型端额外开销。
2. `auto_compact_percent = 0.90`（默认）

   * 原因：在到达硬上限前触发 compact（留出生成 summary prompt + summary output + 下一轮响应空间）。
   * 建议实现：`autoCompactLimit = floor(contextWindow * auto_compact_percent)`；`hardSendLimit = floor(contextWindow * effective_window_percent)`；触发条件用二者之一或并用（见 P1）。
3. `baseline_tokens`（建议别用常量；用**动态**，并允许回退到常量）

   * 推荐公式（落地版）：

     * `baselineTokens = clamp(2000, 12000, ceil(contextWindow * 0.10)) + reservedOutputTokens`
     * `reservedOutputTokens` 建议用 `cfg.llm.maxTokens` 或 modelInfo.max_tokens（你当前模型默认 max_tokens 例如 gpt-4o 是 16384；Anthropic Sonnet/Haiku 默认 8192）
   * 为什么：

     * 常量 12000 只适用于大窗；对小窗模型会把 meter 直接打爆。
     * 动态 baseline 能“像 Codex 一样”避免 UI 永远显示 100%，同时对不同窗大小自适应。

---

### B) `/compact` 总结提示词模板 + 至少 15 个边界用例（可直接用）

#### B1) Summarization Prompt 模板（System / Developer / User 三段）

> 你当前 prompt 结构是：`system: PromptBlock[]` + `messages: PromptMessage[]`。Anthropic 没有原生 developer role，但你可以把 “DEVELOPER” 段作为 **system 的第二段文本块**（例如 `<developer>...</developer>`）来保持结构一致（provider-agnostic）。

**SYSTEM（强约束，禁止工具调用，禁止输出杂项）**

```
You are a conversation compaction engine for a CLI coding assistant.

Your task:
- Produce a faithful, concise summary that will replace older dialogue in the model prompt history.
- The summary MUST preserve: user intent, constraints, preferences, decisions, key facts, and unfinished tasks.
- The summary MUST keep the assistant able to continue tool-using work after compaction.

Hard rules:
- Output ONLY the summary in Markdown.
- Do NOT call tools or propose tool calls.
- Do NOT include the full transcript.
- Do NOT invent facts. If uncertain, mark as "Unknown".
- Redact secrets (API keys, tokens, passwords).
- Keep the summary within the target length budget.
```

**DEVELOPER（输出格式 & 必须包含的槽位）**

```
Output format (Markdown), in this exact order:

# Conversation Summary
## Current goal
## User preferences & constraints
## Important context & facts (source-of-truth pointers)
## Work completed so far
## Open tasks / next steps (actionable checklist)
## Open questions / blockers
## Tool / environment state (only if relevant)
- cwd:
- repo / branch:
- running background tasks (ids):
- files touched:
## Verbatim snippets to preserve (ONLY if user explicitly requested exact wording)
- (max 20 lines total)
```

**USER（触发指令；你可以固定这一句）**

```
Summarize the conversation so far using the required format.
Focus on information that will help continue the work without the full history.
```

> **实现落地提示**：
>
> * 建议用 `temperature=0`（或等价参数）降低“编造 summary”的风险（缺证据，需要验证：你当前 anthropic client 是否暴露 temperature；如果没有就忽略）。
> * summary 的目标 tokens：建议 800~1500（大窗），小窗可 400~800。

#### B2) 至少 15 个边界用例清单 + 策略（我给 20 个）

|  # | 边界用例                                        | 主要风险                            | 处理策略（落地动作）                                                                                          |
| -: | ------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
|  1 | tool 输出超长（Read/Bash stdout/HTTP body）       | 单条撑爆上下文；summary 输入含大量噪音         | **先 truncate 再入 history**（见 P0），并在截断标记里写明“保留头尾/行数/原因”；summary 只需引用“已截断，必要时重跑工具”                     |
|  2 | 注入的 `<local-command-stdout>` 很长             | injected block 每轮都注入，重复消耗       | 对 injected block 也做 truncate（尤其 stdout）；并在 summary 不重复记录 stdout 全文，只记录结论/错误码                        |
|  3 | CLAUDE.md 体积大（接近 200k chars）                | 每轮都注入，影响 meter & auto-compact   | 你已有 `MAX_CLAUDE_MD_CHARS`；再加“按段截断 + 仅保留头尾”策略；meter 里把 injected 也算进 baseline                         |
|  4 | 计划模式（plan mode）开着                           | summary 不包含计划信息，后续断片            | summary 要写 “Plan mode: on/off + plan file path”；计划正文放文件里（指针即可）                                      |
|  5 | todo reminder 的 `<system-reminder>` 被当成用户内容 | summary 被污染/重复                  | summary prompt 指示“忽略 system-reminder 标签内容，除非它包含未完成 TODO”                                            |
|  6 | 多 tool_use 在同一 assistant message            | trimming/compact 容易破坏配对         | tail 选择必须保证 **tool_use ↔ tool_result 成对**（见 P0/P1：safe boundary 算法）                                 |
|  7 | tool_result 以错误结束（is_error）                 | summary 误判已完成                   | summary 中必须记录最近关键错误 + 重现步骤 + 待修复任务                                                                  |
|  8 | streaming assistant_delta 很长                | prompt-history 爆炸；summary 输入过长  | P1 再做“assistant message 超长截断策略”（只截 prompt-history，不截 UI）                                            |
|  9 | 多工具并发/嵌套（Task 子代理）                          | summary 丢失后台任务状态                | `tool_update.nestedTools` + `tool_update.usage` 已存在；summary “Tool state” 要列出正在运行的任务 id（如有）          |
| 10 | 用户要求“保留原文/逐字不改”                             | /compact 违反用户意图                 | auto-compact 遇到该指令应暂停；手动 `/compact` 需输出警告并要求用户确认（或提供 `/compact --force`，缺证据需验证：命令解析是否支持参数）          |
| 11 | 多语言对话（中文/英文混合）                              | summary 语言切换导致困惑                | summary 使用“用户当前语言”；若混合，按最近用户消息语言                                                                    |
| 12 | 模型切换（context window 变化）                     | meter & compact 阈值错             | 每轮 resolve context window；若 model 改变，立刻重算阈值并可触发一次“建议 compact”提示                                     |
| 13 | provider 不返回 usage                          | meter 不准，触发点抖动                  | meter 用估算；触发 compact 用保守阈值（effective 0.95 + auto 0.9）                                               |
| 14 | summary 调用本身超窗（历史太长）                        | /compact 失败，死循环                 | fallback：逐步减少 prefix（或先丢掉最老的已完成 turns）直到 summary 请求能发出；并在 UI 提示“部分历史无法纳入 summary（缺失）”               |
| 15 | summary 质量差/幻觉                              | 错误事实进入 prompt-history           | 系统提示禁止编造；必要时保存一份“compaction debug dump”（本地文件可选，P2）                                                  |
| 16 | trimming 时打破 tool_use/result 不变量            | orphan tool_result 或孤儿 tool_use | 实现 `validateToolPairs(history)`；删除时以“turn chunk”为单位，直到 validator 通过                                 |
| 17 | 用户在 /compact 后追问“刚才你删了什么？”                  | 信任受损                            | UI 插入事件行：`[Thread compacted: summary inserted, UI transcript unchanged]`，并提供 `/show-summary`（可选 P2） |
| 18 | 重要代码 patch 出现在历史里                           | summary 丢失关键变更                  | summary 必须列出“修改了哪些文件 + 关键变更点”；不贴全 patch                                                             |
| 19 | 敏感信息出现在 tool 输出（env/keys）                   | summary 泄漏                      | summary prompt 强制 redaction；truncate 标记也不应展示 secrets                                                |
| 20 | 用户正在被 AskUserQuestion 工具阻塞                  | /compact 可能改变对话状态               | 避免在“等待用户回答”期间 auto-compact；手动 /compact 输出提示并延后到回答后                                                  |

---

## P0（先能跑）Checklist

### P0-1 [PARALLEL] 新增 ContextWindowRegistry + Resolver（可被 meter / compact 共用）

* **目标**：给任意 `{provider, model}` 返回 `contextWindowTokens`，并提供“来源信息”（config / provider_meta / builtin / unknown）。
* **改哪些文件**

  * 新增：`src/context/contextWindow.ts`（或 `src/context/modelContext.ts`，按你项目风格）
  * 可能需要改：`src/services/models.ts`（补齐 modelInfo 的 context window 字段，见 P0-2）
* **实现要点**

  * 定义类型：

    * `export type ContextWindowSource = 'config' | 'provider_meta' | 'builtin' | 'unknown'`
    * `export type ContextWindowInfo = { tokens: number | null; source: ContextWindowSource; model: string; provider: string }`
  * 内置表：把上面 A2 的 mapping 做成 regex 列表（支持 snapshot）

    * Anthropic：`/^claude-3-5-sonnet/ → 200000` 等
    * OpenAI：`/^gpt-4o/ → 128000`、`/^gpt-4\\.1/ → 1047576`、`/^o1/ → 200000` 等
  * Resolver 输入：`(args: { provider: string; model: string; cfg?: RuntimeConfig; modelInfo?: ModelInfo })`
  * 输出：`ContextWindowInfo`
  * **unknown 的行为**：返回 `tokens: null`，并在调用方（meter/compact）显示 “unknown” 或触发“请配置 override”的单次 warning
* **DoD / 验收**

  * 单测（vitest）：`resolveContextWindowTokens('anthropic','claude-3-5-sonnet-latest') === 200000` 等
  * 单测覆盖 snapshot id：`claude-3-5-sonnet-20240620`、`gpt-4o-2024-08-06`
  * 手动：切换 config 到 openai provider 时（即使还没接 openai）也能显示 context window 数值（但不要求能调用）
* **风险点 & 回滚**

  * 风险：模型更新导致内置表过期
  * 回滚：保留 resolver，但只用 config override；内置表可以 feature-flag 关掉（例如 `cfg.context.enableBuiltinModelTable=false`）

---

### P0-2 [PARALLEL] 修正 / 扩展 `ModelInfo`：区分 max_output_tokens 与 context_window_tokens（避免把 context_length 当 max_tokens）

* **目标**：为后续 baseline / reserved output / meter 提供更准确字段。
* **事实依据**：你当前 `ModelInfo` 只有 `max_tokens?`；并且 custom api 的代码把 `context_length` 塞进 `max_tokens`（缺证据但从片段可见）。
* **改哪些文件**

  * `src/services/models.ts`
* **实现要点**

  * 把 `ModelInfo` 扩展为：

    * `max_output_tokens?: number`（保留原 `max_tokens` 也行，但建议逐步迁移）
    * `context_window_tokens?: number`
  * `getDefaultModels(provider)`：目前返回的 `max_tokens` 实际是“最大输出”（如 gpt-4o=16384）

    * **做法**：短期兼容：`max_tokens` 继续保留，但新增 `max_output_tokens=max_tokens`
  * custom API models：如果有 `context_length`，填进 `context_window_tokens`，不要再当输出上限
  * 在 `fetchAnthropicModels/fetchOpenAIModels` 返回结果上，调用 P0-1 的 resolver 回填 `context_window_tokens`
* **DoD / 验收**

  * 单测：`getDefaultModels('openai')` 的 gpt-4o 仍能保留 `max_tokens=16384`（兼容），同时有 `max_output_tokens=16384`（新字段）
  * 单测：当 custom API 返回 `{context_length: 200000, max_tokens: 8192}` 时字段不会混
* **风险点 & 回滚**

  * 风险：其它地方使用 `max_tokens` 假设它是“输出上限”
  * 回滚：先只“新增字段”不改旧字段语义；等全链路迁移后再清理

---

### P0-3 `/compact` 的核心：CompactManager（总结 + 重写 prompt-history；UI 不回收）

* **目标**：实现手动 `/compact`：生成 summary → 替换 prompt-history 的老部分，只保留最近 tail；UI messages 不删除，只插入一条事件提示。
* **改哪些文件**

  * 新增：`src/chat/compact.ts`（或 `src/chat/compactManager.ts`）
  * 新增：`src/prompts/compact.ts`（存放 B1 模板）
  * 修改：`src/prompts/index.ts`（导出 compact prompt builder）
  * 修改：`src/features/repl/useReplController.ts`（加入对 `/compact` 的执行逻辑；或通过 commandRegistry 注入 local_async）
* **实现要点**

  1. **summary 调用方式**（P0 先选最简单可跑方案）

     * 复用同一个 provider/model（当前会话模型）调用一次 LLM
     * `tools: []`，避免 summary 过程中 tool_use
     * 输入 messages：直接用 “需要总结的 prefix 历史” 作为 `messages`，system 用 compact system prompt
     * user message 用固定一句：“Summarize the conversation so far...”
  2. **重写 prompt-history**

     * `historyRef.current = [ summaryMessage, ...tailMessages ]`
     * summaryMessage 建议 role=assistant，内容用 `<conversation-summary>` 包裹
  3. **tool 配对不变量**

     * tailMessages 的起点必须是 “safe boundary”（见 P0-4）
  4. **UI 一致性**

     * `messages[]` 不删
     * 追加一条 UI 事件行（role=assistant 或 tool），例如：

       * `"[Thread compacted] Summary inserted into prompt-history; UI transcript unchanged."`
* **DoD / 验收**

  * 手动：

    1. 对话跑 5-10 轮，触发一些工具调用（确保 tool_use/tool_result 存在）
    2. 输入 `/compact`
    3. 继续提问：模型能继续理解上下文且仍可调用工具
    4. UI 中历史仍完整，出现 compact 事件行
  * 单测：

    * 构造带 tool_use/tool_result 的 history，compact 后 `validateToolPairs(tail)` 仍通过（见 P0-4）
* **风险点 & 回滚**

  * 风险：summary 质量不稳定/幻觉
  * 回滚：`cfg.context.compaction.enabled=false` 时 `/compact` 返回本地提示“不启用”；auto-compact 永不触发

---

### P0-4 实现 `safeTailStart()`：保证 trimming/compact 不打破 tool_use ↔ tool_result

* **目标**：无论是 `/compact` 选 tail，还是 fallback 删除最老历史，都不产生孤儿 tool_result / tool_use。
* **改哪些文件**

  * 新增：`src/chat/historyTrim.ts`（或并入 `src/chat/compact.ts`）
  * 可能新增测试：`src/chat/historyTrim.test.ts`
* **实现要点**

  * 提供两个函数：

    1. `collectToolPairs(history): { toolUseIds: Set<string>; toolResultIds: Set<string>; missing: ... }`

       * 从 assistant blocks 收集 tool_use.id
       * 从 user blocks 收集 tool_result.tool_use_id
       * 你 prompt block 类型已定义 tool_use/tool_result 结构
    2. `findSafeStartIndex(history, preferredStart): number`

       * 从 preferredStart 往前回退，直到满足：

         * tail 中所有 tool_result.tool_use_id 都能在 tail 中找到对应 tool_use.id
         * tail 中所有 tool_use.id 都能在 tail 中找到对应 tool_result.tool_use_id（如果你的历史保证每个 tool_use 都会有 tool_result）
  * 删除最老历史时，用 `dropOldestTurnChunk(history)` 而不是简单 shift：

    * 一次删除从开头到下一个“安全边界”（通常是 user 普通消息的起点）
* **DoD / 验收**

  * 单测：构造 history：

    * `assistant:[tool_use t1]` + `user:[tool_result t1]` + ...
    * preferredStart 落在 `user tool_result` 上时，函数会回退到包含对应 tool_use
  * 单测：dropOldestTurnChunk 后，validator 始终通过
* **风险点 & 回滚**

  * 风险：存在“异常 provider”产生 tool_use 但 stopReason 非 tool_use（理论上不该，但缺证据，需要验证）
  * 回滚：validator 失败时直接“不 trim、不 compact”并提示用户切换模型/减少上下文；或退化为“整段删除到下一个 user 普通消息”（更保守）

---

### P0-5 新增 `/compact` 命令（local_async），并让它能访问当前会话上下文

* **目标**：用户输入 `/compact` 触发 P0-3 CompactManager。
* **改哪些文件**

  * `src/features/commands/registry.ts`（注册命令；你要求 kind 仅 local/local_async/llm）
  * `src/features/repl/useReplController.ts`（把上下文传给 command 或在 send 内 special-case）
* **实现要点（两种落地路径，选其一）**

  * **路径 A（推荐，整洁）**：让 `dispatch(text)` 能拿到 “command ctx”

    * 给 dispatch 增加可选参数：`dispatch(text, ctx)`
    * ctx 包含：`getHistory(): ChatHistory`, `setHistory(next)`, `engine`, `cfg`, `tools`, `mode`, `planPath`
    * local_async.run() 在闭包里调用 compact
  * **路径 B（最快可跑）**：在 `send()` 里 special-case `if (text === '/compact') ...`

    * 不改 registry 签名；直接在 `useReplController.send` 前置处理
* **DoD / 验收**

  * 手动：输入 `/compact` 能跑通，且不影响其它 slash commands 的运行
* **风险点 & 回滚**

  * 风险：改 registry 接口会影响其它调用点（缺证据，需要全局搜索 `.dispatch(`）
  * 回滚：切回路径 B（send special-case），保持对外 API 不变

---

## P1（对齐体验）Checklist

### P1-1 Context Meter：当 usage 缺失时用估算；当 usage 有则用 usage

* **目标**：让 meter 可靠显示 “context window / used / remaining%”，并支持多模型 window。
* **事实依据**：`StreamEvent` 有 `usage` 与 `tool_update.usage`，但字段是可选的。
* **改哪些文件**

  * `src/features/repl/useReplController.ts`：在 `handleEvent` 收集 usage（以及最后一次 model）
  * 新增：`src/context/tokenEstimate.ts`
  * UI 组件（缺证据，需要验证具体文件）：Header/StatusBar 组件接入 `ReplControllerState`
* **实现要点**

  * 状态新增：`contextMeter: { model: string; windowTokens: number|null; usedTokens: number|null; remainingPct: number|null; source:'usage'|'estimate'|'unknown' }`
  * 计算 usedTokens：

    * 若收到 `ev.type==='usage'`：优先用 `sum(input_tokens + output_tokens + cache_*)`
    * 否则：用 `estimateTokens(historyRef.current + nextUserMessage + injectedBlocks + systemPrompt)`（见 P1-2）
  * remainingPct：基于 `effective_window_percent`，并扣除 baseline（A3）
* **DoD / 验收**

  * 手动：

    * 有 usage（Anthropic）时：meter 随对话增长变化
    * mock 一个 provider 不发 usage：meter 仍有估算值
* **风险点 & 回滚**

  * 风险：估算偏差导致 UI 抖动
  * 回滚：meter 只显示 windowTokens + “usage unavailable”（不展示 pct）

---

### P1-2 Token 估算策略（无 tokenizer 情况下的折中实现）

* **目标**：在 provider 不回 usage 时，能做“足够保守”的估算，用于 meter 与 auto-compact 触发。
* **改哪些文件**

  * 新增：`src/context/tokenEstimate.ts`
* **实现要点**

  * 提供 3 档策略（你可以先上 “折中”）：

    1. **快**：`ceil(utf8_bytes / 4)`（英文近似；中文偏差较大）
    2. **折中（推荐先做）**：按字符分类加权：

       * ASCII/空白：`chars/4`
       * CJK：`chars*0.75`（粗略；偏保守可用 `1.0`）
       * 代码块/JSON：按行数 * 平均 tokens/行（如 8-12）再与 bytes/4 取 max
       * 最终取 `max( bytes/4, weightedChars )`
    3. **准**（后续）：引入 provider tokenizer（tiktoken / anthropic tokenizer），或调用官方 tokenizer 工具（OpenAI 文档提到 tokenizer tool）
  * 估算粒度：对 `PromptBlock[]` 做累加；tool_use/tool_result 也算
* **DoD / 验收**

  * 单测：输入包含中文/英文/代码块，估算值单调增长且不为负
  * 手动：估算模式下 auto-compact 不会频繁误触发（用 effective 0.95 + auto 0.9）
* **风险点 & 回滚**

  * 风险：估算过小导致溢出
  * 回滚：加大 buffer：effective_window_percent 从 0.95 调到 0.90

---

### P1-3 Auto-compact 触发点：发起请求前 + tool loop 中间（两处都要）

* **目标**：对齐你之前观察的 Codex 行为：preflight + tool loop 继续超阈值仍 compact。
* **改哪些文件**

  * `src/features/repl/useReplController.ts`：在调用 engine 前做 preflight 检查
  * `src/chat/engine.ts`：在 tool loop 迭代前/后加“仍超阈值则 compact”的 hook（缺证据，需要验证 engine.ts 结构；但 engine.test 已存在 tool loop 行为）
* **实现要点**

  * Preflight：在 buildUserContent + injected blocks 完成后，估算下一次请求 tokens；超过 autoCompactLimit → 执行 compact
  * Tool loop：每一轮 tool_result 写入后，再估算一次；若仍超阈值 → compact（注意：此时必须保证 tool pairs 完整）
* **DoD / 验收**

  * 手动：构造一个工具输出很长的场景，能在 tool loop 中触发 auto-compact 而不是爆掉
* **风险点 & 回滚**

  * 风险：tool loop 中 compact 会改变 history，导致 tool executor 读到不同上下文（通常不依赖历史，可接受）
  * 回滚：P1 先只做 preflight；tool loop 的 compact 延后到 P2

---

## P2（增强）Checklist

### P2-1 分段/渐进式 compaction（解决“summary 调用本身超窗”）

* **目标**：历史特别长时，/compact 仍能产出高质量 summary，而不是靠删最老历史硬退化。
* **改哪些文件**

  * `src/chat/compact.ts`
* **实现要点**

  * Rolling summary：

    * 若 history 中已存在 `<conversation-summary>`，将其作为 `existingSummary`
    * 每次只总结 `existingSummary + nextChunk`，生成更短的新 summary
  * chunk 划分必须对齐 tool pairing：chunk 边界是 safe boundary
* **DoD / 验收**

  * 手动：构造超长对话（>50 turns），多次 `/compact` 后仍能保持关键任务/偏好
* **风险点 & 回滚**

  * 风险：多次摘要累计信息损失
  * 回滚：提供 `/compact --full`（缺证据需验证参数解析）或提示用户导出会话

---

### P2-2 `/show-summary` & `/export-thread`（降低用户困惑）

* **目标**：让用户可见“prompt-history 发生了什么”，但不破坏 UI transcript 完整。
* **改哪些文件**

  * `src/features/commands/registry.ts`：新增 `/show-summary`（local）
  * UI：可选，将 summary 显示为只读块（不进入 prompt-history）
* **DoD / 验收**

  * 手动：/show-summary 能输出当前 summary（如果存在）
* **风险点 & 回滚**

  * 风险：summary 暴露敏感信息
  * 回滚：summary 输出做 redaction，或默认关闭该命令

---

## 风险清单 & 最小回滚策略

### 主要风险

1. **模型 context window 表过期**（模型更新/alias 迁移）

   * 缓解：支持 config override；resolver 返回 source；UI 显示来源与“unknown”提示
2. **token 估算偏差导致溢出**

   * 缓解：effective_window_percent=0.95（必要时 0.90）；auto_compact_percent=0.90；溢出时 fallback 删除最老 turn chunk
3. **/compact summary 质量问题（幻觉/丢关键信息）**

   * 缓解：temperature=0；prompt 明确禁止编造；P2 做 rolling summary 并保留指针（文件/命令/错误）
4. **tool_use ↔ tool_result 配对被破坏**（这是硬约束）

   * 缓解：任何 trim/compact 都走 validator；不通过则继续回退边界或停止操作
5. **UI 与 prompt-history 不一致导致困惑**

   * 缓解：插入 UI 事件行；P2 提供 /show-summary

### 最小回滚策略（保证“出问题立刻能退”）

* 增加总开关（建议在 config）：`cfg.contextManagement.enabled`

  * 关闭后：

    * 不做 auto-compact
    * `/compact` 返回本地提示“disabled”
    * meter 只显示模型名（不显示 percent）
* 所有新逻辑尽量以“旁路模块”形式实现：

  * `resolveContextWindowTokens()` 独立
  * `compactHistory()` 独立
  * `safeTailStart()` 独立
    → 出问题时可以只回滚调用点，不必回滚整个 chat/streaming

---

如果你希望我把 **P0 里每个 TODO 的“更细一层（到函数级别的伪代码 + 关键 patch 片段）”**也写出来（例如 `findSafeStartIndex()` 的具体扫描逻辑、summary message 的插入格式、以及如何在 `useReplController` 里插入 compact 事件行），我可以按你这份 repomix 的真实路径继续把 P0-3/P0-4 拆到“照着写就能过单测”的粒度。
