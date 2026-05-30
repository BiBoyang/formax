# Post-CCA-181 Compression Boundary + Reactive Compact Rolling Todo

日期：2026-05-31

当前执行入口只看这个文件。上一份 `CCA-181 Preserved-Segment Relink Validation Parity Todo` 已完成并进入 Git 历史；本文件接续 `TODO-INDEX.md` 中的 post-CCA-181 推荐顺序：先锁住 `microcompact` / `tool_result_budget` / durable replacement 的 request-time vs durable projection 边界，再进入 `CCA-182 reactive compact shaping v3`。

本 TODO 是 rolling todo：Batch 1 先做边界审计和测试收口；Batch 2 做 `CCA-182` characterization / prep；Batch 3 只实现 Batch 2 证明出来的最小 reactive compact slice。执行时仍然一批一批完成、验证、review、提交，不在一个 commit 里混完全部批次。

WebGPT 2026-05-31 四份 review 的收敛结论：当前顺序正确，但 Batch 1 必须更硬地锁住 `microcompact` / `tool_result_budget` / durable replacement 的边界；Batch 2 必须 characterization-first；Batch 3 不预设 broad reactive compact shaping，只实现 Batch 2 证明出来的一个最小缺口。

## 0. Context and Boundary

### 0.1 Confirmed Facts

- [x] `microcompact` 与 `tool_result_budget` 已同时存在于 current middle-layer stack。
- [x] 当前 middle-layer stage 顺序是 `microcompact -> tool_result_budget -> snip -> collapse -> prune`。
- [x] `microcompact` 与 `tool_result_budget` 当前都属于 request-time reducer；默认不写回 persisted history。
- [x] Claude Code-style cached microcompact 是 request/API cache-edit side effect：不重写 local message content，cache edits 只在 provider request layer 消费。
- [x] Claude Code-style time-based microcompact 是 cold-cache request projection path：content-clear 较旧 compactable tool results，至少保留一个最近 compactable result，并让 cached-MC state 失效/重置。
- [x] Formax `tool_result_budget` 是 Formax request-time reducer，不等同于 Claude Code durable content-replacement side-state 或 cache-editing internals。
- [x] `buildContextProjection()` 是 durable projection owner，先产出 model-facing baseline，再交给 request-time middle-layer stack。
- [x] durable tool-result content replacement 已有 explicit side-state / session event / projection replay 代码路径。
- [x] `tool_result_budget` 当前会跳过已经带 durable replacement marker 的 tool result，避免二次 budget-stub。
- [x] request-time collapse 已有 `latestRequestCollapse` surface；durable collapse store / archived spans 仍不是当前主线。
- [x] `CCA-181` 已把 preserved-segment / `boundaryFingerprint` / Web compact-boundary cache generation key 收口。
- [x] `TODO-INDEX.md` 当前建议 post-`CCA-181` 先做 durable tool-result replacement summary surface / boundary follow-up，再进入 `CCA-182`。

### 0.2 Goals

- [x] 锁住 Claude Code-style `microcompact` lifecycle roles、Formax request-time `tool_result_budget`、explicit durable tool-result content replacement replay 三者的阶段边界。
- [x] 验证 cache-editing microcompact、time-based microcompact、no-op microcompact 三条路径互斥且均为 request-time 行为；analysis-only surfaces 不得触发 content-clearing。
- [x] 验证 request-time reducers 只影响本次 request projection，不反向成为 durable state 或 persisted history mutation。
- [x] 验证 durable tool-result content replacement 只能来自 explicit durable side-state，并且只在 `buildContextProjection()` replay。
- [x] 验证 durable replacement replay 发生在 request-time `tool_result_budget` 之前，且不会被 `tool_result_budget` 二次替换。
- [x] 默认不新增 app-server / Web durable replacement stable surface；只有审计发现 concrete consumer 且 canonical docs 先定义最小 bounded surface，才补 wiring。
- [x] 为 `CCA-182 reactive compact shaping v3` 写 characterization-first prep：先锁 overflow / retry / fallback / event semantics，再决定实现 slice。
- [x] 让 WebGPT review 一份 rolling todo，而不是每个小阶段都重新问一次。

