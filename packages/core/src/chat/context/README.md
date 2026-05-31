# packages/core/src/chat/context

Last verified: 2026-05-12

Canonical contracts:
- `docs/contracts/context-strategy-stack-contract.md`
- `docs/contracts/session-persistence-contract.md`
- `docs/contracts/slash-command-contract.md`

Formax 的“上下文管理”分两条线：

1. **UI transcript（完整保留）**：你在终端看到的 `messages[]`。
2. **Prompt transcript（可控长度）**：实际发给 LLM 的 `historyRef`（会被截断/压缩）。

这两者的目标不同，所以必须**解耦**：UI 不丢历史，但 prompt 必须有预算上限，避免被长工具输出撑爆。

---

## 1) 数据流（关键链路图）

```
┌──────────────────────────────┐
│ Ink UI (REPL.tsx)            │
│ - 渲染 Header + messages[]   │
│ - 仅展示，不参与控长         │
└───────────────┬──────────────┘
                │ user input
                v
┌──────────────────────────────┐
│ useReplController.send()     │
│ - UI: setMessages(...)       │
│ - Prompt: historyRef.current │
└───────┬──────────────────────┘
        │ build injected blocks (ephemeral)
        v
┌──────────────────────────────┐
│ buildSystemPrompt + user msg │
│ - system: buildSystemPrompt  │
│ - user: buildUserContent     │
│ - injected: reminders/plan   │
└───────┬──────────────────────┘
        │ canonical middle-layer stack
        │ - persistedHistoryCandidate
        │ - requestHistory projection
        │ - requestUser projection
        v
┌──────────────────────────────┐
│ ChatEngine.runTurn()         │
│ - streaming + tool loop      │
│ - persisted history 与       │
│   request projection seed    │
└───────┬──────────────────────┘
        │ nextHistory
        v
┌──────────────────────────────┐
│ stripInjectedBlocksFromHistory│
│ - injected 仅用于“本轮发送”   │
└───────┬──────────────────────┘
        │ canonical middle-layer stack
        │ - materialize persisted candidate
        v
┌──────────────────────────────┐
│ historyRef.current 更新       │
│ (下轮 prompt history)         │
└──────────────────────────────┘
```

---

## 2) 关键概念

### UI transcript（messages）

- **位置**：`packages/core/src/features/repl/useReplController.ts`
- **用途**：纯展示（用户看到的历史），可以非常长。
- **组成**：`user / assistant / tool` 三类消息（tool 有 running/completed/error 等状态）。

### Prompt transcript（historyRef）

- **位置**：`packages/core/src/features/repl/useReplController.ts`
- **用途**：发送给模型的对话历史（`historyRef.current`）。
- **核心约束**：必须在预算内，并且在任何截断/压缩后保持 tool_use/tool_result 成对不变量；对 Anthropic thinking 工具回合，还必须保留同一 assistant turn 的 `thinking.signature` / `redacted_thinking` 协议伴随块，不能裁成裸 `tool_use`。
- **补充约束**：当前主链已开始显式区分：
  - `history`：会进入持久 loop / 下轮 baseline 的历史
  - `requestHistory`：仅用于“本轮发给模型”的请求投影视图
  - 这层分离是后续安全接入 context collapse MVP 的关键前置条件之一
  - 当前 `context collapse MVP` 已开始接入这条 request-only 分支：它只会把较早 continuation 折叠成 deterministic recap，用于本轮 prompt；不会改写 persisted `history`
  - 当前 architecture parity 主线进一步把这层分离上提为 durable projection 与 request-only reducers 的边界：compact boundary / future durable snip / future collapse store 应先形成 model-facing baseline，再进入本目录的 middle-layer stack

### injected blocks（ephemeral）

- **位置**：`packages/core/src/features/repl/useReplController.ts`
- **用途**：只影响“这一轮发给模型”的 user content（例如 plan mode reminder、todos reminder、本地命令输出等）。
- **关键点**：
  - injected blocks 会带 `cache_control: { type: 'ephemeral' }`
  - 发送完成后，会从 `nextHistory` 里剥离（避免把 ephemeral 永久写进 prompt history）
  - 但在预算极紧时，它们仍可能参与裁剪（`pruneForPromptBudget` 有 “ephemeral text 截断”）

### token usage vs context usage

