# Claude Code Context Compression Architecture Parity TODO

日期：2026-05-21

目标：先对齐上下文压缩的整层架构，再逐步细化 `snip`、`context collapse`、compact boundary、cache editing 等内部策略。当前重点不是把某个 helper 的启发式参数改到一致，而是让 Formax 拥有与 Claude Code 接近的生命周期分层：append-only transcript、durable compression state replay、model-facing projection、request-only reducers、provider cache side effects、materializing compact、以及 TUI/Web/app-server/replay adapters。

## Decision Snapshot

- [x] 当前主线目标改为“Claude Code context compression architecture parity”，高于单点 `snip` / `collapse` helper 对齐。
- [x] `snip` 在 Formax 当前是 request-only reducer；在 Claude Code 中应视为 durable model-facing projection subsystem 的一部分。
- [x] `context collapse` 在 Formax 当前是 request-only recap MVP；在 Claude Code 中应视为 committed collapse store / snapshot / replay subsystem 的一部分。
- [x] `microcompact` cache-editing 语义已收敛：warm cache 走 API `cache_edits`，cold cache 才允许 time-based direct content clearing，没有 Anthropic cache editing 且 cold-cache trigger 未触发时 no-op。
- [x] Claude Code 可见路径还包含 tool-result content replacement durable side-state；Formax 当前 `tool_result_budget` 仍是 request-only reducer，该能力暂列 deferred gap / non-goal。
- [x] 官方 Anthropic `context_management` API 暂不作为本主线 blocker；当前对齐对象是本地 Claude Code 代码路径。
- [x] 不先重写 `snip` 内部算法；先补架构层的 durable projection owner 与测试夹具。

## Claude Code Target Model

Claude Code 的压缩体系应拆成这些层，而不是一个单独的 compact 函数：

1. **Append-only transcript / session log**
   - 原始 JSONL / transcript 尽量 append-only。
   - 压缩语义通过 boundary、metadata、side-state 或 events 表达，而不是随意改写旧行。

2. **Durable compression state replay**
   - 从 transcript / session events 重放当前压缩状态。
   - 至少覆盖 latest compact boundary、snip removed ranges、context-collapse committed entries / snapshots、session-memory restore artifacts。

3. **Model-facing projection builder**
   - 给下一次 LLM 请求构造稳定的模型视图。
   - 从 latest compact boundary 后开始，应用 durable snip projection 与 collapse projection，再进入 request-only reducers。

4. **Request-only reducers**
   - 只降低本轮 request payload 体积，不改 persisted authority。
   - 当前包括 tool-result budget、terminal prune、以及非 durable 化之前的 snip/collapse MVP。

5. **Provider cache side effects**
   - Anthropic `cache_reference` / `cache_edits` 只进入 request/API payload。
   - 不写回 persisted history，不改变 replay/session restore authority。

6. **Materializing compact**
   - `/compact`、auto compact、reactive compact 产生新的 compact boundary + summary + preserved tail。
   - materializing compact 后应清理、截断或 rebase 不再有效的 durable projection state。

7. **Surface adapters**
   - TUI / Web / app-server / replay 必须明确选择视图：raw transcript、UI scrollback、model-facing projection、diagnostics projection。
   - 不允许每个 surface 自己推导不同的 compression semantics。

## Gap Map

### 已基本对齐

- [x] Formax canonical middle-layer stage order 已稳定为：`microcompact -> tool_result_budget -> snip -> collapse -> prune`。这不是 Claude Code helper 顺序的逐项同构；Claude parity 重点是生命周期分层与 durable projection 语义。
- [x] `microcompact` request/API-only boundary。
- [x] Anthropic cache-editing payload projection。
- [x] Cold-cache wall-clock assistant-gap time-based microcompact。
- [x] Compact boundary metadata、boundary-first continuation、app-server/Web compact summary surface。
- [x] Memory-first auto/reactive compact skeleton。
- [x] Manual `/compact` 复用 working-set-aware compact flow。

### 架构半对齐

- [ ] Compact preserved segment 仍主要依赖 snapshot/fingerprint，缺少 Claude Code-style parent-chain relink / crash-safety guard。
- [ ] App-server/Web/replay 对 compact boundary 的展示与缓存已打通，但还缺统一的 projection fixture 锁定所有 surface。
- [ ] Pending session-memory restore 大体有 dispatch-time consumption，但 `/compact` command path 仍需要专项确认。
- [x] Request-collapse event 按 latest compact boundary generation 过滤/清理，避免 compact 后继续暴露 pre-compact collapse metadata。

### 明显未对齐