### 0.3 Non-goals

- [x] 不新增 `tool_result_budget` stage；它已经存在。
- [x] 不把 `microcompact` 与 `tool_result_budget` 合并成一个概念。
- [x] 不改 middle-layer stage 顺序，除非 Batch 1 发现明确 contract bug 并先更新 canonical docs。
- [x] 不把 request-time `tool_result_budget` 持久化。
- [x] 不从 transcript rows 推断 durable tool-result replacement state。
- [x] 不从 budget stub text、durable-looking marker、rendered tool-result text 推断 durable replacement state。
- [x] 不在 Batch 1 实现完整 durable replacement store、archived spans 或 committed collapse store。
- [x] 不在 Batch 1 进入 `CCA-182` runtime/provider retry 行为改动。
- [x] 不把 `latestRequestCollapse` 当成 durable collapse store。
- [x] 不让 Web 自行重建 compression facts；Web 只消费 app-server / RPC facts。
- [x] 不复制 Claude Code `contentReplacementState` / cache-editing / context-collapse store 的存储 internals；只对齐 lifecycle role、projection boundary、retry boundary。
- [x] 不把 Claude Code 当前 query helper order 当作 Formax stage-order authority；Formax 继续以 `context-strategy-stack-contract.md` 的 canonical order 为准。
- [x] 不把 context-compression-lab teaching helpers 升级为生产实现目标。

## 1. Definitions First

### 1.1 Canonical Docs

- [x] Re-read `docs/contracts/context-strategy-stack-contract.md` sections for `CSS-303` / `CSS-303a` / `CSS-308` / `CSS-310a`.
- [x] Re-read `docs/contracts/session-persistence-contract.md` durable replacement and reactive compact event sections.
- [x] Re-read `docs/contracts/app-server-interaction-contract.md` compression surface sections.
- [x] Re-read `docs/contracts/web-parity-adapter-contract.md` server-owned compression facts section.
- [x] Default-defer stable app-server/Web durable replacement surface unless a concrete consumer is found; tests/docs are enough for Batch 1 by default.
- [x] No new stable app-server/Web durable replacement surface is needed in Batch 1; canonical docs were updated for bounded diagnostics and event-reader semantics only.
- [x] If no new stable surface is needed, record the reason in TODO / learning note and keep implementation to tests/docs.

### 1.2 Data Model / Ownership

- [x] Confirm durable tool-result content replacement remains explicit durable replay side-state, keyed by stable source scope / tool-use identity, with current `DurableToolResultContentReplacementState` only as the implementation anchor.
- [x] Confirm durable replacement state scoping against compact-boundary generation is enough to avoid stale carryover.
- [x] Confirm `replacementContent` is model-facing only and does not mutate raw transcript or UI scrollback.
- [x] Confirm `originalContentFingerprint` drift guard is sufficient for destructive replacement replay.
- [x] Confirm sidechain-scoped replacement events are ignored on the main-thread path unless explicitly requested.
- [x] Confirm request-time `tool_result_budget` facts remain middle-layer stage facts, not durable projection facts and not a surrogate for Claude Code cache-editing/content-replacement state.
- [x] Confirm Web/app-server naming does not blur request-time `tool_result_budget` with durable replacement replay.

### 1.3 Types / Interfaces

- [x] Audit internal durable replacement projection fact shape for minimum bounded diagnostics metadata; do not make the fact a second durable authority.
- [x] Audit whether app-server RPC contracts currently expose durable projection facts beyond `durableSnip`.
- [x] Do not add a stable app-server/Web `durableToolResultContentReplacement` surface in Batch 1; `/context --json` exposes only bounded diagnostics metadata.
- [x] No Web parser/cache support was added for a stable durable replacement surface; explicit null vs omitted semantics remain unchanged for existing compression facts.
- [x] Keep replacement content out of broad UI chrome unless there is a concrete inspection use case.
- [x] Ensure `/context --json` / diagnostics never expose full `replacementContent` by default.

