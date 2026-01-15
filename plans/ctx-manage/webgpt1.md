

## 1) Executive Summary（<=10 bullets）

* **在 Formax 里新增一个“ContextManager（上下文管理器）”模块**：统一负责 token 估算/校准、阈值判断、单条截断（truncate）、整体压缩（compact）、以及“硬兜底删除最老历史直到可发送”。
* **Meter 的核心口径对齐 Codex**：引入 `context_window`、`effective_context_window_percent`（Codex 默认为 95%）与 `baseline_tokens`（Codex 文档示例为 12000，Formax 建议做成“可配置 + 动态估算”双模式），计算“可用上下文预算”并输出剩余百分比（不足的部分标记为“缺证据，需要验证”见下表）。
* **“有 usage 用 usage；没 usage 用估算”**：Formax 已有 `TokenUsage` 与 `StreamEvent.usage` 类型，但目前未看到 provider 真正发出 usage（缺口）；因此 P0 先做估算，P1 再补齐 provider usage 解析/上报，并用 usage **校准估算因子**。 
* **Truncate 放在 ChatEngine 写入 prompt-history 的位置做**：Formax 的 `runTurn` 会把 tool 结果写回 `loopMessages`（即 prompt-history），这是最适合做“只截断 prompt、不影响 UI 全量展示”的钩子点。 
* **Compact 采用“UI transcript 不回收、prompt-history 被替换”**：Formax 已天然分离 `messages(UI)` 与 `historyRef(prompt)`，compact 只改 `historyRef`，并在 UI 插入一条“Thread compacted”提示行避免用户困惑。 
* **手动 `/compact` 用“local-run”斜杠命令实现**：Formax 已支持 `slashEffect.kind === 'local-run'`（异步执行），非常适合做一次额外 LLM 调用生成 summary 并重写 prompt-history。 
* **Auto-compact 触发点采用“双触发”**：① 发起请求前 preflight；② tool loop 内每轮追加 tool_result 后再次检查（对齐 Codex 的“run_turn 前 + tool loop 中”的思路）。
* **失败降级策略明确**：compact 失败或 summary 仍超窗 → 逐步删除最老历史（类似 Codex 的 `remove_first_item` fallback）直到可发送，并向 UI 发事件提示。 
* **“易爆炸内容”优先级**：tool_result（尤其 Bash/本地命令 stdout）、CLAUDE.md 注入、超长 assistant 文本块；全部要求“可解释截断”（头/尾保留 + 原始大小/行数 + 原因 + 省略标记）。
* **P0→P1→P2 分阶段落地**：P0 先把 meter+truncate+手动 compact 跑通并确保永不“context window exceeded”；P1 对齐 Codex 体验（auto-compact、usage 校准、UI 事件）；P2 增强（可选 tokenizer、抓包验证、错误重试）。

---

## 2) Codex Facts Table（必须有，详尽）

> 说明：以下表格只把“在你提供的 deepwiki/repomix 证据里能落锤的点”写成事实；**任何没证据的点都显式标注“缺证据，需要验证（建议你在 Codex 源码里 grep）”**。
> Codex 侧引用主要来自：DeepWiki 页面  以及你 bundle 内的 Codex 相关摘录。