- streaming 返回的 `usage` 通常是 **本轮消耗/计费**（prompt + completion），不是“当前历史占用”。
- Formax 目前 meter 用 `estimatePromptTokens()` 做粗估（bytes/4），并通过 `computeContextStats()` 显示 percent/tokens。

---

## 3) “改哪儿”（最常用入口）

### 想改“预算 / meter / 阈值”

- `packages/core/src/chat/context/modelWindow.ts`：按 `{provider, model}` 推断 context window（未知时返回 null）
- `packages/core/src/chat/context/budget.ts`：预算换算（effectiveLimit/autoCompactLimit）与 stats
- `packages/core/src/chat/context/estimate.ts`：token 粗估策略（目前 bytes/4）
- `packages/core/src/features/repl/useReplController.ts`：每轮发送前/后计算 meter，触发裁剪

### 想改“硬截断兜底（P3）”

- `packages/core/src/chat/context/prune.ts`：`pruneForPromptBudget()`（安全兜底，保持 tool 对）
- `packages/core/src/chat/context/toolPairProjection.ts`：durable projection / prune 共用的 tool-use/tool-result orphan-block 归一化，避免模型请求出现不成对的工具父链
- `packages/core/src/chat/context/prune.test.ts`：单测覆盖（预算 fit + tool 对不变量）

### 想改“轻量压缩 / microcompact（P2）”

- `packages/core/src/chat/context/contextProjection.ts`：architecture parity 主线的 durable projection owner；当前把 raw transcript、UI scrollback、latest compact continuation 的 model-facing baseline、durable snip state replay、durable collapse store replay、diagnostics projection、content-replacement 占位 facts 收敛到一个入口，不迁移现有 request-only reducer 启发式
- `packages/core/src/chat/context/middleLayerStrategyStack.ts`：query-time middle-layer strategy stack 的共享执行层；当前 canonical 顺序已经收敛为 `microcompact -> tool_result_budget -> snip -> collapse -> prune`，其中 `prune` 明确作为 terminal fallback 只在最后的 request envelope 上兜底
- `packages/core/src/chat/context/turnRequestProjection.ts`：app-server / SDK 共享的 runtime request projection adapter，先通过 `buildContextProjection()` 生成 model-facing baseline，再进入 request-only reducers；返回时把 persisted `history`、request-only `requestHistory`、以及可能被 terminal prune 改写的 `requestUser` 分开
- `packages/core/src/chat/context/toolResultBudget.ts`：独立的 request-time tool-result budget replacement 策略（`CCA-141` 起点；只改 request projection，不改 persisted `history`）
- `packages/core/src/chat/context/snip.ts`：独立的 request-time snip reducer（`CCA-143` 起点；当前只裁短较老的 assistant 纯文本消息，不改 persisted `history`）
- `packages/core/src/chat/context/microCompact.ts`：`microCompactHistory()` 当前按 Claude Code-aligned 子路径工作：Anthropic cache editing 可用时产出 request/API-only `cache_reference` / `cache_edits` delete plan；main-thread cold-cache wall-clock assistant gap 触发时允许 request-only 清旧 `tool_result`；cache editing 不可用且 cold-cache trigger 未触发时 no-op，不再走旧的 user-turn/stub fallback。
- `packages/core/src/chat/context/microCompact.test.ts`：单测覆盖 cache-editing plan、cold-cache time-based clearing、no-op fallback、以及 request-only / persisted-history 边界。
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`：当前挂载点（prepare/finalize）
- 当前 `contextCompressionService` 也已把 post-compact、manual compact、reactive retry、post-turn finalization 的 persisted-history normalization 收敛到同一个 canonical stack owner；terminal `prune` 不再被 materialize 到 future-turn persisted baseline

### 想改“request-time context collapse（P2.5 / MVP）”

- `packages/core/src/chat/context/contextCollapse.ts`：`collapseRequestHistory()`（当前是保守 MVP，只在已有 latest compact boundary 时尝试把 continuation 头部折叠成 request-only recap）
- `packages/core/src/chat/context/contextCollapseStore.ts`：durable context-collapse migration 的 committed entry / snapshot schema；entry 带 compact-boundary generation fingerprint，projection replay 只应用当前 generation 的 commit，避免 compact 后旧 recap 误改新 baseline
- `packages/core/src/chat/context/contextCollapse.test.ts`：单测覆盖（无 boundary 不生效、collapse recap 生成、最小节省阈值）
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`：当前接线点（只改 `requestHistory`，不改 persisted `history`）
- `packages/core/src/features/repl/controller/session/useSessionEventRecorders.ts`：当前最小 runtime 消费点（真实模型请求若用了 request-time collapse，会追加 `request_collapse_applied` session event）
- 当前边界：
  - 只作用于 request-time projection
  - `prepareHistoryForTurn()` / `runReactiveCompact()` 当前也会返回最小 `collapseState`，让运行时后续链路能够消费“这轮 request projection 是否做了 collapse”以及对应 metadata，而不必再从 `requestHistory` 反推