## 2. Runtime / Platform Boundaries

### 2.1 Request-Time Stack

- [x] Add/verify tests that `executeMiddleLayerStrategyStack()` always reports `tool_result_budget` as `scope: request_history_projection`.
- [x] Add/verify tests that `persistedHistoryCandidate` remains the original history when `tool_result_budget` applies.
- [x] Add/verify tests that `tool_result_budget` does not mutate the input message objects in-place.
- [x] Add/verify tests that `tool_result_budget` durable marker skipping is identity-specific: only the same tool-use id / explicit durable marker suppresses budget replacement.
- [x] Add/verify tests that cache-editing microcompact plans provider request side effects without mutating local history or persisted history.
- [x] Add/verify tests that time-based microcompact, when enabled for explicit main-thread send source and cold-cache gap, content-clears only request projection, keeps at least one recent compactable tool result, emits no cache edit plan for that turn, and marks cached-MC invalidation as runtime side effect only.
- [x] Add/verify tests that microcompact is no-op when cache editing is unavailable and the cold-cache time-based trigger has not fired; it must not fall back to legacy stale-result stubbing.
- [x] Add/verify tests that `/context`, diagnostics, and analysis-only compact inspection paths cannot trigger time-based content-clearing.
- [x] Add/verify tests for Formax's contract-backed order: durable projection baseline -> `microcompact` -> request-time `tool_result_budget` -> `snip` -> `collapse` -> terminal `prune`; do not assert Claude helper-order equivalence.
- [x] Add/verify tests that stage facts distinguish `microcompact` savings from `tool_result_budget` savings.

### 2.2 Durable Projection Replay

- [x] Add/verify tests that `buildContextProjection()` applies durable tool-result replacement to `modelFacingBaseline`.
- [x] Add/verify tests that `rawTranscript` and `uiScrollback` remain unchanged after durable replacement replay.
- [x] Add/verify table-driven skip matrix: missing target, duplicate target, fingerprint drift, malformed entries, non-tool targets, ambiguous targets, and mixed apply/skip.
- [x] Add/verify tests that durable replacement fact includes applied / skipped counts without becoming a second authority.
- [x] Add/verify tests that durable replay order is compact boundary / preserved-segment relink -> durable snip -> durable collapse -> durable tool-result content replacement -> request-time middle-layer stack.
- [x] Add/verify tests that durable-replaced tool results are not budget-stubbed again by `tool_result_budget`.
- [x] Add/verify tests that if durable replacement is skipped due drift/duplicate/ambiguity, the tool result remains eligible for normal request-time `tool_result_budget`.
- [x] Add/verify tests that collapse/prune before durable replacement only replaces surviving unique post-collapse tool results.
- [x] Add/verify tests that durable replacement does not break tool-use/tool-result pairing.

### 2.3 Session Event / Restore Path

- [x] Add/verify tests for reading the latest durable replacement event from session files.
- [x] Add/verify tests for compact-boundary fingerprint scoping and clearing stale replacements after generation changes.
- [x] Add/verify tests that malformed durable replacement events are ignored without clearing valid previous state.
- [x] Add/verify tests that a malformed durable replacement event after a valid event does not clear the previous valid replacement state.
- [x] Add/verify tests that invalid / unknown `sourceProjectionKind` is ignored.
- [x] Add/verify tests that sidechain events do not affect main-thread state.
- [x] Add/verify `contextCompressionService` path: fallback durable replacement state is scoped to history before projection.
- [x] Add/verify `contextCompressionService` path: raw/future `history` remains original, `requestHistory` receives durable replacement replay, no budget stub is added on already durable-replaced results, and request-time facts remain request-time only.
- [x] Add/verify two-run replay: request-time reducers do not create durable projection state on a later `buildContextProjection(history)`.

