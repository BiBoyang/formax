# Context Strategy Stack 合同（唯一事实源）

最后更新：2026-05-21
状态：规范性（Normative）

本文档定义 Formax query-time context middle layer 的唯一事实源，并定义该 middle layer 与更上层 durable compression projection 的边界。

范围：
- query-time middle-layer stages 的列表、角色与执行顺序
- stage 对 request projection / persisted history / assembled envelope 的作用域边界
- stage facts 的最小稳定语义
- `prune` 作为 terminal fallback 的角色约束
- durable compression projection 与 request-only reducers 的分层边界

不在范围内：
- full compact / partial compact / reactive compact 的完整协议
- session memory schema 与 restore sidecar 语义
- Web / TUI 的具体显示样式
- 单个 strategy 的内部启发式参数细节

相关文档（信息性镜像）：
- `docs/contracts/slash-command-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
- `docs/contracts/session-persistence-contract.md`
- `packages/core/src/chat/context/README.md`

相关实现（规范锚点）：
- `packages/core/src/chat/context/contextProjection.ts`
- `packages/core/src/chat/context/middleLayerStrategyStack.ts`
- `packages/core/src/chat/context/microCompact.ts`
- `packages/core/src/chat/context/toolResultBudget.ts`
- `packages/core/src/chat/context/snip.ts`
- `packages/core/src/chat/context/contextCollapse.ts`
- `packages/core/src/chat/context/prune.ts`
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- `packages/core/src/chat/context/contextDiagnostics.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`CSS-001`  
query-time middle-layer strategy stack 的权威实现 MUST 位于 `packages/core/src/chat/context/middleLayerStrategyStack.ts`。

`CSS-002`  
runtime send-path 与 `/context` next-turn diagnostics MUST 复用同一 middle-layer stack owner；不得长期维持两套独立的 stage 串联逻辑。

`CSS-003`  
新增 middle-layer strategy 时，MUST 先在本合同中定义 stage 角色、顺序与作用域，再接入 runtime。

`CSS-004`
Formax context compression architecture MUST distinguish durable model-facing projection from request-only middle-layer reduction. A durable projection may be reconstructed from persisted transcript, compact boundaries, snip metadata, collapse store entries, or session events. A request-only reducer may only affect the current request envelope unless this contract and the session persistence contract explicitly upgrade it to durable semantics.

`CSS-004a`
The shared durable projection owner MUST be `buildContextProjection()` in `packages/core/src/chat/context/contextProjection.ts`. It currently defines the canonical raw transcript, UI scrollback, model-facing baseline, diagnostics projection, durable-state facts, and projection facts. Durable `snip` state MAY remove model-facing baseline ranges in this owner while preserving raw transcript / UI scrollback. Durable `collapse` store snapshots MAY replace model-facing baseline ranges with committed recap messages while preserving raw transcript / UI scrollback. Request-only collapse reducer behavior MUST remain separate from committed durable collapse replay.

`CSS-005`
Claude Code parity work SHOULD target the following layer order:
1. append-only transcript / persisted session log
2. durable compression state replay
3. model-facing projection baseline
4. query-time middle-layer request reducers / semantic projections
5. provider-specific request side effects
6. materializing compact
7. TUI / app-server / Web / diagnostics adapters

The middle-layer stage order defined below starts at layer 4. It MUST NOT be treated as the complete compression architecture.

`CSS-006`
Formax's current middle-layer order is canonical for Formax, but it MUST NOT be described as exact helper-order parity with Claude Code. Claude Code parity work concerns lifecycle roles and durable projection boundaries first; helper order may differ when Formax has a documented canonical order and tests for request/persisted scope.

## 2. Stage 列表与角色

`CSS-101`  
当前 query-time middle-layer stages MUST 只包含以下五类：
1. `microcompact`
2. `tool_result_budget`
3. `snip`
4. `collapse`
5. `prune`

`CSS-102`  
每个 stage MUST 属于以下角色之一：
1. `budget_reducer`
2. `semantic_projection`
3. `terminal_fallback`

`CSS-103`  
当前 stage 角色 MUST 为：
1. `microcompact -> budget_reducer`
2. `tool_result_budget -> budget_reducer`
3. `snip -> budget_reducer`
4. `collapse -> semantic_projection`
5. `prune -> terminal_fallback`

`CSS-104`  
`prune` MUST NOT 被视为普通中途压缩步骤；它的规范角色是最终 hard cutoff / terminal fallback。

## 3. Stage 顺序