- 当前 session persistence 也会把真实模型请求上实际使用的 collapse 投影记录成最小 `request_collapse_applied` event，并区分 `initial` / `reactive_retry`
- 不引入 collapse store / archived span metadata
- 不改变 replay / resume 的 persisted history 语义
- reactive/manual 路径暂未单独扩展 collapse 策略
- architecture parity 主线将把 collapse 升级方向单独处理：未来 durable collapse store 需要先定义 committed entry / snapshot / restore replay / overflow drain / materializing compact cleanup，再改运行时。

### 想改“上下文诊断 / /context”

- `packages/core/src/chat/context/contextDiagnostics.ts`：`analyzeContextDiagnostics()` + `formatContextDiagnosticsReport()`
- `packages/core/src/chat/context/contextDiagnostics.test.ts`：单测覆盖（slice 估算、budget 字段、报告文案）
- `packages/core/src/features/repl/controller/send/send.ts`：`/context` 的本地命令入口
- 当前 `/context` snapshot 与主路径 prompt 估算已统一基于“最近 compact boundary 后 continuation view”；如果没有 boundary，才退化为全 persisted history
- 当前 runtime send-path 与 `/context` next-turn diagnostics 也已共用 `middleLayerStrategyStack`：`microcompact`、`prune`、`collapse` 不再由两边各自串联执行，从而把 `strategyFacts`、impact 字段和 request-time prepared view 收敛到同一个 owner
- 当前 `middleLayerStrategyStack` 里也已引入第一条真正独立的新中间层策略：`toolResultBudget` 会单独给 tool-result group 计预算；超预算时优先在 request-time projection 上做 replacement，再把结果交给 `collapse`，并通过 `toolResultBudgetImpact` + `assembledLedger` 暴露收益
- 当前 `middleLayerStrategyStack` 里也已引入最小 `snip` 层：它只会在 request-time projection 上裁短较老的 assistant 纯文本消息，并通过 `snipImpact` 暴露命中消息数、保留的 recent eligible messages、以及估算节省量
- 当前 next-turn diagnostics 与 runtime 已共用同一套 adaptive microcompact policy，但旧的 user-turn/stub fallback 已被 Claude Code-style cache-editing / cold-cache time-based semantics 取代。`microCompactImpact` 中仍可能保留历史字段用于兼容解析，但当前规范语义以 `docs/contracts/context-strategy-stack-contract.md` 为准。
- 当前 `latestCompactBoundary` 也会暴露最小 `boundaryFingerprint` 与 `preservedSegment` metadata，便于 resume / partial compact / diagnostics 对齐。`boundaryFingerprint` 是 projection/app-server 的 read-only generation fact，不写回 persisted boundary metadata；preserved-segment relink 只影响 model-facing continuation / projection baseline，不写回 raw transcript、UI scrollback 或 persisted JSONL；显式 identity/fingerprint refs 必须唯一、按顺序、并解析为 boundary 前连续 preserved-tail segment，否则跳过 relink。
- 当前 system prompt diagnostics 已支持 per-system-section breakdown：会把 system 拆成 `Identity`、heading 前 `Preamble`、以及顶层 `# section`，`top contributors` 不再只把 system 当作单个黑盒 contributor
- 当前 `nextTurnFixed` diagnostics 已支持 lifecycle markers：会以非破坏性投影方式比较 `snapshot`、`post_microcompact`、`post_prune`、`post_compact` 四个阶段的估算差异
- 当前 diagnostics 也会解释 compact / prune 原因：latest boundary 可暴露结构化 `triggerReason`，`nextTurnFixed` 会额外给出 `autoCompactSkipReason` 与 `pruneSkipReason`，并且两者都按真实运行时顺序推导
- 当前 diagnostics 也已暴露 request-time collapse impact：`nextTurnFixed.collapseImpact` 会说明 collapse 是否生效、折叠了多少条较老消息，以及估算节省了多少 token
- `nextTurnFixed.collapseImpact.metadata` 当前也会暴露最小 request-recap metadata：包括 `keepLastTurns`、保留 tail 条数、是否保留 compact summary、保留的 recent prompt/file 计数，以及 `recapFingerprint`
- 当前 `nextTurnFixed` diagnostics 也已暴露 `assembledLedger`：会把最终 assembled request payload 拆成 `system_total`、`request_history`、`tool_result_group`、`tool_result_budget_savings`、各个 `fixed_group`、`fixed_total` 与 `assembled_total`，用于回答“真正发给模型的 payload 大头是谁”，以及这轮独立 tool-result budget 到底省了多少
- 当前 `nextTurnFixed` diagnostics 也已暴露 `strategyCoordination`：它直接复用 `middleLayerStrategyStack` 的 canonical stage facts，把 `microcompact` / `tool_result_budget` / `snip` / `collapse` / `prune` 的 `stage`、`role`、`scope`、`disposition`、`reason`、以及输入/输出 token 账本稳定表达出来，避免 diagnostics 继续从零散 impact 字段自行猜测 stack ordering
- 当前 `nextTurnFixed` diagnostics 也已暴露 `strategyControlPlane`：它把 `strategyCoordination` 再聚合成 stack-level 摘要（`stageOrder`、`appliedStages`、`skippedStages`、`terminalStage`、`dominantSavingStage`），让 `/context`、app-server 与 Web parser 可以先消费统一控制面，再按需下钻到逐 stage facts
- 当前 task-minimal working-set v5 已不再只服务于 auto compact：auto compact 与 manual `/compact` 现在都会走 `keep_combo` working-set selector。除了 recent files、plan/todo state、以及 mode state 的动态 boost，working-set anchor 现在也会识别最近成功的 task-execution cluster（例如 `Read + Edit + TodoWrite`），并按 anchor kind 区分 rewind window（`Read=1`，`filesystem_cluster=2`，`task_execution_cluster=3`）；`/context` 会通过 `nextTurnFixed.workingSetSignals` / `Working-set signals` 小节显式说明 `taskStateKinds`、`selectionReasons`、`anchorKind`、`anchorToolNames`、实际 `anchorBacktrackTurns` 与当前 `anchorMaxBacktrackTurns`
- `/context` 当前若能拿到 runtime / persisted session 里的最近一次 `request_collapse_applied` 事实，也会额外暴露 `latestRequestCollapse` 摘要，避免 diagnostics 只能靠重新推导 collapse 事实
- `/context` 当前若能拿到 runtime / persisted session 里的最近一次 `reactive_compact_applied` 事实，也会额外暴露 `latestReactiveCompact` 摘要，用于解释最近一次 overflow 是哪类错误触发、最终走了哪条 fallback 路径
- contributor diagnostics 当前会把 request-time collapse 生成的 synthetic recap 单独标成 `kind='collapse_recap'`，避免客户端再把它误识别成普通 user message
- 当前 contributor diagnostics 已有稳定 identity：`topSnapshotContributors` / `systemSectionBreakdown` / `topAssembledContributors` 不再只有 `label + tokens`，还会带 `kind` / `key`，并按类型补 `ordinal`、`toolUseId`、`toolName`、`systemSectionKey`