### 2.4 Diagnostics / App-Server Surface

- [x] Audit `/context --json` / context diagnostics for durable projection facts.
- [x] Decide whether diagnostics need a compact durable replacement summary.
- [x] If diagnostics surface is added, expose bounded projection metadata only: status, replacement count, skipped count, source scope, generation key/fingerprint, and skipped/drift reason; do not dump full replacement content by default.
- [x] If no diagnostics/app-server/Web surface is added, add explicit negative tests that they do not infer durable replacement from budget stubs, durable replacement markers, or transcript rows.
- [x] Audit app-server `thread/resume`, `thread/read`, `thread/messages`, and `thread/replay` for compression projection facts.
- [x] No stable app-server durable replacement surface was added; current thread surfaces explicitly do not add `durableToolResultContentReplacement` without a contract-backed field.
- [x] Ensure omitted fields do not clear cached Web facts; explicit null is the clearing signal if a cache is introduced.

## 3. Frontend Boundary

- [x] Audit Web `types.ts`, RPC parsers, cache helpers, and runtime orchestrator for existing compression facts handling.
- [x] No durable replacement surface was added; Web continues to parse only server-owned existing compression facts.
- [x] Ensure Web does not infer durable replacement from transcript rows, `TOOL_RESULT_BUDGET_STUB_PREFIX`, durable replacement markers, durable-looking text, ordinary tool row summaries, or rendered tool-result text.
- [x] Ensure Web does not display request-time `tool_result_budget` impact as durable replacement state.
- [x] If no surface is added, keep frontend work to negative parser/cache/hydrate/replay regressions proving no local inference.
- [x] No positive parser/cache regressions were added because no Web-visible server-owned durable replacement surface was introduced.
- [x] Keep UI unchanged unless a concrete diagnostic display is required.

## 4. CCA-182 Reactive Compact Prep

### 4.1 Existing Path Characterization

- [x] Trace `sendMainTurn` overflow catch path and assert current order: initial request projection -> provider error classification -> optional initial request-collapse pending-candidate handling -> `runReactiveCompact()` -> exactly one retry.
- [x] Trace `contextCompressionService.runReactiveCompact()` output: history, requestHistory, user, cacheEditPlan, collapse state, snip state, reactive compact state.
- [x] Trace `reactive_compact_applied` session event writer / reader.
- [x] Trace diagnostics surfaces for existing `latestReactiveCompact`; no thread-surface change selected in Batch 2.
- [x] Add send-path characterization: overflow-like provider errors trigger `runReactiveCompact()` once and retry with reactive `history`, `requestHistory`, `requestUser`, and `cacheEditPlan`.
- [x] Add send-path characterization: retry overflow or retry provider failure does not run a second reactive compact and does not persist completed reactive snip / reactive collapse durable state.
- [x] Add send-path characterization: abort-like errors, including abort errors whose message looks overflow-like, preserve abort outcome and never call `runReactiveCompact()`.
- [x] Add send-path characterization: auth/rate-limit errors are non-eligible at both classifier and send-path level.
- [x] Add send-path characterization: failed `runReactiveCompact()` surfaces the original provider overflow error, except abort-like compact cancellation preserves abort semantics.
- [x] Add characterization for pending initial request-collapse commit candidates: contract requires the pending commit to be drained before reactive full compact.
- [x] Characterize collapse-drain-before-reactive behavior: pending/staged request-collapse commit candidates are attempted first if contract requires it, persistence failure does not block reactive recovery, then reactive full compact is attempted with single-shot guards for both paths.
- [x] Characterize reactive compact retry guard at `sendMainTurn` level: prompt-too-long retry failure does not enter compact -> retry -> compact loops; hook-specific continuation looping remains deferred unless a failing fixture appears.
- [x] Characterize cache-edit plan handling after reactive compact: cache edits from the failed oversized request are replaced by the reactive-prepared cacheEditPlan.
- [x] Add session-event characterization for `reactive_compact_applied`: latest valid event wins; malformed/unknown trigger/strategy are ignored without clearing previous valid event; failed reactive retry still records fallback-prepared / retry-attempted fact.