`CSS-201`  
当前 middle-layer stage 的规范执行顺序 MUST 为：
1. `microcompact`
2. `tool_result_budget`
3. `snip`
4. `collapse`
5. `prune`

`CSS-202`  
`budget_reducer` stages MUST 在 `semantic_projection` stage 之前执行。

`CSS-203`  
`terminal_fallback` stage MUST 在所有非 terminal stages 之后执行。

`CSS-204`  
未来新增 stage 时，若其目标是局部 request-time 降预算且尽量少改语义，SHOULD 归入 `budget_reducer` 并置于 `collapse` 之前；若其目标是请求视图重投影，SHOULD 归入 `semantic_projection`；若其目标是最后兜底硬裁剪，MUST 归入 `terminal_fallback`。

## 4. 作用域边界

`CSS-301`  
middle-layer stack MUST 区分以下三个 envelope：
1. `persisted_history_candidate`
2. `request_history_projection`
3. `assembled_request_envelope`

`CSS-302`  
`snip` 与 `collapse` MUST 只作用于 `request_history_projection`；MUST NOT 改写 persisted `history` 语义。

`CSS-303`  
`microcompact` 与 `tool_result_budget` 当前 SHOULD 被视为 request-time reducers；不得在没有显式合同变更的情况下引入 persisted-history mutation 语义。`microcompact` 当前只允许 Claude Code-aligned 子路径：cold-cache time-based content clearing 与 Anthropic cache-editing delete planning；这些子路径同样 MUST 保持 request-time reducer 语义，不得把“较旧结果更早 stub”扩展成 persisted baseline 改写。

`CSS-303a`
Claude Code exposes a durable side-state pattern for tool-result content replacement in some query sources. Formax `tool_result_budget` remains request-only and MUST NOT be inferred as durable state. Durable tool-result content replacement, when supplied as explicit side-state, is a separate projection-owner stage that rewrites only model-facing tool-result block content while preserving raw transcript and UI scrollback.

`CSS-304`  
`prune` 的规范语义 MUST 是 terminal fallback：它的职责是保证最终 request-time payload 进入预算，而不是抢在前置 reducers/projection 之前充当普通变换步骤。

`CSS-305`  
若 stage 只影响 request-time projection，runtime 返回结构 MUST 能将其 effects 与 persisted `history` 基线分离表达；不得要求调用方从最终 history 倒推 request-only effects。

`CSS-305a`
request-time reducers MAY 产生 provider-specific request-envelope side-effect plan，例如 Anthropic cache editing 的 `cache_reference` / `cache_edits` delete plan。此类 plan MUST 只用于 assembled request/API payload projection；MUST NOT 被写回 persisted history，也 MUST NOT 改变 replay/session restore 的 authoritative transcript。若 request side-effect plan 无法被当前 provider/capability 消费，runtime MUST 能继续使用不依赖该 plan 的 request projection 或 fallback path。

`CSS-305b`
Claude Code-style time-based microcompact MAY run before cache-editing projection when main-thread Anthropic cache editing is enabled and the wall-clock gap since the last assistant message exceeds the configured prompt-cache TTL threshold. This path MUST treat the cache as cold: it MAY content-clear older compactable `tool_result` blocks in the request projection, MUST keep at least the most recent compactable tool result, and MUST NOT emit `cache_edits` for that same turn. Persisted history MAY carry assistant timestamp metadata needed to evaluate the wall-clock gap, but time-based tool-result clearing itself remains request-only.

`CSS-305c`
When Anthropic cache editing is unavailable and the cold-cache time-based trigger has not fired, `microcompact` MUST be a no-op. It MUST NOT fall back to Formax's legacy content-stub microcompact or user-turn-based stale-result compaction because changing a warm prompt prefix can reduce prompt-cache reuse. Context pressure in this case MUST be handled by later stack stages such as `tool_result_budget`, `snip`, `collapse`, `prune`, or full auto-compact.

`CSS-306`  
post-turn finalization、manual compact 后的 persisted baseline materialization、以及 reactive/auto compact 后的 persisted-history normalization SHOULD 复用 canonical middle-layer stack owner，而不是在调用侧继续手工串联 `microcompact` / `prune` helper。

`CSS-307`  
当 surrounding flow materialize future-turn persisted `history` 时，`prune` MUST NOT 被写回 persisted baseline。`prune` 只负责 `assembled_request_envelope` 的 terminal fallback；若调用方需要 future-turn baseline，MUST 取 canonical stack 暴露的 persisted-history candidate，而不是取 terminal-pruned request payload。