### 想改“/compact（P4）”

`/compact` 已实现。主要入口：
- pre-main 路由：`packages/core/src/features/repl/controller/send/sendPreMainRouting.ts`
- compact flow：`packages/core/src/features/repl/controller/send/compactFlow.ts`（summary 生成 + lifecycle；当前 auto compact 与 manual `/compact` 都会走 task-minimal `keep_combo`；manual `/compact` 的 summary input 也必须从 durable model-facing projection / latest compact-boundary continuation 出发，不能重新总结 raw pre-boundary scrollback；当已有 latest boundary 时，auto compact 会优先对 continuation 作用域做 partial compact）
- reactive compact：`packages/core/src/features/repl/controller/send/reactiveCompact.ts` + `packages/core/src/features/repl/controller/send/sendMainTurn.ts`（主 turn 首次 provider 调用命中上下文超限类错误时，会做一次受控 compact/retry；当前会先把错误归类成稳定 `triggerKind`，优先 session memory，失败再 fallback model summary，并把成功 fallback 事实记录成 `reactive_compact_applied` session event）
- history 重建：`packages/core/src/chat/context/compact.ts`（tail 选择、boundary metadata、preserved-segment metadata、rehydration 拼装、continuation view helper；当前 working-set v5 已覆盖最近成功的 filesystem cluster / task-execution cluster anchor，并把 recent files、plan/todo state、mode state 合并进 auto keep strategy）