| 你要求的事实点                                 | Codex 事实（What）                                                                                                               | Codex 文件路径/函数名（Where）                                                                        | 证据                  | Formax 里怎么复刻/类比（How）                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token 统计事件从哪来、何时发送                      | Codex 在设置 token usage/full 信息后，会调用 `send_token_count_event` 发送 TokenCount 相关事件                                               | `codex-rs/core/src/codex.rs::set_total_tokens_full` → `send_token_count_event`               |                     | 在 Formax：在 `src/chat/engine.ts::runTurn` 每次 `streamOnce` 完成后（或每次写入历史后）调用 `onEvent({type:'context_update', ...})`（新增事件）                                 |
| TokenCount UI 如何消费（显示 meter）            | Codex TUI 有 status 指标读取：`context_remaining_percent()`、`percent_of_context_window_remaining(window)` 等，用于 UI 展示               | `codex-rs/tui/src/status/...`（DeepWiki 展示了这些方法）                                              |                     | Formax 在 UI Header/InputBar 读取 controller state 的 `contextMeter`，渲染百分比/进度条                                                                             |
| effective_context_window_percent 默认 95% | Codex 文档描述存在 effective context window percent，默认 95%（用于计算“有效上下文”）                                                            | **缺证据需要精确函数名**；DeepWiki “Error Handling…” 文档提及                                               |                     | Formax 增加 `cfg.context.effectiveContextWindowPercent` 默认 `0.95`；所有阈值按 `effectiveWindow = floor(contextWindow*percent)` 计算                              |
| BASELINE_TOKENS = 12000                 | DeepWiki 文档示例提到 baseline token budget=12,000（用于计算百分比/预留）                                                                     | **缺证据需要验证常量名/位置**（你要求的 `BASELINE_TOKENS`）                                                    |                     | Formax **不建议硬编码 12000**（不同模型会出问题）；实现 `baselineTokens` 可配置 + 默认“动态估算 system+tools+outputReserve”                                                        |
| percent remaining 算法                    | **缺证据，需要验证**：DeepWiki 提到会计算 remaining percent，但未在当前摘录中给出精确公式                                                                 | `codex-rs/tui/src/status/helpers.rs::percent_of_context_window_remaining`（建议你在本地 Codex grep） |                     | Formax 采用可解释公式：`available = effectiveWindow - baseline`; `remaining = max(0, available - used)`; `pct = remaining/available`；并在 P0 加“与 Codex 公式对照测试”任务 |
| auto_compact_token_limit 默认推导           | Codex config 里有 `model_auto_compact_token_limit`，用于触发自动 compaction                                                           | `codex-rs/core/src/config/mod.rs` 字段；`models_manager/model_info.rs` 将 config 注入 model info   |                     | Formax 增加 `cfg.context.autoCompactThreshold`（默认 0.9）与 `autoCompactTokenLimit = floor(contextWindow*0.9)`                                               |
| “默认= context_window 的 90%”              | **缺证据，需要验证**：你给出的“90%”与 DeepWiki 是否一致需要在 Codex 源码确认（建议 grep `0.9` 或 `90%`）                                                   | 建议你查：`codex-rs/core/src/config/mod.rs` / `session.rs` / `history.rs`                         | （缺证据）               | Formax 先实现为默认 0.9（可配置），并在 P0 的“对照 Codex”任务里验证                                                                                                          |
| Truncate 发生在什么环节                        | **你要求：写入 history 时截断 tool output（history.rs::process_item）** —— 目前 bundle 里只有文件列表，没有该函数实现片段                                  | `codex-rs/core/src/context_manager/history.rs::process_item`（来自你的 deepwiki 列表）               | （仅文件列表）             | Formax 直接对齐：在 `src/chat/engine.ts` 把 tool_result push 到 `loopMessages` 前进行截断（只影响 prompt-history）                                                       |
| tool/function output 截断策略               | **缺证据，需要验证**：你提到 “text + content_items” 截断；当前证据不足以确认 Codex 的具体格式与保留策略                                                        | `codex-rs/core/src/truncate.rs`（来自你的 deepwiki 列表）                                            | （仅文件列表）             | Formax 自定义“可解释截断”格式：头/尾保留 + size/lines + reason；并在 P1 可做与 Codex 输出格式对齐                                                                                 |
| 为什么在这里截断                                | Codex 设计动机：避免单条工具输出撑爆上下文（在历史写入阶段做最有效）                                                                                        | （动机在 issue/文档中常见）                                                                            | （GitHub issue 搜索结果） | Formax 也在 prompt-history 写入点截断（ChatEngine），保证 UI 能保留全量 tool result                                                                                     |
| Compact 触发时机                            | Codex 存在 auto-compaction 机制与手动 compact（Op::Compact），并有 inline/remote 两种实现路径                                                  | DeepWiki “Context Compaction” 描述 auto/remote/inline、以及 `Op::Compact`                         |                     | Formax：preflight + tool loop 内双触发；手动 `/compact` 用 slash local-run                                                                                      |
| tool loop 内仍超阈值也会 compact               | **缺证据，需要验证**：DeepWiki 摘录未展示“tool loop 内”触发点的精确逻辑（但 Codex 的整体描述倾向于多处检查）                                                       | 建议你查：Codex `run_turn` / tool loop 相关逻辑                                                       | （缺证据）               | Formax 直接实现（工程上必须）：tool loop 每轮追加 tool_result 后 check/compact/trim                                                                                     |
| compact 失败 fallback                     | Codex 有 `remove_first_item` 作为删除最老历史的 fallback（确保能继续）                                                                        | `codex-rs/core/src/context_manager/history.rs::remove_first_item`                            |                     | Formax：提供 `trimOldestUntilFits()`，按 message 级别从最老开始删，直到估算 <= effectiveWindow                                                                           |
| compact 如何重写 prompt-history             | Codex remote compaction 会用 compacted conversation items 替换 `conversation.input`（即 prompt transcript）并发 `ContextCompacted` 事件 | DeepWiki 显示：替换 conversation input、增加 compact_count、发 ContextCompacted                        |                     | Formax：`historyRef.current = [summaryMsg, ...tail]`；UI messages 不动；插入 UI “Thread compacted”提示                                                          |
| compact 后 UI 如何知道                       | Codex 发 `ContextCompacted` 事件（protocol event），UI 可据此显示提示                                                                     | DeepWiki “Context Compaction”                                                                |                     | Formax：新增 `StreamEvent` 分支 `context_compacted`，useReplController 处理并插入提示行/更新 meter                                                                     |
| “UI transcript vs prompt transcript” 分离 | Codex 通过“替换 prompt 输入 items”的方式保证模型上下文被回收，而 UI 侧仍可保留完整 transcript（设计理由：用户可见历史不丢、模型上下文可控）                                     | **缺证据，需要验证 Codex TUI 是否保留全量 UI transcript**（DeepWiki 摘录未直接说明）                                | （缺证据）               | Formax 已天然分离：UI `messages` 与 prompt `historyRef`；compact 只改 `historyRef`，UI 另插入提示避免困惑                                                                  |
| Remote compaction 调用                    | Codex remote compact 通过 OpenAI Compact API `/v1/compact`（从 `openai.rs` 发出）                                                   | DeepWiki 说明 remote compact endpoint                                                          |                     | Formax：先做 vendor-agnostic“用当前 model 额外调用一次 summary”；P2 可为 OpenAI provider 增加 `/v1/compact` 专用路径                                                        |

---

## 3) Formax Gap Analysis（对照 bundle：现状 vs 缺口）

### 已有能力（基于 bundle 证据）