`CSS-308`
Durable projection state MUST be replayed before the request-only middle-layer stack runs. Examples include compact-boundary truncation, durable snip removals when supplied, and future context-collapse committed entries / snapshots. Middle-layer reducers MUST receive the model-facing baseline produced by that durable replay, not independently rediscover durable state from UI or Web cache. Runtime request adapters MUST preserve the raw persisted transcript separately from that model-facing baseline.

Within durable projection replay, compact preserved-segment relink MUST run before durable snip removal and durable collapse replacement. This keeps snip/collapse ranges in the model-facing baseline coordinate space after boundary continuation has recovered any verified preserved tail.

`CSS-309`
Current Formax `snip.ts` heuristic remains a request-only reducer unless durable snip state is explicitly supplied to the projection owner. Durable snip projection MUST preserve raw transcript / UI scrollback while filtering only the model-facing baseline. Durable snip state MAY be replayed from explicit `durable_snip_applied` session events; each valid event represents the current durable snip removal snapshot, not an incremental patch over earlier durable snip events. Those events SHOULD identify model-facing removal ranges, removed message fingerprints, removed message identities when available, the base model-facing projection fingerprint, and the source projection kind. Identity-bearing durable removals MUST replay only when every removed identity is explicit, unique in the current model-facing baseline, range-aligned, and fingerprint-matched; otherwise the projection owner MUST skip that removal and expose drift in the durable snip fact reason. Legacy fallback identity is not strong identity and MUST NOT be used for destructive removal when explicit identity is absent or duplicated. Older durable snip events without removed identities MAY fall back to a legacy range/count/fingerprint guard, but duplicate or mismatched fingerprints MUST skip destructive removal. When a compact-boundary generation changes, durable snip replay MUST discard removals from older or unscoped generations unless explicit rebase metadata is introduced. When durable snip removes one side of a tool-use/tool-result pair, projection replay MUST drop the now-orphaned tool block from the model-facing baseline so the provider never receives an invalid parent chain. Current Formax request-time `collapseRequestHistory()` remains a request-only reducer unless committed collapse entries are explicitly supplied to the projection owner.

When request-time snip and request-time collapse both apply in the same turn, the durable snip removal coordinates are still in the durable snip baseline because `snip` runs before `collapse`. The runtime MAY persist both states only after recomputing the collapse committed source range by subtracting snip removals that fall wholly inside the collapsed head. If any snip removal crosses the collapse source boundary, if the rebased collapsed head becomes empty, or if a durable collapse was already active before the request-only stack ran, the runtime MUST skip durable snip persistence for that turn. A removal that targets an already-synthetic durable collapse recap MUST NOT be converted into durable snip state without an explicit rebase contract.

`CSS-309a`
If `snip` is promoted to durable projection behavior, the contract MUST decide whether a separate request-only fallback snip stage remains in the middle-layer stack or whether `snip` is removed from the layer-4 reducer list and represented only as layer-2/3 durable projection. The durable migration MUST NOT silently keep both semantics under one ambiguous `snip` label.

`CSS-309b`
Durable context collapse MUST use explicit committed entries / snapshots before it changes runtime projection behavior. A committed collapse entry MUST identify a model-facing index range, carry the recap message that replaces that range, carry the original request-collapse metadata, identify the compact-boundary generation it was created against when one exists, and remain serializable as an explicit session event or store snapshot. Snapshot replay MUST be deterministic so resume/load and Web/app-server surfaces can rebuild the same durable collapse store before constructing request-only reductions. Projection replay MUST skip entries whose compact-boundary fingerprint does not match the current model-facing baseline generation, and it MUST drop now-orphaned tool-use/tool-result blocks after committed range replacement.
When a resumed compacted transcript no longer contains the compact-boundary row, the projection owner MAY recover the active compact-boundary generation from the durable collapse snapshot. Runtime request adapters MUST treat that recovered active generation as sufficient evidence to allow boundaryless continuation reducers, while keeping `latestCompactBoundary` itself reserved for boundary metadata that is still present in the current transcript.
If a provider rejects the initial request for context overflow after request-time collapse has produced a durable commit candidate, the runtime MUST drain that pending collapse commit before running reactive full compact. This keeps deterministic request collapse from being lost when the overflow path falls through to a heavier materializing compact/retry.
When a materializing compact writes a new compact-boundary generation, durable collapse store rebuild MUST clear committed entries from older generations rather than carrying their model-facing ranges across the new boundary. Boundaryless history snapshots MUST NOT clear the active generation by themselves, because resumed compacted transcripts may intentionally omit the boundary row and recover generation from the durable snapshot. Rebase can be introduced later only with explicit range-rewrite metadata; until then, generation change means stale collapse entries are discarded.