### 想改“session memory / rolling memory（P5 起点）”

- `packages/core/src/chat/context/sessionMemory.ts`：`buildSessionMemoryDraft()` + `mergeSessionMemoryDraft()`
- `packages/core/src/chat/context/sessionMemory.test.ts`：builder / merge 规则回归
- `packages/core/src/features/repl/controller/session/sessionRollingMemory.ts`：每轮 turn 完成后的 rolling memory sidecar 刷新
- `packages/core/src/features/repl/sessionSave/sessionMemorySidecar.ts`：session `.memory.json` sidecar 路径与原子写入
- `packages/core/src/features/repl/sessionSave/sessionMemoryRefresh.ts`：从 active history 重建并刷新 session memory sidecar 的共享 helper（turn completion 与 restore 路径共用）
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`：auto compact 会先尝试读取 session `.memory.json`，用 rolling session memory 生成 compact summary；拿不到 sidecar 或 sidecar 不可用时，再静默回退到 model summary compact
- 当前定位：
  - 这是 **session-scoped working memory draft**，不是现有按 cwd 的 `MEMORY.md` 替代品
  - 当前已经接进 turn completion 的后台刷新，也已接进 auto compact fallback chain
  - REPL `/resume`、CLI `resumeLast`、SDK file-backed `resume/continue` 已会把 persisted history 恢复成 boundary-first continuation view
  - app-server `thread/resume` 也已开始沿用同一条 restore-side sidecar refresh 语义
  - rolling session memory sidecar 现在会在 REPL `/resume`、CLI `resumeLast`、SDK file-backed `resume/continue`、app-server `thread/resume` 成功恢复 active history 后做 best-effort 刷新，这样下一轮能立刻复用 memory-first auto compact
  - 非 REPL 恢复链当前会优先沿用已有 sidecar 中保存的 `mode` / `planPath`，避免刷新时把 session memory 降级回 `normal/null`
  - REPL `/resume`、CLI `resumeLast`、SDK file-backed `resume/continue` 与 app-server `thread/resume` 当前都可以把 sidecar 派生成一条 **只作用于下一轮请求** 的 session-memory reminder block；该 block 走 request-time injection 路径，不会写回 persisted history
  - app-server 当前会在服务端缓存这条 reminder，并在下一次成功的 `turn/start` / turn-dispatch 上消费一次；`/context` fixed groups 也会把它显示为 `Pending restore injected blocks`
- app-server `thread/resume` 当前还会直接返回 `pendingSessionMemoryRestore` 结构化摘要；在 pending 窗口内，`thread/replay` 也会暴露同一份 next-turn-only restore utility
  - 当前该摘要除了 `mode / files / plan / todo`，也会带上 bounded 的 higher-order task utility（如最近 skills 与最近 subagent types）
- app-server `thread/replay` 当前也会直接返回 canonical `latestCompactBoundary`，这样 replay / inspection path 能继续消费 compact protocol fact，而不必改走新的 summary 组装路径
  - app-server `thread/resume` 当前也会直接返回 `latestCompactBoundary`，让 restore surface 与 `thread/read` / `thread/messages` 共用同一份 canonical compact protocol facts
  - Web strict/permissive parser 与 thread-scoped compact-boundary cache 当前也会保留 `keepStrategy`、`rehydrationPlan`、`rehydrationCost`、`preservedSegment` 这组 deeper inspection fields，避免 history / replay / resume / read 因消费路径不同而退化成第二套较浅的 compact summary；omitted optional fields 只能在 `boundaryFingerprint` 相同的同一 boundary 上保留已有 deep facts，不能按 preserved-segment core facts 猜测同代，也不能跨新的 compact boundary generation 继承旧 `preservedSegment`
  - 当前恢复链不会因为 sidecar 刷新失败而中断；JSONL replay 仍然是唯一权威历史来源

---

## 4) 常见坑（与本目录相关）

- **UI transcript ≠ Prompt transcript**：不要为了省 token 去删 UI 的 `messages[]`，应该只裁剪 `historyRef`。
- **tool 成对不变量**：任何 trim/compact 后必须保持 `tool_use ↔ tool_result` 成对，不然 Edit/Write 等会出现“找不到 old_string / 上下文错位”等连锁错误。