* **UI messages 与 prompt-history 分离**：controller 里同时维护 `messages`（UI）与 `historyRef.current`（发给模型的历史）。
* **ChatEngine 已有 tool loop**：`src/chat/engine.ts::runTurn` 在 `streamOnce` 后把 `assistantBlocks` 写入 `loopMessages`，若 `stopReason==='tool_use'` 则执行工具并把 `tool_result` 写入历史后继续迭代。
* **已做 todo_stale reminder 拼接**：在 tool result 写回历史前，可能追加 `<system-reminder>`，属于“对 prompt-history 做改写”的先例。
* **streaming/types.ts 已定义 TokenUsage & usage 事件**：包含 `StreamEvent.usage` 与 `StreamTurnResult.usage`，但目前未看到 provider 实现一定会发出该事件（属于 gap）。
* **注入块机制已存在**：例如 `CLAUDE.md` 注入（ephemeral system-reminder）并按字符数 200k 截断；todo empty reminder 每回合注入。
* **system prompt 分 profile**（lite/full），且 full 会注入 rich env snapshot（潜在高 token 占用来源）。
* **模型元信息存在但字段语义混用风险**：`ModelInfo.max_tokens` 被当作通用上限字段使用（openai: gpt-4o=16384，anthropic: 8192 等），这未必是 context window（更像 max output tokens 或 provider 字段折中）。（= 后续 meter 的缺口）

### 关键缺口（需要你新增/对齐）

* **B1 Context Meter**：缺少“context window / 已用 tokens / 剩余百分比”统一状态与 UI 渲染；缺少 per-model context window 的可靠来源与 effective window/baseline。
* **B2 Truncate（单条内容截断）**：目前只有 CLAUDE.md 的字符截断，ChatEngine 写入 prompt-history 时**没有**对 tool_result/assistant 文本做“可解释截断”；本地命令 stdout 注入也未截断（可能瞬间爆窗）。
* **B3 Compact（整体压缩）**：缺少 `/compact`、缺少 auto-compact、缺少 compact 失败的 fallback 删除策略（Formax 需实现，Codex 有 remove_first_item）。
* **B4 Prompt vs UI 一致性策略**：虽分离天然存在，但缺少“用户可理解”的提示机制（比如插入“Thread compacted”事件行）与解释文案。

---

## 4) Implementation TODOLIST（P0→P1→P2，超细）

> 约定：所有新增逻辑尽量放在 `src/context/`（新目录）以便隔离；**ChatEngine 负责 prompt-history 层面截断/压缩；useReplController 负责 UI 状态与命令入口**。
> 你可以并行做标注了 **[PARALLEL]** 的任务。

### P0（先能跑：meter + truncate + 手动 compact + 硬兜底 trim）

#### P0-1 [PARALLEL] 新增 Context 配置结构与默认值

* **目标**：在运行时配置里加入上下文管理参数（window/effective/baseline/阈值/截断策略），后续各模块只依赖这一处。
* **改动文件/函数**：

  * `src/env/config.ts`（CODEMAP 指向：runtime config loader，需你本地打开确认结构）
  * 可能还需要：CLI 参数解析文件（CODEMAP 里应有，缺证据，需要验证）
* **实现要点**：

  * 新增 `cfg.context`（或 `cfg.llm.context`）字段：

    * `modelContextWindow?: number | Record<string, number>`（支持 per-model 覆盖）
    * `effectiveContextWindowPercent: number` 默认 `0.95`（对齐 Codex 默认）
    * `baselineTokens: 'dynamic' | number`（默认 `'dynamic'`；允许写死 12000 但要做 clamp）
    * `outputReserveTokens: number`（默认取 `cfg.llm.maxTokens` 若存在，否则 2048）
    * `autoCompactEnabled: boolean` 默认 false（P1 再开）
    * `autoCompactThreshold: number` 默认 0.9（对齐你期望与 Codex 常见配置）
    * `compactKeepLastTokens: number` 默认 20000（对齐你给的 Codex 行为目标，但 Codex 是否 20k 需验证）
    * `truncate` 子结构：`toolResultMaxTokens`, `assistantTextMaxTokens`, `injectedBlockMaxTokens`, `headChars`, `tailChars`
  * 对 `baselineTokens` 做安全处理：当 window 很小（8k）时，baseline 不能大于 window 的 50%（clamp）。
* **DoD / 验收**：

  * 手动：启动 Formax（任意 provider），打印 config（或 debug log）可看到 `cfg.context.*` 默认值。
  * 单测：config schema 校验（给无效 percent/负数阈值应报错）。
* **风险点 & 回滚**：

  * 风险：破坏现有 config 解析。
  * 回滚：保持 `cfg.context` 完全可选；无该字段则全走旧逻辑（不启用 meter/compact）。

#### P0-2 [PARALLEL] 实现 Token 估算器（无 tokenizer）

* **目标**：实现“没有 usage 也能估算 tokens”的基础能力，为 meter/阈值判断提供数据源。
* **改动文件/函数**：新增 `src/context/tokenEstimate.ts`（新文件）
* **实现要点**（提供 3 策略，P0 先落地折衷版）：

  1. **快**：`bytes/4`（UTF-8 字节数 / 4）
  2. **折衷（P0 默认）**：混合启发式：

     * `latinWordCount`、`cjkCharCount`、`punctCount` 扫描一次字符串
     * `est = max(bytes/4, latinWordCount*0.75 + cjkCharCount*1.0 + punctCount*0.2)`
     * 对代码块/JSON：额外加权（例如 `{}`, `:` 多的文本 token 更密）
  3. **准（P2）**：可选接入 tokenizer（动态 import tiktoken），若失败回退到折衷

  * 提供 API：

    * `estimatePromptBlockTokens(block: PromptBlock): number`
    * `estimateMessageTokens(msg: PromptMessage): number`
    * `estimateConversationTokens({messages, system, tools}): number`（工具定义 tokens 先用 `JSON.stringify(tools)` 估算）