`CSS-310`
Provider cache side effects are not durable projection state. Anthropic `cache_reference` / `cache_edits` may alter server-side cached prefix behavior for one request, but they MUST NOT be interpreted as transcript mutation, compact boundary, snip boundary, collapse commit, or resume authority.

`CSS-310a`
Durable tool-result content replacement MUST be represented by explicit replacement snapshots, for example `durable_tool_result_content_replacement_applied` events with `schemaVersion: 1`, `source: "tool_result_content_replacement"`, `sourceScope`, optional compact-boundary / base-projection fingerprints, `sourceProjectionKind: "model_facing_baseline"`, and replacement entries keyed by `toolUseId`. Main-thread replacement state MUST ignore sidechain / agent-scoped events unless that source scope is explicitly requested. Projection replay MUST replace only a uniquely matched `tool_result` block and SHOULD verify `originalContentFingerprint` when present; drifted, missing, or ambiguous targets MUST be skipped rather than destructively rewritten. This durable stage runs before request-only `tool_result_budget`, so already-replaced tool results are not budget-stubbed a second time.

`CSS-311`
App-server and diagnostics surfaces that expose `latestRequestCollapse` MUST scope that fact to the current compact-boundary generation. If the latest persisted `request_collapse_applied` event predates the latest compact boundary's first appearance in session history, the surface MUST return `null` for `latestRequestCollapse` rather than showing stale pre-compact collapse metadata. Repeated history snapshots that contain the same current compact boundary MUST NOT invalidate a later request-collapse event.

## 5. Stage Facts 合同

`CSS-401`  
middle-layer stack SHOULD 为每个 stage 暴露结构化 facts；这些 facts MUST 至少能表达：
1. `stage`
2. `role`
3. `scope`
4. `disposition`（`applied` / `skipped`）
5. `terminal`
6. `advisory`
7. `reason`
8. `estimatedTokensSaved`
9. `inputTokens`
10. `outputTokens`

`CSS-402`  
若 stage 被跳过，facts SHOULD 能表达 skip reason；若 stage 生效，facts SHOULD 能表达 apply reason 或触发依据。各派生 payload MAY 继续保留 strategy-specific impact 子对象，但 stage-level canonical facts MUST 以本合同字段为准。

`CSS-403`  
diagnostics / app-server / Web surface 对 middle-layer 的展示 SHOULD 优先消费 runtime 产生的 canonical stage facts，而不是各自重新推导另一套 stage 语义。

`CSS-404`  
/context diagnostics MUST expose projection-layer facts from `buildContextProjection()` when reporting raw transcript, UI scrollback, model-facing baseline, diagnostics projection, durable stage status, and durable stage fingerprints. `/context` MAY run the request-only middle-layer stack to show next-turn estimates, but it MUST feed that stack from the diagnostics projection produced by the durable projection owner rather than independently rediscovering compact/snip/collapse projection boundaries.

`CSS-405`
若 diagnostics / app-server / Web surface 需要展示 stack-level control-plane summary，则该 summary MUST 建立在 canonical stage facts 之上；不得引入一套与 `stageOrder` / `role` / `scope` / `disposition` 不一致的独立推导逻辑。

## 6. 变更流程

`CSS-501`  
当以下任一内容变化时，必须先更新本合同，再更新实现：
1. stage 列表
2. stage 角色
3. stage 执行顺序
4. request-time 与 persisted-history 的作用域边界
5. stage facts 的稳定字段

`CSS-502`  
当 `/context`、app-server diagnostics、或 Web parity 需要消费新的 middle-layer facts 时，本合同 MUST 先记录 canonical stage 语义；派生文档只做链接和摘要，不得重定义核心角色与顺序。

`CSS-503`
When a compression feature is promoted from request-only behavior to durable projection behavior, the implementation MUST update this contract and the session persistence contract before runtime wiring. The change MUST include tests for resume/load replay and at least one cross-surface projection consumer.

## 7. 测试映射

主测试集：
1. `packages/core/src/chat/context/middleLayerStrategyStack.test.ts`
2. `packages/core/src/chat/context/contextDiagnostics.test.ts`
3. `packages/core/src/features/repl/controller/send/contextCompressionService.test.ts`

新增 stage 或修改 stage 顺序时，相关测试 SHOULD 至少覆盖：
1. stage order regression
2. request-only vs persisted-history 边界
3. terminal fallback (`prune`) 位置与角色
4. durable projection replay boundary when the change affects model-facing baseline construction