- [ ] `snip` 缺 durable boundary / metadata / removed UUID replay / parent relink。
- [x] `context collapse` 已补 committed store / snapshot / restore replay / overflow drain；后续剩余为 surface convergence 与更细策略对齐。
- [ ] `tool_result_budget` / content replacement 缺 Claude Code-style durable side-state；当前明确 deferred，不阻塞 Batch 1/2。
- [x] 已有最小统一 durable compression projection owner：`buildContextProjection()` 当前收敛 raw transcript、UI scrollback、latest compact continuation model-facing baseline、diagnostics projection、durable-state 占位 facts；后续还需把 runtime callers 逐步迁入。
- [ ] 缺一个 Claude Code compression golden fixture，统一锁定 resume、next request projection、UI scrollback、app-server replay、Web replay 的差异。

## Execution Order

### Batch 0: Architecture Contract And Backlog

目的：先把目标架构写成可执行合同和 TODO，避免后续把 `snip` / `collapse` 当普通 helper 局部修改。

- [x] 新增本 TODO，明确 architecture parity 主线。
- [x] 更新 `TODO-INDEX.md`，把当前主线从 cache-editing/WebGPT 收口切到 architecture parity。
- [x] 更新 `docs/contracts/context-strategy-stack-contract.md`，补 durable projection layer 与 middle-layer request reducer 的边界。
- [x] 更新 stale context docs，标记旧 user-turn/time-aware microcompact 描述已被 Claude Code cache-editing 语义取代。

验证：

- [ ] docs-only diff review。

### Batch 1: Golden Projection Fixture Skeleton

目的：不急着改行为，先能表达 Claude Code-style compression views，并让现有 Formax 行为有可测试基线。

Tests first:

- [ ] Add fixture helper for raw transcript + compact boundary + request collapse event + pending restore event.
- [x] Add current-baseline test: model-facing projection starts after latest compact boundary.
- [x] Add current-baseline test: request-only snip changes request history but not persisted history.
- [x] Add current-baseline test: request collapse metadata remains diagnostics-only and does not insert transcript rows.
- [x] Add cross-surface baseline test or fixture snapshot for app-server read/messages/replay fields.
- [x] Add view-kind fixture shape covering raw transcript, UI scrollback, model-facing projection, and diagnostics projection.
- [x] Extend view-kind fixture shape to Web runtime facts.

Implementation:

- [ ] Keep runtime behavior unchanged unless a test exposes an already-decided bug.
- [ ] Put fixture helpers near existing context/session tests; avoid Web-only semantics in core helpers.

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextProjectionBaseline.test.ts`
- [x] `bun run test -- packages/core/src/app-server/threadStore.test.ts packages/core/src/app-server/server.test.ts packages/core/src/chat/context/contextProjectionBaseline.test.ts`
- [x] `npm --prefix packages/web-reference-react run test -- src/app/runtime/threadDataOps.test.ts src/app/runtime/useTranscriptDisplayState.test.tsx src/app/ui/AppShellHeader.test.tsx`
- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/contextProjectionBaseline.test.ts packages/core/src/app-server/threadStore.test.ts packages/core/src/app-server/server.test.ts`
- [ ] `bun run test -- packages/core/src/chat/context packages/core/src/features/repl/sessionSave packages/core/src/app-server`

### Batch 2: Durable Projection Owner Design

目的：把“从 persisted/session replay 构建 model-facing baseline”的责任集中起来。

Tests first:

- [x] Add unit test for projection owner with no durable events: output equals boundary-aware current baseline.
- [x] Add unit test for latest compact boundary truncation.
- [x] Add unit test placeholder for future snip durable removals.
- [x] Add unit test placeholder for future collapse committed entries.
- [x] Add unit test placeholder for future tool-result content replacement durable side-state.

Implementation:

