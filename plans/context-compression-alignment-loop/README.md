# Context Compression Alignment Loop Blueprint (Active)

目标：围绕 Claude Code 的上下文压缩体系，持续缩小 Formax 在“分层压缩、协议化 compact、状态恢复、可观测性”上的差距，并保持每个增量都可测试、可 review、可提交。

最后更新时间：2026-05-12

## 这份计划解决什么问题

当前 Formax 已经不再是“完全没有上下文压缩体系”的状态了。我们已经补上了几块关键地基：

- 已完成：压缩编排层收敛
  - `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- 已完成：`microcompact` MVP
  - `packages/core/src/chat/context/microCompact.ts`
- 已完成：`/context` 基础诊断、assembled fixed view、top contributors
  - `packages/core/src/chat/context/contextDiagnostics.ts`
- 已完成：`/context` per-system-section diagnostics
  - system prompt 现在会拆成 identity / preamble / 顶层 `# section` 贡献视图
- 已完成：`/context` pre/post compact lifecycle markers
  - 已可对比 `snapshot -> post-microcompact -> post-prune -> post-compact` 的估算差异
- 已完成：compact / prune trigger reason diagnostics
  - latest boundary 现在可暴露结构化 `triggerReason`
  - `nextTurnFixed` 现在会解释 `autoCompactSkipReason` 与 `pruneSkipReason`
- 已完成：message/tool contributor drill-down
  - contributor payload 现在会稳定暴露 `kind` / `key`
  - message/tool/system contributor 现在可按 `ordinal`、`toolUseId`、`toolName`、`systemSectionKey` 做结构化定位
- 已完成：`/context --json`
- 已完成：app-server `local.diagnostics` 结构化 payload
- 已完成：diagnostics payload 正式客户端消费契约
  - `docs/contracts/app-server-interaction-contract.md`
  - `docs/contracts/slash-command-contract.md`
  - `packages/web-reference-react/src/app/core/rpcContracts.ts`
- 已完成：session memory draft schema（builder + merge rules）
  - `packages/core/src/chat/context/sessionMemory.ts`
- 已完成：rolling session memory sidecar（turn completion async refresh）
  - `packages/core/src/features/repl/controller/session/sessionRollingMemory.ts`
  - `packages/core/src/features/repl/sessionSave/sessionMemorySidecar.ts`
- 已完成：memory-first auto compact
  - `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- 已完成：boundary-first prompt / diagnostics continuation view
  - `packages/core/src/chat/context/compact.ts`
  - `packages/core/src/chat/engine.ts`
  - `packages/core/src/chat/context/contextDiagnostics.ts`
- 已完成：preserved segment metadata 起点
  - `packages/core/src/chat/context/compact.ts`
- 已完成：compact boundary app-server protocol 起点
  - `packages/core/src/app-server/turnRunner.ts`
  - `packages/core/src/features/semantics/adapters/turnNotificationCanonicalAdapter.ts`
- 已完成：session persistence / resume boundary-aware restore
  - `packages/core/src/features/repl/controller/session/sessionTransitions.ts`
  - `packages/core/src/runtime/bootstrap/session.ts`
  - `packages/core/src/sdk/query/resume.ts`
- 已完成：partial compact MVP
  - `packages/core/src/chat/context/compact.ts`
  - `packages/core/src/features/repl/controller/send/compactFlow.ts`
  - `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- 已完成：reactive compact
  - `packages/core/src/features/repl/controller/send/reactiveCompact.ts`
  - `packages/core/src/features/repl/controller/send/sendMainTurn.ts`
  - `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- 已完成：partial compact go/no-go checklist
  - `plans/context-compression-alignment-loop/CCA-060-partial-compact-go-no-go.md`
- 已完成：request-time context collapse MVP
  - `packages/core/src/chat/context/contextCollapse.ts`
  - `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- 已完成：collapse impact diagnostics / contributor kind / recap metadata
  - `packages/core/src/chat/context/contextDiagnostics.ts`
  - `packages/web-reference-react/src/app/core/rpcContracts.ts`
- 已完成：runtime-visible collapse state + session persistence `request_collapse_applied`
  - `packages/core/src/features/repl/controller/send/sendMainTurn.ts`
  - `packages/core/src/features/repl/controller/session/useSessionEventRecorders.ts`