* **DoD / 验收**：

  * 单测：对中文/英文/代码片段各给 3 个样例，确保估算值单调随长度增长；不会出现 NaN/负数。
  * 手动：在 REPL 打印估算 tokens（临时 debug），输入长文本能看到近似增长。
* **风险点 & 回滚**：

  * 风险：估算偏差大导致 auto-compact 频繁/不触发。
  * 回滚：P0 默认不启用 auto-compact；估算仅用于 UI 展示与“硬兜底 trim”。

#### P0-3 [PARALLEL] 建立 Model Context Window 解析策略

* **目标**：让 meter/阈值能根据“当前 model 的 context window”工作。
* **改动文件/函数**：

  * 新增 `src/context/modelWindow.ts`
  * 可能需要改：`src/services/models.ts`（仅用于 fallback）
* **实现要点**：

  * `getContextWindowTokens(cfg, modelId, provider, modelInfo?)` 优先级：

    1. `cfg.context.modelContextWindow`（若是 map 则按 modelId 命中）
    2. `cfg.context.modelContextWindowDefault`（可选）
    3. `ModelInfo.max_tokens`（**仅 fallback，且标注“不可靠”**，因为当前 bundle 里该字段可能不是 context window）
    4. 最后 fallback `8192` 并在 UI 标注“估算/未知模型窗口”
* **DoD / 验收**：

  * 手动：配置一个自定义 model window，meter 显示对应窗口；不配置时显示 fallback 并提示。
* **风险点 & 回滚**：

  * 风险：把 `max_tokens` 误当 context window 导致 meter 错误。
  * 回滚：默认不使用 `max_tokens` 作为 window（除非明确开启 `cfg.context.trustModelMaxTokens=true`）。

#### P0-4 [PARALLEL] 定义 Context Meter 数据结构与计算函数

* **目标**：输出 UI 可用的 “used / window / remaining% / 超阈值状态”。
* **改动文件/函数**：新增 `src/context/meter.ts`
* **实现要点**：

  * 定义：

    * `ContextMeterSnapshot = { model, contextWindow, effectiveWindow, baselineTokens, usedTokens, remainingTokens, remainingPercent, source: 'usage'|'estimate', updatedAt }`
  * 计算：

    * `effectiveWindow = floor(contextWindow * cfg.context.effectiveContextWindowPercent)`
    * `baselineTokens = cfg.context.baselineTokens === 'dynamic' ? estimate(system+tools)+outputReserve : clamp(cfg.context.baselineTokens)`
    * `usedTokens = estimate(conversation+pendingUser+system+tools) + outputReserve`（注意 outputReserve 单独加）
    * `remaining = max(0, effectiveWindow - baselineTokens - usedTokens)`
    * `pct = remaining / max(1, effectiveWindow - baselineTokens)`
* **DoD / 验收**：

  * 单测：baseline='dynamic' 与 baseline=number 两种模式都能给稳定输出；window 很小不会除零。
* **风险点 & 回滚**：

  * 风险：不同 provider 的“window 口径”不同（是否包含输出）。
  * 回滚：提供配置 `cfg.context.windowCountsOutput=true|false`（默认 true），必要时切换。

#### P0-5 在 useReplController 增加 ContextMeter 状态并在 send 前更新（preflight）

* **目标**：用户每次发送前 UI 就能显示“将要发送的上下文占用情况”。
* **改动文件/函数**：`src/features/repl/useReplController.ts`

  * send 流程中本就会 build user content、system prompt 并调用 `deps.engine.runTurn`
* **实现要点**：

  * 在 `send` 中、调用 `deps.engine.runTurn` 之前：

    * 组装本次 prompt 的 inputs（`historyRef.current` + 当前 user message content + system prompt + tools）
    * 调用 `computeContextMeterSnapshot(...)` 更新 state（例如 `setContextMeter(...)`）
  * 将 snapshot 存入 `ReplControllerState`（新增字段 `contextMeter?: ContextMeterSnapshot`）
* **DoD / 验收**：

  * 手动：输入短消息/长消息，发送前 meter 百分比随之变化。
* **风险点 & 回滚**：

  * 风险：send 逻辑复杂，插入计算可能影响性能。
  * 回滚：计算加 `debounce` 或仅在 `text.length > X` 时计算；或通过配置关闭。

#### P0-6 [PARALLEL] UI 渲染：Header/InputBar 加 Context Meter

* **目标**：在 UI 顶部或底部显示：context window、已用 tokens、剩余百分比（进度条）。
* **改动文件/函数**（来自 CODEMAP，需你本地确认组件结构；bundle 未检索到源码片段 → 缺证据，需要验证）：

  * `src/screens/REPL.tsx`（screen layout）
  * `src/components/chat/HeaderBanner.tsx` / `src/components/chat/InputBar.tsx`（CODEMAP 指向）
* **实现要点**：

  * 在 HeaderBanner 增加一行：`CTX: 42% · 54k/128k (eff 95%, base dyn)`
  * 若 `contextMeter.source==='estimate'`，显示 `~` 标记：`~54k`
  * 进度条（ASCII）：`[██████░░░░] 42%`（Ink Text 拼出来即可）
* **DoD / 验收**：

  * 手动：启动 REPL，顶部出现 meter；长对话占用上升；compact 后占用下降。
* **风险点 & 回滚**：

  * 风险：Ink 布局换行导致 UI 抖动。
  * 回滚：先只显示一行纯文本；P1 再加进度条/颜色。

#### P0-7 实现“可解释截断”工具函数（统一给 tool_result / injected blocks / assistant text 用）