- [x] Introduce a shared projection owner, conceptually `buildContextProjection()`.
- [x] Inputs should be raw/persisted history plus durable compression events/state.
- [x] Outputs should include raw/persisted baseline, model-facing baseline, request projection facts, and surface-safe diagnostics facts.
- [x] Inputs/outputs should reserve a placeholder for deferred `contentReplacementState` / `toolResultReplacementState`, without changing current `tool_result_budget` request-only behavior.
- [x] Projection facts should be stable enough to support deterministic projection fingerprint/debug assertions in later cache-safety tests.
- [x] Do not move `snip` / `collapse` durable semantics yet; only create the canonical seam.

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/contextProjectionBaseline.test.ts packages/core/src/app-server/threadStore.test.ts packages/core/src/app-server/server.test.ts`
- [x] `bun run type-check`

### Batch 3: Small State-Risk Fixes Before Structural Migration

目的：在进入 durable snip/collapse 前，先消除已知会污染 projection 的小状态风险。

Tests first:

- [x] App-server resume + `/compact` command consumes or clears pending restore at the durable dispatch/compact ownership point.
- [x] `latestRequestCollapse` ignores pre-compact collapse events when a newer compact boundary exists.
- [x] Compact boundary event without matching `history_state` safe-degrades with diagnostics instead of silently restoring huge pre-compact history. Existing `AppServer` live compact boundary replay tests cover stale read hiding, full replay tail exposure, failure rollback, and completed-turn retention.

Implementation:

- [x] Fix only the proven failing cases.
- [x] Keep contracts updated before semantic behavior changes.

Validation:

- [x] `bun run test -- packages/core/src/app-server/store/sessionEventReader.test.ts packages/core/src/app-server/threadStore.test.ts`
- [x] `bun run test -- packages/core/src/app-server/turnRunner.test.ts packages/core/src/app-server/server.test.ts`
- [ ] `bun run test:repl-semantic-gate` if `packages/core/src/features/repl/**` semantic flow changes.

### Batch 4: Durable Snip Migration

目的：把 Formax `snip` 从 request-only reducer 升级为 Claude Code-style durable model-facing projection stage。内部 snip 启发式可以先沿用当前 Formax 策略。

Tests first:

- [x] Snip emits durable metadata/boundary identifying removed message IDs or ranges.
- [x] Resume/load applies snip removals to model-facing projection.
- [x] UI scrollback can still show raw transcript or explicitly documented view.
- [x] Parent-chain / continuation relink stays valid across removed middle ranges.
- [x] Subsequent request uses stable snipped projection and does not repeatedly resurrect unsnipped history.
- [x] Keep schema abstract until Claude Code `snipCompact` / `snipProjection` internals are available; tests should require durable IDs/ranges and replay behavior, not exact field names.

Implementation:

- [x] Add durable snip state shape.
- [x] Add replay/load projection support.
- [x] Route model-facing request projection through durable snip state before request-only reducers.
- [x] Keep existing snip text replacement heuristic unless a Claude Code parity test requires change.

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/contextProjectionBaseline.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/turnRequestProjection.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/turnRequestProjection.test.ts packages/core/src/chat/context/prune.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/turnRequestProjection.test.ts packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/contextProjectionBaseline.test.ts`
- [x] `bun run test -- packages/core/src/features/repl/controller/send/contextCompressionService.test.ts`
- [x] `bun run test -- packages/core/src/app-server/turnRunner.test.ts`
- [x] `bun run test -- packages/core/src/app-server/threadStore.test.ts packages/core/src/app-server/replayStateSnapshot.test.ts packages/core/src/app-server/threadStateReducer.test.ts`
- [x] `cd packages/web-reference-react && bun run test -- src/app/core/replayMachine.test.ts src/app/core/threadCache.test.ts src/store.test.ts src/eventAdapters.test.ts`
- [x] Context/session/app-server/Web replay targeted tests.
- [x] `bun run type-check`
- [x] Mandatory codex review before commit.

### Batch 5: Durable Context Collapse Store

目的：把 request-time collapse MVP 升级为 Claude Code-style committed collapse store / snapshot / replay subsystem。

Tests first:

- [x] Collapse commit persists outside transcript rows or as explicit durable event.
- [x] Resume/load rebuilds collapse store.
- [x] Next-turn projection applies committed collapse entries.
- [x] Provider overflow path drains pending collapse before reactive full compact.
- [x] Materializing compact clears/rebases stale collapse entries before the new compact boundary.

Implementation:

- [x] Define collapse committed entry / snapshot schema.
- [x] Add replay/load owner.
- [x] Integrate projection owner.
- [x] Add overflow drain before reactive compact.

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextCollapseStore.test.ts`
- [x] `bun run test -- packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.test.ts packages/core/src/chat/context/contextCollapseStore.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/turnRequestProjection.test.ts packages/core/src/chat/context/contextCollapseStore.test.ts packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.test.ts packages/core/src/features/repl/controller/send/contextCompressionService.test.ts packages/core/src/features/repl/controller/session/sessionEvents.test.ts packages/core/src/features/repl/controller/session/useSessionEventRecorders.test.tsx packages/core/src/features/repl/controller/send/sendMainTurn.test.ts`
- [x] Context/session/send/app-server/Web targeted tests.
- [x] `bun run type-check`
- [x] Mandatory codex review before commit.

### Batch 6: Surface And Recovery Convergence

目的：让 TUI/Web/app-server/replay 在新的 projection owner 下只消费 canonical facts。

- [x] TUI primary / expanded transcript view declares whether it shows raw scrollback, compacted view, or diagnostics view.
- [x] App-server `thread/read`, `thread/messages`, `thread/replay`, `thread/resume` consume the same projection facts.
- [ ] Web runtime caches compact/snip/collapse facts from a single RPC shape.
- [ ] `/context` diagnostics displays projection layers without redefining stage semantics.
- [ ] CODEMAP / README / contracts updated if entrypoints move.

## Commit Strategy

建议拆成小提交：

1. `docs(context): define compression architecture parity plan`
2. `test(context): add compression projection baseline fixtures`
3. `refactor(context): introduce durable projection owner`
4. `fix(session): align compact restore projection edges`
5. `feat(context): add durable snip projection`
6. `feat(context): add durable collapse store`
7. `refactor(context): converge compression surfaces`