### 4.2 CCA-182 Contract Prep

- [x] Define the exact reactive compact trigger taxonomy, including mixed overflow+auth/rate-limit messages; structured provider-error object matching remains unsupported until a typed provider shape is introduced.
- [x] Define whether an initial request-collapse commit candidate is a durable drained commit before reactive compact or only an inspection fact until retry success; it is attempted as a durable drained commit when a valid commit candidate exists, but persistence failure must not suppress the overflow retry.
- [x] Define which request-time facts may carry into reactive retry and which must be recomputed from the reactive-prepared baseline; retry uses reactive-prepared `history`, `requestHistory`, `requestUser`, and `cacheEditPlan`.
- [x] Define `reactive_compact_applied` lifecycle semantics: fallback prepared and retry attempted; it does not mean retry completed.
- [x] Define cache-edit plan lifecycle after reactive compact: previous request-side cache edits are not durable state; retry cache edits are recomputed/replaced from the compacted baseline.
- [x] Keep app-server/Web work limited to existing `/context` diagnostics; Batch 2 identified no missing thread surface.
- [x] Keep full durable collapse store / archived spans deferred; Batch 2 only required draining existing collapse commit candidates before reactive compact.

### 4.3 CCA-182 Minimal Implementation Slice

- [x] Pick one minimal implementation target from Batch 2 findings: pending initial request-collapse commit drainage before reactive full compact.
- [x] Default candidate is pending initial request-collapse commit drainage before reactive full compact if characterization proves the candidate is currently lost.
- [x] Prefer strengthening trigger classification / event facts / retry diagnostics before changing compaction materialization.
- [x] Keep the change inside `sendMainTurn`, session-event writer callbacks, and existing context-collapse committed-event/snapshot paths where possible.
- [x] Add targeted tests for the selected slice.
- [x] Update contracts before runtime behavior changes.
- [x] Keep behavior change small enough for one focused review.

## 5. Tests

### 5.1 Core Context Tests

- [x] `packages/core/src/chat/context/middleLayerStrategyStack.test.ts`: request-time `tool_result_budget` scope / persistedHistoryCandidate / stage facts / Formax order / microcompact branch boundaries.
- [x] `packages/core/src/chat/context/microCompact.test.ts` or equivalent: cache-editing/time-based/no-op microcompact branch boundaries; time-based keeps at least one recent compactable result, short-circuits cache-editing, emits no cache edits, and analysis-only surfaces do not content-clear.
- [x] `packages/core/src/chat/context/toolResultBudget.test.ts`: durable marker specificity, no in-place mutation, eligible result selection, reverse fixture for skipped durable replacement remaining budget-eligible.
- [x] `packages/core/src/chat/context/contextProjection.test.ts`: durable replacement replay, skip matrix, raw/UI unchanged, ordering with collapse/snip, collapse-before-replacement fixture.
- [x] `packages/core/src/chat/context/contextProjectionBaseline.test.ts`: projection views and durable-state facts remain named and stable.
- [x] `packages/core/src/chat/context/contextDiagnostics.test.ts` or equivalent: bounded summary, no default full `replacementContent` exposure.

### 5.2 Session / Runtime Tests