* **目标**：把截断做成可复用、可解释、可测的函数。
* **改动文件/函数**：新增 `src/context/truncate.ts`
* **实现要点**：

  * API：

    * `truncateTextExplainable({ text, kind, maxTokens, headChars, tailChars, reason }): { text: string; meta: { originalChars, originalLines, keptHeadChars, keptTailChars, estTokensBefore, estTokensAfter } }`
  * 输出格式建议：

    * 第一行固定：`[TRUNCATED kind=tool_result reason="exceeds maxTokens" chars=123456 lines=3456 kept=head:2000 tail:2000]`
    * 中间：head + `\n…[omitted X chars / Y lines]…\n` + tail
  * 行数统计别用 `split('\n')`（大文本会占内存），用单次扫描计数 `\n`。
* **DoD / 验收**：

  * 单测：

    * 截断后仍包含 head 与 tail
    * meta 行包含 chars/lines
    * 空文本/短文本不截断
* **风险点 & 回滚**：

  * 风险：截断标记影响模型理解。
  * 回滚：提供 `cfg.context.truncate.includeMeta=false`（只省略不写 meta）。

#### P0-8 截断“本地命令 stdout 注入块”（避免一回合爆窗）

* **目标**：对 `<local-command-stdout>${rec.stdout}</local-command-stdout>` 做可解释截断。
* **改动文件/函数**：`src/features/repl/useReplController.ts::buildLocalCommandInjectedBlocks`（函数就在 controller 文件里）
* **实现要点**：

  * 在 `rec.stdout` 拼接进标签前，调用 `truncateTextExplainable(kind='local_command_stdout', maxTokens=cfg.context.truncate.injectedBlockMaxTokens, reason='injected block guard')`
  * 保留 head/tail，避免用户命令输出的关键信息被全切掉
* **DoD / 验收**：

  * 手动：执行会产生巨大 stdout 的本地命令（如 `cat bigfile`），下一回合不再因为注入块过大导致请求失败；UI 仍可查看完整工具输出（如果 UI 侧保存了 full result）。
* **风险点 & 回滚**：

  * 风险：模型拿不到完整 stdout，影响推理。
  * 回滚：只截断注入块，但保留“完整输出在 UI/tool result 中可见”的指引文字。

#### P0-9 改造 CLAUDE.md 注入：从“字符截断”升级为“token/可解释截断”

* **目标**：CLAUDE.md 当前只按 200k chars 截断，仍可能 token 爆炸；改成 token-aware + explainable。
* **改动文件/函数**：`src/features/repl/injectedBlocks.ts::buildClaudeMdInjectedBlocks`
* **实现要点**：

  * 保留现有 `MAX_CLAUDE_MD_CHARS` 作为硬上限，但在此之前先按 `maxTokens` 截断
  * 在注入块文本里包含 meta 行：原始 chars/lines、截断原因、保留头尾
  * **可选**：当截断发生时，在 UI 插入一条 info（“CLAUDE.md injected context truncated for prompt”）
* **DoD / 验收**：

  * 手动：CLAUDE.md 极长时，注入块会带 `[TRUNCATED kind=claude_md ...]`，且不会造成发送失败。
* **风险点 & 回滚**：

  * 风险：改变 CLAUDE.md 注入内容可能影响现有行为。
  * 回滚：保持原 char 截断逻辑作为 fallback，通过配置开关启用 token 截断。

#### P0-10 在 ChatEngine 写入 prompt-history 时截断 tool_result（核心：避免单条撑爆）

* **目标**：对齐 Codex 的“写入历史时截断工具输出”的工程思想（Formax 里最合理点）。
* **改动文件/函数**：`src/chat/engine.ts::runTurn`

  * 目前写入 tool_result 的位置：`loopMessages.push(...amendedToolResults.map(...tool_result...))`
* **实现要点**：

  * 在 `amendedToolResults` map 完成后、push 之前：

    * `const promptSafeContent = truncateTextExplainable(kind='tool_result', text=r.content, maxTokens=cfg.context.truncate.toolResultMaxTokens, reason='tool_result guard')`
    * 写入 `loopMessages` 使用 `promptSafeContent.text`
  * **重要**：不要 mutate 原 `toolResults` 对象（避免未来某处复用导致 UI 被截断）
* **DoD / 验收**：

  * 单测：给 `toolResults` 一个超长 content，runTurn 返回的 history 中对应 `tool_result.content` 包含 TRUNCATED header 且长度明显变小。
  * 手动：执行输出巨大的工具，下一轮模型调用不报 context window exceeded。
* **风险点 & 回滚**：

  * 风险：模型后续看不到完整工具输出，影响任务。
  * 回滚：保留 head+tail；并在截断 header 中指引“可通过再次运行更精确命令/输出到文件来获取细节”。

#### P0-11 在 ChatEngine 写入 prompt-history 时截断 assistant 超长 text block

* **目标**：防止模型自己输出的长文本被写回历史后，下一轮 prompt 爆窗。
* **改动文件/函数**：`src/chat/engine.ts::runTurn`（写入 `assistantBlocks` 之前）
* **实现要点**：

  * 对 `assistantBlocks` 遍历：若 `block.type==='text'` 且估算 tokens 超过 `assistantTextMaxTokens`，则替换成截断版本（kind=`assistant_text_history`）
  * thinking block 是否截断：P0 建议也截断（kind=`assistant_thinking_history`），因为它也会写入 prompt history（`PromptBlock` 包含 thinking）
* **DoD / 验收**：

  * 单测：给 assistantBlocks 一个超长 text，写回的 history 中该 text 被截断。