- 已完成：latest request collapse summary surface
  - `thread/read`
  - `thread/messages`
  - `/context`
- 已完成：thread-level collapse inspection helper
  - `packages/core/src/app-server/threadStore.ts`
- 已完成：collapse summary 真实进入 Web / client surface
  - `packages/web-reference-react/src/app/ui/AppShellHeader.tsx`
- 已完成：collapse summary 进入第二个 Web inspection surface
  - `packages/web-reference-react/src/components/WorktreeDiffPane.tsx`
- 已完成：working-set / keep strategy v2
  - `packages/core/src/chat/context/compact.ts`
  - `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- 已完成：session memory deeper restore consumption
  - `packages/core/src/features/repl/controller/session/sessionTransitions.ts`
  - `packages/core/src/runtime/bootstrap/session.ts`
- 已完成：remote / cross-surface compact restore parity
  - `packages/core/src/app-server/threadStore.ts`
  - `packages/web-reference-react/src/app/core/rpcContracts.ts`
- 已完成：persisted collapse state/store 评估
  - `plans/context-compression-alignment-loop/CCA-090-persisted-collapse-state-evaluation.md`

但从 Claude Code 的能力模型来看，Formax 仍然明显停留在“分层体系的前半段”。

Claude Code 更成熟的地方，不是某一个 `/compact` prompt 写得更长，而是这些能力已经形成系统：

- query 主路径里的多层减压
- compact boundary 协议
- compact 后状态重建
- session memory compact
- partial/reactive compact
- 更成熟的 context introspection 与跨端协议

这份计划的目标，不是 1:1 复刻 Claude Code 文件结构，而是把这些能力拆成 Formax 可以连续交付的小切片。

补充阅读：

- 任务依赖图：[CCA-DEPENDENCY-MAP.md](./CCA-DEPENDENCY-MAP.md)
- 当前差距快照：[CLAUDE-CODE-GAP-SNAPSHOT-2026-04-06.md](./CLAUDE-CODE-GAP-SNAPSHOT-2026-04-06.md)

## 当前状态定位

### 已补上的基础能力

1. 压缩编排层
   - 已从 send 主链路分散调用，收敛为统一协调服务。
2. 轻量压缩层 MVP
  - 已支持 `Read` / `Grep` / `Glob` 的旧 tool result stub 化。
  - 已支持 `Skill` 的旧 machine-generated companion body 安全 stub 化，且不会误伤普通 trailing text。
  - stub 现在会保留更高价值的最小上下文，例如 `Read` 的体量信息、`Grep` 的近似命中数、`Glob` 的近似路径数。
  - `microcompact` 现在会按上下文压力分档，动态调整工具覆盖、保留数量与最小结果大小阈值。
  - `Bash` / `WebFetch` 现在有保守的 allow/deny 规则：只有明确低风险、可重放的结果才允许进入 microcompact。
3. compact 协议起点
   - compact 后的 persisted history 现在会写入显式 compact boundary message。
   - 该 boundary 目前是 metadata-only event：可被 session/replay 识别，真实 prompt/history 视图现在会以“最近 boundary 后 continuation view”为基线，boundary 自身不会污染模型上下文。
   - boundary 现在已携带最小 metadata：`trigger`、`preTokens`、`summaryKind`、`keepStrategy`。
   - boundary 现在可额外携带轻量 `rehydrationPlan`，先把 compact 后要补回的状态协议化。
   - `/context --json` 与 app-server `local.diagnostics` 已可读出 `latestCompactBoundary`。
4. post-compact rehydration 第一版
   - compact summary 现在会补回最近成功 `Read` 的文件路径清单。
   - compact boundary 的 `rehydrationPlan` 会把 `recent_files` 从 `planned` 升为 `applied`。
5. post-compact rehydration 第二版
   - compact summary 现在会补回当前 mode 文本、plan path + excerpt、精简后的 todo summary。
   - compact boundary 的 `plan_state`、`todo_state`、`mode_state` 会在对应内容真正注入后升为 `applied`。
6. rehydration cost 可见性
   - compact boundary 现在会记录 `rehydrationCost`（`sectionCount`、`estimatedTokens`）。
   - `/context` text / JSON 与 app-server `local.diagnostics` 现在都能直接读到这层成本。
7. keep 策略第一版升级
   - auto compact 不再只由固定 `keepLastTurns` 驱动。
   - 当前 auto compact 会使用组合 keep 策略：`keepLastTurns + keepMinTokens + keepMinUserTurns`。
   - `CCA-170` 完成后，手动 `/compact` 也已复用同一条 task-minimal `keep_combo` 选择器，不再退回固定 `keep_last_turns`。
8. 最小工作集选择器第一版
   - `keep_combo` 不再只看 turn 数和 token floor。
   - 当前会把“最近成功 `Read` 所在 turn”当成 working-set anchor，但只允许回卷最近 1 个额外 user turn。
   - 这样可以避免 auto compact 只因最后一轮聊天文本够长就把刚读过的文件上下文整段丢掉，同时不把很久以前的 `Read` 永久钉在 tail 里。
9. 最小工作集选择器第二版
   - working-set anchor 已扩成 filesystem tool cluster（`Read` / `Grep` / `Glob`）。
   - `filesystem_cluster` 当前有独立的 2-turn backtrack window；`Read` anchor 继续保持 1-turn rewind。
   - `/context` 当前也会显式说明 `anchorMaxBacktrackTurns`，避免只看到实际回卷而看不到当前策略窗口。
10. `microcompact` turn-level metrics
   - 已返回 `compactedBlocks`、`compactedToolNames`、`estimatedTokensSaved`、`keptRecentBlocks`
   - `/context` diagnostics payload 已可读取 impact 基础字段
11. 可观测性第一版
   - 已有 `/context`
   - 已有 snapshot 视图
   - 已有 next-turn fixed context 视图
   - 已有 microcompact impact 展示（before/after projected history、estimated tokens saved）
   - 已有 top contributors
   - 已有 per-system-section breakdown（system 不再只被视为单个黑盒 contributor）
   - 已有 next-turn lifecycle markers（snapshot / post-microcompact / post-prune / post-compact）
   - 已有 JSON diagnostics
   - 已有 app-server 结构化 payload

### 仍然缺失的高价值能力

1. working-set / keep strategy 仍然偏窄
2. compact 协议虽然已经起步，但 ecosystem 还不完整
3. compact 后恢复已进入 reminder 层，但 session memory 的 deeper restore consumption 仍不够
4. reactive compact facts 已结构化，但更深的 provider-specific shaping 仍然偏早期
5. request-time `context collapse` 已进入 header + right-rail surface，但更丰富的 client/runtime parity 仍然有限

## 下一阶段主线（Active）

上一阶段主线已经完成了：

1. `CCA-120` richer assembled-payload diagnostics ledger
2. `CCA-121` microcompact strategy v2
3. `CCA-122` reactive compact shaping v2
4. `CCA-123` richer collapse client consumption / parity

这意味着下一阶段不再适合继续围绕最小 collapse surface 扩面，而更适合回到仍然明显落后于 Claude Code 的 working-set / session-memory / compact-protocol 三条主线。

### 当前状态

1. `CCA-132` compact protocol ecosystem v2
   - 已完成：`latestCompactBoundary` 已进入 Web runtime thread cache / display selector / header surface
2. post-`CCA-132` mainline re-rank
   - 已完成：下一阶段主线已切换到“独立中间层策略栈”而不是继续围绕 collapse 最小消费面扩面
3. `CCA-140 ~ 146`
   - 已完成：middle-layer scaffolding、tool-result budget、cache-aware microcompact、stage contract、coordination facts、control-plane diagnostics、以及最小 request-time snip layer 都已落地
4. `CCA-150`
   - 已完成：working-set / keep strategy v4 第一刀
   - 结果：filesystem task cluster 已不再只允许固定 1-turn rewind，diagnostics 也会显式暴露 `anchorMaxBacktrackTurns`
5. `CCA-160`
   - 已完成：task-minimal working-set selector v5
   - 结果：working-set selector 现在会把 recent task planning/todo state 与 `task_execution_cluster` 一起纳入 keep strategy，并通过 `taskStateKinds` / `selectionReasons` 解释为什么当前 tail 被保留
6. `CCA-151`
   - 已完成：session-memory restore consumption v4
   - 结果：app-server `thread/resume` 现在也会复用 canonical restore artifacts，并把 session-memory reminder 作为服务端缓存的 next-turn-only injected blocks 消费一次
7. `CCA-161`
   - 已完成：session-memory restore utility v5
   - 结果：canonical restore-artifacts 路径现在也会产出结构化 `pendingSessionMemoryRestore`；`thread/resume` 与 `thread/replay` 会在 pending 窗口内共用这份 utility surface
8. `CCA-152`
   - 已完成：middle-layer canonical-owner convergence
   - 结果：`contextCompressionService` 的 post-compact/manual/reactive/finalize 路径现在会复用 canonical middle-layer stack materialize persisted baseline；terminal prune 不再写回 future-turn history
9. 下一步
   - `CCA-153` 已完成，post-`CCA-153` mainline re-rank 也已完成
   - `CCA-160` 已完成
   - `CCA-161` 已完成
   - `CCA-162` 已完成：`thread/replay` 当前也会直接返回 canonical `latestCompactBoundary`，Web replay runtime 会消费它并在 replay source 下继续显示 compact header
   - `CCA-163` 已完成：`microcompact` 当前已补上基于 stale user-turn age 的 time-aware path，并把 `timeAware*` facts 暴露到 diagnostics / app-server / Web strict parser
   - post-`CCA-163` mainline re-rank 已完成
   - `CCA-170` 已完成：manual `/compact` 现在也会复用 task-minimal `keep_combo` selector，不再退回固定 `keep_last_turns`
   - `CCA-171` 已完成：higher-order restore utility 现在会沿 canonical restore-artifacts 路径额外暴露 bounded 的 `recentSkills` 与 `recentSubagentTypes`，并让 `thread/resume` / `thread/replay` / next-turn reminder 共用这份扩展后的 task utility
   - `CCA-172` 已完成：Web `thread/messages` inspection path 当前也会保留 canonical `keepStrategy`、`rehydrationPlan`、`rehydrationCost`、`preservedSegment` 这组 deeper compact-boundary fields；thread-scoped compact-boundary cache 也已改成用 shared deep equality 刷新
   - post-`CCA-172` mainline re-rank 已完成
   - 当前新的 18x 主线已切到：
     1. `CCA-180` deferred-task restore utility v7
     2. `CCA-181` preserved-segment relink parity
     3. `CCA-182` reactive compact shaping v3

刚完成的上一轮主线：

1. `CCA-130` working-set selector v3
   - 结果：working-set anchor 已从 recent-`Read` 扩成 filesystem tool cluster（`Read` / `Grep` / `Glob`），并在 diagnostics 中解释 anchor 类型与回卷轮数
2. `CCA-131` session memory deeper restore consumption v3
   - 结果：file-backed SDK `resume/continue` 已进入 canonical restore-artifacts 路径，并支持 one-turn session-memory reminder block

## 与 Claude Code 的差异地图

## A. 主循环与分层减压

Claude Code：
- query 前会做多级减压：boundary 视图、tool-result budget、snip、microcompact、collapse、auto/full compact。

Formax 当前：
- 已有 `microcompact + tool-result budget + snip + request-time collapse + prune + compact` 多层主链。
- request-time `context collapse` 已真实进入 runtime，但它仍然主要是 request projection 层，不是完整的 collapse store / projection subsystem。
- 当前最大差距已经不再是“有没有中间层步骤”，而是：
  - restore utility 虽已结构化，但仍缺 deferred-task / async-agent 一类更高阶任务状态
  - compact protocol 虽已进入 replay / restore / inspection deeper parity，但 preserved-segment relink 仍停在最小 metadata / validation 钩子

### 下一阶段切法

`CCA-140 ~ 142` 完成后，这条结构性差距已经不再主要表现为“缺新的压缩技巧”，而是：

1. stage semantics 仍然隐含在代码里
2. `prune` / `toolResultBudget` / `collapse` 的阶段角色仍然不够明确
3. coordination facts 还不够厚
4. control-plane diagnostics 还不够像一个真正的 stack surface

所以当前更合理的 14x 主线应当切成：

1. `CCA-144` middle-layer stage contract / terminal prune fallback v1
2. `CCA-145` strategy coordination facts v1
3. `CCA-146` middle-layer control-plane diagnostics v1
4. `CCA-143` snip boundary + MVP v1

这几刀的关系是：

- `CCA-144` 先把现有 stack 的阶段语义与 terminal fallback 讲清楚
- `CCA-145` 再统一 stage coordination facts
- `CCA-146` 再把这些 facts 做成真正可消费的 control-plane diagnostics
- `CCA-143` 最后再开，避免在边界未清楚时把 `snip` 也做成新的 ad hoc 分支

当前状态：

- `CCA-140` 已完成
- `CCA-141` 已完成
- `CCA-142` 已完成
- `CCA-143` 已完成
- `CCA-144` 已完成
- `CCA-145` 已完成
- `CCA-146` 已完成
- `CCA-150` 已完成
- `CCA-160` 已完成
- `CCA-161` 已完成
- `CCA-171` 已完成
- `CCA-162` 已完成
- `CCA-163` 已完成
- `CCA-152` 已完成
- `CCA-153` 已完成
- post-`CCA-153` mainline re-rank 已完成
- post-`CCA-163` mainline re-rank 已完成
- `CCA-170` 已完成
- `CCA-172` 已完成
- post-`CCA-172` mainline re-rank 已完成
- 当前主线应先切到：
  - `CCA-180` deferred-task restore utility v7

## B. `microcompact` 能力深度

Claude Code：
- 有 compactable-tool 策略
- 有 cached/time-based 路径
- 与 API 视图和后续边界协作

Formax 当前：
- 只有本地 stub 替换版 MVP
- 当前限制：
  - 主要处理 `Read` / `Grep` / `Glob`
  - 只对已知安全的 `Skill` companion block 做窄范围命中
  - `Bash` / `WebFetch` 仅在高压力档位 + 保守 allow/deny 下参与
  - 当前已经有 cache-aware 与 time-aware path，但仍缺更广的 tool-family 覆盖与更成熟的 API-view 协作

## C. compact 协议层

Claude Code：
- 有显式 `compact_boundary`
- 有 metadata
- 有 preservedSegment
- resume/remote/SDK 都认这套协议

Formax 当前：
- 已有 metadata-only compact boundary event，可进入 persisted history / replay
- 已有最小 boundary metadata，并能通过 diagnostics payload 读到最新 boundary
- 已有最小 `preservedSegment` metadata（`continuationMessageCount`、`preservedTailMessageCount`、`summaryFingerprint`、`headFingerprint`、`tailFingerprint`），可用于最小 continuation 校验
- app-server `turn/event` 已有 `compact_boundary` 协议事件，canonical adapter 可映射成 `system_message(uiKind="compact_boundary")`
- REPL `/resume`、CLI `resumeLast`、SDK file-backed `resume/continue` 已会把 persisted history 恢复成 boundary-first continuation view，而不是直接把 replay.history 原样塞回 active baseline
- app-server `thread/resume` 现在也会直接返回 canonical `latestCompactBoundary`，Web restore path 会立刻消费它并更新 thread-scoped compact boundary cache
- 缺：
  - preserved segment relink
  - 更强的 continuation validation / relink parity

## D. compact 后恢复能力

Claude Code：
- compact 后会补回继续工作需要的状态
  - recent files
  - plan / mode
  - skills
  - async agent 状态
  - deferred instructions / MCP 等

Formax 当前：
- 已有 summary + tail + 最小 rehydration
- 当前已补：
  - 最近成功 `Read` 的文件路径 rehydrate
  - 当前 `planPath` / `planExcerpt` / `todoSummary` / `mode` rehydrate
  - compact boundary `rehydrationPlan` 与 `rehydrationCost`
- 仍缺：
  - deferred-task / async agent / prompt-exposure 一类更高阶恢复项
  - 更接近 Claude Code 的完整 continuation 恢复层

## E. keep 策略

Claude Code：
- 不只是固定最后 N 轮，更偏最小工作集

Formax 当前：
- keep 策略仍偏固定 turn 数
- 缺：
  - 当前 working-set selector 已达到 task-minimal v5 第一版；manual `/compact`、restore utility、compact inspection 这三条主线也已补齐第一阶段
  - 但 higher-order deferred-task continuity 与 preserved-segment relink 仍然落后

这也是 post-`CCA-153` 之后新的第一优先级来源：

> 不是再继续补 compact surface，  
> 而是让 keep strategy 真正开始围绕“当前任务最小工作集”做选择。

## F. session memory / rolling memory

Claude Code：
- 有 session memory compact
- 优先利用持续维护的 memory，而不是每次重新总结整段历史

Formax 当前：
- 已有 `sessionMemory.ts` 提供最小 draft schema（长期事实层 / 活动任务层 / 当前策略层）
- 已有 turn-completion 驱动的 rolling memory sidecar
- 已有 memory-first auto compact，但还没有 memory-first resume / continue
- 已有 app-server restore reminder 注入与 restore-side utility 起点，但还没有更稳定的 cross-surface task utility

## G. partial / reactive compact

Claude Code：
- 有 partial compact
- 有 413 / media 错误后的 reactive compact 路径

Formax 当前：
- 已有 partial compact MVP：
  - 当前只对已有 latest boundary 的 auto compact 生效
  - 会把最新 boundary 后的 continuation 当成新的 compact 作用域
  - 旧 compact summary 会继续参与“要总结什么”，但不会再被当作 preserved tail 保留
- 已有 reactive compact MVP：
  - 仅在主 turn 首次 provider 调用因上下文超限类错误失败时触发
  - 会先尝试 session-memory compact，再 fallback model-summary compact
  - compact 成功后只重试一次，不会无限循环
  - 仍缺 richer diagnostics / provider-specific shaping

## H. diagnostics / introspection

Claude Code：
- 更像“上下文控制台”
- 更贴近真实 API prompt 视图
- 有更多 section-level breakdown

Formax 当前：
- 已从 0 到 1，但仍未达到这个层级
- 已有：
  - text diagnostics
  - JSON diagnostics
  - top contributors
  - app-server payload
  - 客户端稳定 schema（`schemaVersion=1`）
- 还缺：
  - per-system-section breakdown
  - pre/post microcompact impact view
  - richer client rendering
  - session/boundary-aware visualization

## I. 协议与跨端一致性

Claude Code：
- compact boundary 已进入 SDK / remote / session restore 协议层

Formax 当前：
- `/context` 结构化 payload 已进入 app-server local result
- compact boundary 已开始进入 session restore / SDK resume 协议层，但 remote thread restore 仍未完全对齐

## 执行原则（固定）

1. 不追求“一次补齐 Claude Code 全家桶”。
2. 每次只做一个可验证切片。
3. 优先补高收益、低风险、能放大现有基础设施价值的能力。
4. 优先把现有 diagnostics 反过来服务压缩策略，而不是无限扩 diagnostics UI。
5. 所有切片默认循环：
   - 实现
   - 定向测试
   - `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="high"`
   - 提交

## 范围约束（严格）

- 不做“为了更像 Claude Code 而更像 Claude Code”的表面模仿。
- 不在同一切片混入无关重构。
- 不做 Web diagnostics 专用 UI，除非它直接服务主线能力验证。
- 不把 compact 复杂度一口气推到 session memory / partial compact，必须按依赖顺序推进。

## 建议推进顺序

### Stage 0：把 MVP 变成可调优系统

1. `microcompact` metrics / impact
2. richer stub / 更细 tool 策略
3. `/context` 展示 microcompact 真实收益

### Stage 1：把 compact 从“消息技巧”升级成“协议事件”

1. boundary metadata
2. keep 策略升级
3. post-compact rehydration

### Stage 2：把 compact 变成长期记忆系统

1. session memory / rolling memory
2. auto compact 优先使用 memory compact

### Stage 3：再做高阶压缩

1. 先按 `CCA-060` checklist 补齐 boundary-first prompt view / preserved segment / cross-surface protocol
2. 再做 partial compact
3. 最后做 reactive compact
3. collapse / cache-aware layers

## 当前任务清单（唯一来源）

- 见 `plans/context-compression-alignment-loop/TODO-INDEX.md`
- 这份 `README.md` 负责描述全景与阶段；`TODO-INDEX.md` 只保留未完成项。

## 验收思路

我们不是以“代码量”来判断阶段完成，而是看这些问题是否能被回答：

1. 这层压缩到底省了多少上下文？
2. compact 后下一轮恢复是否更稳？
3. 压缩语义是否能跨 TUI / app-server / Web / session 保持一致？
4. 新能力是否真的降低了 full compact 触发频率或硬裁剪频率？