- [x] `packages/core/src/features/repl/sessionSave/durableToolResultContentReplacementEvents.test.ts`: event parsing, malformed ignore, source scope, compact generation scoping.
- [x] `packages/core/src/features/repl/controller/send/contextCompressionService.test.ts`: durable replacement before request-only budget, no double-stub, raw history/requestHistory split, reactive retry recomputes request projection/cache edit plan from compacted baseline.
- [x] `packages/core/src/features/repl/controller/send/sendMainTurn.test.ts` (Batch 2/3): eligible/non-eligible provider errors, abort precedence, single retry, failed compact, failed retry cleanup, pending collapse candidate drainage, cacheEditPlan replacement.
- [x] `packages/core/src/features/repl/controller/send/reactiveCompact.test.ts` (Batch 2): reactive error classification, mixed auth/rate-limit + overflow precedence, and unsupported loose object shapes.
- [x] `packages/core/src/features/repl/sessionSave/reactiveCompactEvents.test.ts` (Batch 2): latest reactive compact event reading, malformed/latest-valid semantics, lifecycle meaning.

### 5.3 App-Server / Web Tests

- [x] No durable replacement surface was added; app-server tests assert current thread surfaces do not add `durableToolResultContentReplacement` without a contract-backed field.
- [x] No Web RPC parser/cache positive support was added because no stable durable replacement surface exists.
- [x] If no surface is added, add only negative no-inference tests:
  - [x] `packages/core/src/app-server/threadStore.test.ts`: tool rows containing `TOOL_RESULT_BUDGET_STUB_PREFIX` stay ordinary timeline rows and produce no durable replacement summary.
  - [x] `packages/core/src/app-server/server.test.ts`: current thread surfaces do not add `durableToolResultContentReplacement` without a contract-backed field.
  - [x] `packages/web-reference-react/src/app/core/rpcParsers.test.ts`: uncontracted durable replacement fields and budget-stub row text are ignored as compression facts.
  - [x] `packages/web-reference-react/src/app/core/threadCache.test.ts`: omitted/uncontracted durable replacement facts do not mutate existing compression-fact cache.
  - [x] Hydrate/replay no-inference is covered at the RPC parser/cache boundary because runtime adapters only consume parsed `ThreadCompressionProjectionFacts`.
- [x] Keep CCA-182 Web work limited to facts already exposed by app-server; no local inference.

## 6. Recommended Execution Order

### Batch 1: Tool Result Reducer / Durable Replacement / Microcompact Boundary Audit

- [x] Audit current `microcompact`, `tool_result_budget`, durable replacement, and projection ordering.
- [x] Update this TODO with exact files / gaps found during audit.
- [x] Add/strengthen core request-time boundary tests, including cache-editing/time-based/no-op microcompact branch behavior and analysis-only no content-clearing.
- [x] Add/strengthen durable projection replay tests.
- [x] Add/strengthen session event / runtime fallback tests.
- [x] Default-defer app-server/Web durable replacement stable surface; reverse this only if the audit identifies a concrete consumer and contracts are updated before wiring.
- [x] Add app-server/Web no-inference negative tests if no stable surface is added.
- [x] Update canonical docs if behavior or surface semantics are clarified.
- [x] Add/update a learning note under `docs/learnings/`.
- [x] Run targeted Batch 1 tests only: core context, durable replacement session events, contextCompressionService, contextDiagnostics, and app-server/Web no-inference tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(context): guard tool result replacement boundaries`

### Batch 2: CCA-182 Reactive Compact Characterization Prep

- [x] Audit reactive compact send-path and session event ownership.
- [x] Add send-path characterization for eligible/non-eligible provider errors, abort precedence, single retry, failed compact, failed retry cleanup, cacheEditPlan replacement, and pending collapse candidate handling.
- [x] Add session event characterization for `reactive_compact_applied` valid/latest/malformed semantics.
- [x] Add diagnostics characterization for existing `latestReactiveCompact`.
- [x] Update contracts / TODO with exactly one selected Batch 3 implementation target: pending request-collapse commit drainage before reactive compact.
- [x] Run targeted reactive compact / sendMainTurn / session event / diagnostics tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(context): characterize reactive compact fallback`