* **风险点 & 回滚**：

  * 风险：截断 assistant 可能丢失用户想保留的正文。
  * 回滚：仅对“超过极限”的块截断，并优先保留尾部（可能包含结论/指令）。

#### P0-12 在 tool loop 内加入“硬兜底 trimOldestUntilFits”（保证永不爆窗）

* **目标**：即使 truncate 仍不够，也能通过删除最老消息确保下一次 `streamOnce` 可发送。
* **改动文件/函数**：`src/chat/engine.ts::runTurn`（tool loop 每轮末尾）
* **实现要点**：

  * 在每次 `loopMessages.push(assistant)` 和 `loopMessages.push(tool_result)` 后：

    * 估算 `usedTokens`（仅估算即可）
    * 若 `usedTokens > effectiveWindow - baseline`：执行 `trimOldestUntilFits(loopMessages)`
  * trim 策略：

    * 优先删最老的 user/assistant 消息对（从 index 0 开始）
    * 保留最近 N 条（避免删到只剩最后一句）
  * 向 UI 发事件：`onEvent({type:'context_trimmed', removed: k, reason:'hard_limit'})`（需要扩展 StreamEvent）
* **DoD / 验收**：

  * 集成测试：模拟超小 window（例如 2000 tokens），跑 tool loop 仍能完成而不是抛错。
* **风险点 & 回滚**：

  * 风险：删除过多导致模型失忆。
  * 回滚：P1 用 compact summary 替代“纯删除”；P0 只作为兜底。

#### P0-13 实现手动 `/compact`（local-run）+ 生成 summary（额外 LLM 调用）

* **目标**：提供用户可控的 compact，并把 prompt-history 重写为 `summary + 最近若干 turns`。
* **改动文件/函数**：

  * Slash 命令注册处（bundle 未检索到具体文件名，缺证据，需要验证；但 controller 已支持 `slashEffect.kind==='local-run'`）
  * `src/chat/engine.ts`：新增方法 `compactHistory(...)`（扩展 ChatEngine 接口）
  * `src/features/repl/useReplController.ts`：在 slashEffect.run 中调用 `deps.engine.compactHistory` 并更新 `historyRef.current`
* **实现要点**：

  * `engine.compactHistory` 逻辑：

    1. 用 summarizer system prompt（建议直接用 `buildSystemPrompt(profile:'lite')` 或写一个更短的专用 prompt）
    2. 调用 `deps.client.streamOnce({ messages: history, system: summarizerSystem, tools: [], ... })` 获取 summary 文本（忽略 tool_use）
    3. 构造 `summaryMsg`（role:'assistant'，content: `[{type:'text', text:`<summary>\n...\n</summary>`}]`）
    4. 选取 tail：从末尾向前累加 tokens，直到 `compactKeepLastTokens`
    5. 新 history = `[summaryMsg, ...tail]`
    6. 若仍超窗：执行 `trimOldestUntilFits`（保留 summaryMsg）
  * `useReplController` 执行 `/compact` 后：

    * 不清空 UI messages
    * 插入一条 info 消息：`"Thread compacted (prompt history replaced with summary + last N turns)"`
* **DoD / 验收**：

  * 手动：对话几轮后执行 `/compact`，随后继续对话，模型仍能记住关键上下文（来自 summary）；UI 仍显示全部历史。
  * 单测：mock `client.streamOnce` 返回固定 summary，断言 history 被替换、长度下降。
* **风险点 & 回滚**：

  * 风险：summary 质量差导致信息丢失。
  * 回滚：提供 `/compact --dry-run`（仅显示将保留的 turns 数/估算 tokens，不实际改 history）或 `/compact --keep=N`；以及失败时退回到“纯 trim”。

---

### P1（对齐体验：auto-compact + usage 校准 + UI 事件线）

#### P1-1 启用 auto-compact（preflight：发起请求前）

* **目标**：当使用率超过阈值（默认 90%）自动触发 compact，减少“硬删历史”的发生。
* **改动文件/函数**：`src/features/repl/useReplController.ts::send`（runTurn 前）
* **实现要点**：

  * preflight 计算 snapshot 后：

    * 若 `autoCompactEnabled && usedTokens >= autoCompactTokenLimit`：先 `await deps.engine.compactHistory(...)`，更新 `historyRef.current`
    * 再重新计算 snapshot（更新 meter）
    * UI 插入 info 行：`"Auto-compacted: context over 90%"`
* **DoD / 验收**：

  * 手动：把 window 配很小（如 4000），对话几轮后自动 compact；无需用户输入 `/compact`。
* **风险点 & 回滚**：

  * 风险：频繁 compact 影响体验/成本。
  * 回滚：阈值可配置；默认关闭，用户显式开启。

#### P1-2 启用 auto-compact（tool loop 中间：每轮 tool_result 后）

* **目标**：避免“工具输出导致下一轮 streamOnce 爆窗”。
* **改动文件/函数**：`src/chat/engine.ts::runTurn`
* **实现要点**：

  * 在 P0-12 的 check 点：

    * 若超过 `autoCompactTokenLimit`：优先调用 `compactHistoryInternal(loopMessages)` 生成 summary 并替换 `loopMessages`（只影响 prompt）
    * 若 compact 失败：fallback `trimOldestUntilFits`
  * 发 `onEvent({type:'context_compacted', reason:'auto_tool_loop', ...})` 给 UI（需要扩展 StreamEvent union）
* **DoD / 验收**：

  * 集成：构造一个工具返回超大结果，确认在 tool loop 内会 compact/trim 而不是抛错。
* **风险点 & 回滚**：

  * 风险：tool loop 内 compact 会多一次 LLM 调用，可能让用户等待更久。
  * 回滚：提供开关 `cfg.context.autoCompactInToolLoop` 默认 true/false。

#### P1-3 Provider usage 落地：让 StreamEvent.usage 真正被发出

* **目标**：meter 优先用真实 usage，并用它校准估算。
* **改动文件/函数**（CODEMAP 指向，bundle 未检索到源码片段 → 缺证据，需要验证具体实现文件）：

  * `src/streaming/clients/anthropicStreamClient.ts`
  * `src/streaming/clients/openaiStreamClient.ts`
  * `src/streaming/types.ts`（类型已具备）
* **实现要点**：

  * 在解析 provider SSE/stream 时：

    * 捕获 input/output token 字段，触发 `onEvent({type:'usage', usage, model})`
    * 同时填充 `StreamTurnResult.usage = usage`（turn 结束返回）
* **DoD / 验收**：

  * 手动：开启 debug log（见第 6 部分抓包清单），确认每个 turn 都至少收到一次 usage。
* **风险点 & 回滚**：

  * 风险：不同 provider 字段名差异导致解析失败。
  * 回滚：解析失败不影响主流程，继续走 estimate。

#### P1-4 用 usage 校准估算（提升 meter 准确度）

* **目标**：在不引入 tokenizer 的情况下，把估算误差逐步收敛。
* **改动文件/函数**：

  * `src/context/tokenEstimate.ts`（新增 calibration）
  * `src/features/repl/useReplController.ts::handleEvent`（接收 `usage` 事件）
* **实现要点**：

  * 每次 `usage` 到来时：

    * 记录“本次发送前估算的 promptTokens_est”与“usage.input_tokens_actual”
    * 更新 `calibrationFactor = EMA(prev, actual/est)`（按 modelId 分桶）
  * 之后所有 estimate 乘以 factor（限制在 [0.5, 2.0] 防抖）
* **DoD / 验收**：

  * 单测：EMA 更新逻辑正确；factor clamp 生效。
* **风险点 & 回滚**：

  * 风险：usage 口径与 estimate 口径不一致（是否含 system/tools/cache）。
  * 回滚：只用 usage 做“展示”，不参与校准（开关）。

#### P1-5 UI 提示：Prompt vs UI 不一致时避免困惑

* **目标**：用户看到完整 UI 历史，但模型已 compact/truncate 时不误解。
* **改动文件/函数**：`src/features/repl/useReplController.ts`（插入 info 行）
* **实现要点**：

  * 当收到 `context_compacted`：插入消息：

    * `role: 'assistant'` 或新增 `role:'system'`（视 UI 支持）
    * 文案：`"ℹ️ Thread compacted: older messages are visible above but no longer included in the model context."`
  * 当发生 tool_result 截断：可选插入 `"(tool output truncated for context; head+tail kept)"`
* **DoD / 验收**：

  * 手动：触发 compact 后 UI 有明确提示行；用户不会误以为“模型还记得全部”。
* **风险点 & 回滚**：

  * 风险：UI message role 不支持新增类型。
  * 回滚：统一用 `assistant` role 输出一条短提示即可。

---

### P2（增强：更准 token、更强 compact、更稳错误恢复）

#### P2-1 可选接入 tokenizer（tiktoken/等）以获得真实 token 计数

* **目标**：为高精度用户提供“真实 tokens”模式，减少估算误差与阈值抖动。
* **改动文件/函数**：`src/context/tokenEstimate.ts`
* **实现要点**：

  * 动态 import：`try { const { encoding_for_model } = await import('@dqbd/tiktoken') } catch { fallback }`
  * 按 provider/model 选择编码；找不到则 fallback
* **DoD / 验收**：

  * 单测：在无依赖时不崩；有依赖时 tokens 更接近 usage。
* **风险点 & 回滚**：

  * 风险：引入依赖体积/安装复杂度。
  * 回滚：默认关闭，仅 power user 开启。

#### P2-2 “大工具输出落盘 + prompt 引用”策略（比截断更强）

* **目标**：当 tool 输出巨大且后续确实需要细节时，把全文写到文件并在 prompt 里只放摘要+文件路径。
* **改动文件/函数**：

  * tool 执行器或 `src/chat/engine.ts` 写入历史处（两阶段）
* **实现要点**：

  * 若 tool_result 超阈值：

    * 把全文写到 `.formax/artifacts/tool-<id>.log`
    * prompt-history 写入：截断头尾 + “全文路径/行号范围”
* **DoD / 验收**：

  * 手动：超大输出不爆窗，且模型可按需再用 Read 工具读取指定行范围。
* **风险点 & 回滚**：

  * 风险：文件写入权限/路径问题。
  * 回滚：失败则退回 P0 的纯截断。

#### P2-3 ContextWindowExceeded 自动恢复：捕获错误→compact→重试一次

* **目标**：当 provider 返回“上下文超限”，自动 self-heal，而不是让用户手动重试。
* **改动文件/函数**：`src/chat/engine.ts::runTurn`（catch 分支）
* **实现要点**：

  * 在 catch 中识别错误消息（pattern 匹配）
  * 自动执行一次 `compactHistoryInternal` 或 `trimOldestUntilFits`，然后重试 `streamOnce`（只重试一次，避免死循环）
* **DoD / 验收**：

  * 集成：模拟 client 抛 “context window exceeded”，确认能自恢复。
* **风险点 & 回滚**：

  * 风险：误判错误导致不必要重试。
  * 回滚：仅在明确的错误码/字符串下启用；否则保持原行为。

---