### Batch 3: CCA-182 Minimal Implementation Slice

- [x] Implement only the single failing/selected CCA-182 behavior from Batch 2: pending initial request-collapse commit drainage before reactive full compact.
- [x] Keep the change inside `sendMainTurn`, session-event writer callbacks, and the existing context-collapse committed-event/snapshot path; do not change compact materialization.
- [x] Do not introduce durable collapse store, archived spans, or Web-local inference.
- [x] Update app-server/Web only if Batch 2 selected a contract-backed server-owned `latestReactiveCompact` surface; no such surface was selected.
- [x] Add targeted regression tests for the chosen behavior: single retry, abort/auth/rate-limit non-trigger, failed compact/retry cleanup, cacheEditPlan request-only scope, and drainage persistence failure isolation.
- [x] Update canonical docs / learning note.
- [x] Run targeted tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `fix(context): shape reactive compact fallback`

### Batch 4: Closure / Next-Todo Routing

- [x] Update `plans/context-compression-alignment-loop/TODO-INDEX.md`.
- [x] Ensure stable facts live in canonical docs, not only this TODO.
- [x] Decide whether the next mainline is durable collapse store, reactive compact continuation, or another projection-surface follow-up: next recommended TODO is app-server / SDK reactive compact parity audit; durable collapse store remains deferred.
- [x] Add/update learning note for the final state.
- [x] Run docs/path checks through `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `docs(context): close compression boundary rolling plan`

## 7. Deferral Register

- [x] Full durable collapse store / archived spans: deferred; Batch 2/3 only required pending collapse commit drainage before reactive compact.
- [x] Collapse different-id overlap policy: deferred until a concrete failing fixture appears.
- [x] Web UI redesign for compression facts: deferred; parser/cache/diagnostic correctness first.
- [x] Persisting request-time `tool_result_budget`: explicitly out of scope.
- [x] ParentUuid / transcript UUID storage rewrite: explicitly out of scope.
- [x] Broad provider cache-editing redesign: deferred; current scope only replaces failed-request cacheEditPlan with reactive-prepared cacheEditPlan.
- [x] Claude Code content-replacement/cache-editing storage internals: explicitly out of scope; only lifecycle role parity is in scope.
- [x] Claude Code exact query helper order: explicitly out of scope; Formax canonical stage order remains contract-owned.
- [x] `latestReactiveCompact` on `thread/resume` / `thread/read` / `thread/messages` / `thread/replay`: deferred because Batch 2 selected no server-owned fact surface beyond `/context`.
- [x] `reactive_compact_applied` outcome schema: deferred because current semantics are now documented as fallback-prepared / retry-attempted, not retry-completed.
- [x] Reactive cache-edit redesign: deferred; current scope asserts retry uses the recomputed reactive `cacheEditPlan` and never persists it.

## 8. Completion Criteria

- [x] `microcompact`, `tool_result_budget`, and durable replacement boundaries are test-locked and documented.
- [x] Microcompact branch behavior is test-locked: cache-editing is request/API side effect, time-based is cold-cache request projection clearing, and unavailable/missed paths no-op without legacy stubbing.
- [x] Request-time reducers do not masquerade as durable projection state.
- [x] Durable replacement replay is validated, scoped, and protected against double-stub / drift regressions.
- [x] Diagnostics / app-server / Web either expose a bounded server-owned durable replacement fact or explicitly do not infer one.
- [x] Reactive compact characterization includes collapse drain ordering, retry guard persistence, cache-edit plan lifecycle, failed compact/retry cleanup, and `reactive_compact_applied` lifecycle semantics.
- [x] CCA-182 has characterization tests and a minimal implementation slice selected from observed gaps.
- [x] CCA-182 implementation slice, if executed, has targeted tests and clean review.
- [x] Contracts / README / learning notes are aligned.
- [x] TODO index points to the next real follow-up after this rolling plan.