## 5) 测试计划（单测 / 集成 / 手动回归脚本）

### 单元测试（Jest / Vitest 取你项目现状）

1. `tokenEstimate.test.ts`

* 覆盖：bytes/4、折衷启发式、校准 EMA、clamp
* 样例：中英文混合、纯代码、长 JSON、超长单行文本

2. `truncate.test.ts`

* 覆盖：

  * 不截断/截断
  * head/tail 保留
  * 行数统计正确（含 Windows 换行）
  * 输出包含 meta header 且 reason 正确

3. `meter.test.ts`

* 覆盖：baseline=dynamic/number；effective percent；remaining% 公式；window 很小不崩

### 集成测试（mock LlmStreamClient + mock executor）

4. `engine.truncate.toolResult.integration.test.ts`

* mock tool 返回 200k chars
* 断言：写入 `loopMessages` 的 tool_result 被截断（含 header），且 runTurn 不抛错

5. `engine.compact.integration.test.ts`

* mock `client.streamOnce` 在 compact 模式返回固定 summary
* 断言：`compactHistory` 输出 `[summaryMsg, ...tail]`，并符合 keepLastTokens

6. `engine.toolLoop.autoCompact.integration.test.ts`（P1）

* tool loop 2 轮，第二轮写入后超阈值
* 断言：发生 `context_compacted` 或 `context_trimmed`，最终仍能继续 streamOnce

### 手动回归脚本（建议写成 docs/ctx-regression.md）

* Case A：长对话 + meter 递增
* Case B：Bash 输出巨量 stdout（或模拟工具）→ 下一轮不爆窗
* Case C：`/compact` 后继续问“刚才我们讨论的关键点是什么？”→ 模型能回答（来自 summary）
* Case D：启用 auto-compact（小 window）→ 自动触发 + UI 提示行出现
* Case E：CLAUDE.md 超长 → 注入块出现 TRUNCATED meta，且不会导致请求失败

---

## 6) 最小抓包/验证清单（用于验证 provider usage & Codex 对齐点）

> 只列“最少必要步骤”，避免你浪费调用次数。

### 6.1 验证 Formax provider 是否真的能拿到 usage（决定 meter 精度路线）

1. 在 `src/streaming/clients/*` 加一个临时 debug 开关（例如 `FORMAX_DEBUG_STREAM=1`）：打印每个流事件的原始 payload（注意脱敏）。
2. 跑一次最短对话（“hi”），观察是否出现 input/output tokens 字段：

   * 有：进入 P1-3（把它映射到 `StreamEvent.usage`）
   * 没有：meter 继续以估算为主，但保留校准接口

### 6.2 验证 Codex 关键常量/公式（补齐 Facts Table 的“缺证据”项）

> 你本地有 Codex 源码路径；按以下 grep 即可验证，不需要额外网络请求。

1. grep `effective_context_window_percent`（确认默认值与使用点）
2. grep `BASELINE_TOKENS` 或 `12000`（确认常量名/作用域）
3. 打开 `codex-rs/tui/src/status/helpers.rs`（或 DeepWiki 指向位置）确认 `percent_of_context_window_remaining` 公式
4. 打开 `codex-rs/core/src/context_manager/history.rs` 搜索 `process_item`（确认 tool output 截断发生点与格式）

### 6.3 验证 compact 行为与 UI 提示策略是否“用户不困惑”

1. 触发一次 `/compact`
2. 检查：

   * UI 历史是否仍完整可见
   * UI 是否插入 “Thread compacted” 行
   * 继续追问上文细节，模型是否能基于 summary 正确回答
   * 若回答丢信息：调大 `compactKeepLastTokens` 或改 summary prompt（P1）

---

###（补充）你特别关心的 5 个“落地难点”——我这里给直接结论

1. **如何估算 token（没 tokenizer）？**

* **快**：UTF-8 `bytes/4`（实现最省事，但中英文/代码误差大）
* **准（但需要依赖）**：可选 tiktoken（P2）
* **折衷（我建议你 P0 先做这个）**：一次扫描混合启发式 + usage 校准（P1），最终体验接近“有 tokenizer”。

2. **baseline tokens 怎么定？**

* Codex 示例 12000 对大窗模型合理，但对 8k/16k 模型可能直接不可用（baseline>window）。
* **Formax 建议：默认 dynamic**（system prompt + tools + outputReserve 的估算）+ 支持手动覆盖（例如某些模型固定 baseline）。

3. **compact 的 summary 由谁生成？失败怎么办？**

* **建议：复用当前 provider/model 做一次额外 LLM 调用生成 summary**（最少工程复杂度，最可控）。
* 失败：fallback 到 `trimOldestUntilFits`（永不爆窗），并在 UI 提示“compact failed, used trimming”。

4. **tool 输出截断在哪里做最合理？**

* **强烈推荐：ChatEngine 写入 prompt-history 的位置做**（不影响 UI 全量展示，也不会漏掉任何 tool）。Formax 里就是 `src/chat/engine.ts` 写入 `tool_result` 的 push 点。
* 超大输出的性能问题（内存/IO）再在 P2 做“落盘 + 引用”。

5. **auto-compact 触发时机选哪里？**

* **两者都要**：

  * 发请求前（preflight）避免一开始就超
  * tool loop 中间避免“工具输出把下一轮挤爆”（对齐 Codex 的思路）

如果你下一步就按上面的 TODOLIST 做，P0 完成时你会得到：**可显示的 meter、可解释 truncate、可用 `/compact`、以及永不爆窗的硬兜底**；P1 再把体验对齐 Codex（auto-compact + usage 校准 + UI 事件线）。
