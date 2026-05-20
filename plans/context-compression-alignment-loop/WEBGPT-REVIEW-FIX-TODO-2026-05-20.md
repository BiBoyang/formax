# WebGPT Context Compression Review Fix TODO

来源：2026-05-20 本地 subagent 审查 + 6 份 WebGPT 回复。

目标：收敛 Claude Code context compression 移植后的跨层语义风险。先用测试锁定 request-only / persisted history / resume authority / Web parity 的合同边界，再分批修复实现，避免把 runtime、session、Web、algorithm 问题混在同一轮里。

## Source Inputs

- 本地 subagent runtime request pipeline review
- 本地 subagent session / restore / persistence review
- 本地 subagent app-server / Web parity review
- WebGPT root review: `repomix-output/0.md`
- WebGPT runtime stack review: `repomix-output/01-runtime-stack/`
- WebGPT session restore review: `repomix-output/02-session-restore/`
- WebGPT app/web parity review: `repomix-output/03-app-web-parity/`
- WebGPT algorithm semantics review: `repomix-output/04-compact-algorithms/`
- WebGPT test/contract review: `repomix-output/05-test-contracts/`

## Batch 0: Triage Decisions

- [x] Decide whether `microcompact` is request-only or allowed to persist stubs.
  - Decision: the compression effect is request/API-only and must not rewrite canonical persisted history.
  - Claude Code evidence: cached microcompact leaves local messages unchanged and injects `cache_edits` / `cache_reference` at the API layer; time-based microcompact only changes `messagesForQuery`.
  - A persisted `microcompact_boundary`-style event marker is allowed only as non-semantic metadata. It must not act as a compact/prune boundary and must not cause resume/load to delete or rewrite messages.
  - Implementation implication: stop treating `microCompactResult.messages` as a persisted history candidate unless the contract is deliberately changed first.
- [x] Decide whether replay UI should show `latestRequestCollapse`.
  - Decision: do not insert `latestRequestCollapse` into replay/timeline `data[]`.
  - Claude Code evidence: context-collapse is a read-time request projection; it yields no REPL message and stores summaries in collapse side state, not the transcript message array.
  - `thread/read`, `thread/messages`, and `thread/replay` may expose `latestRequestCollapse` as optional diagnostics/inspection metadata, but it must not affect replay cursor, pagination, transcript item count, or transcript rows.
- [x] Decide app-server restore reminder consumption point: turn accepted vs model dispatch started vs successful model dispatch.
  - Decision: consume pending restore/injected blocks at durable model-dispatch ownership, not when `turn/start` is merely accepted and not after full turn success.
  - The safe boundary is inside the runner after session writer setup, `app_turn_started`, stable user message persistence, and request payload construction, when pending blocks are confirmed to be part of the model request that is about to be dispatched.
  - If dispatch fails before that boundary, pending restore must remain visible to `thread/replay` / `thread/read` and be retried. If dispatch starts and later fails or is interrupted, pending restore must not be injected again.
- [x] Decide whether app-server `/compact` must reuse TUI `runCompactFlow`.
  - Decision: yes. App-server `/compact` should reuse the canonical compact flow or a shared non-TUI core helper extracted from it.
  - Claude Code evidence: manual `/compact`, auto compact, and reactive compact all converge through `CompactionResult -> buildPostCompactMessages()`; there is no separate hardcoded `keep_last_turns=0` app-server branch.
  - Implementation implication: remove the app-server-only `MANUAL_COMPACT_KEEP_LAST_TURNS = 0` path or reduce it to transport/event concerns around the shared compact flow.

## Batch 1: Runtime Stack Ownership

### Risks

- [x] App-server normal turn bypasses canonical middle-layer stack.
  - Evidence: `packages/core/src/app-server/turnRunner.ts` calls `engine.runTurn` without `requestHistory`, `promptBudget`, or `executeMiddleLayerStrategyStack`.
  - Fixed in this batch: app-server normal turns now run the canonical stack before model dispatch and pass separate `history`, `requestHistory`, and `promptBudget` into `engine.runTurn`.
- [x] SDK query bypasses canonical middle-layer stack.
  - Evidence: `packages/core/src/sdk/query/runner.ts` calls `runtime.engine.runTurn` directly with only `history` and `user`.
  - Fixed in this batch: SDK query attempts now run the canonical stack and pass separate `history`, `requestHistory`, `user`, `requestUser`, and `promptBudget` into `engine.runTurn`.
- [x] App-server `/compact` uses hardcoded keep strategy instead of canonical manual compact flow.
  - Fixed in this batch: app-server manual `/compact` now delegates to shared `runCompactFlow`, preserving latest-boundary handling, working-set-aware `keep_combo`, rehydration, and compact request prompt behavior.
- [x] Terminal prune may persist a truncated current user message.
  - Fixed in this batch: `ChatEngine.runTurn` now separates persisted `user` from request-only `requestUser`, and TUI/app-server pass prepared trailing messages only as request payload.
- [x] Request-only injected prompt blocks may persist after prune force-fit.
  - Fixed by the `requestUser` split: force-fit/request-pruned current-user payloads are sent only as `requestUser`, while persisted `user` is stripped of request-only injected blocks after the turn.
- [x] `microcompact` is run outside the canonical stack and then again inside it.
  - Fixed in this batch: auto-compact preflight now reads `microCompactedHistory` from the first canonical stack execution instead of running a separate pre-stack `microCompactHistory` pass.
- [x] `microcompact` may be persisted despite contract language describing it as request-time.
  - Fixed in this batch: `persistedHistoryCandidate` now preserves the canonical baseline while `microCompactedHistory` / `requestHistory` carry request-time reducer effects.

### Tests First

- [x] Add app-server turn test: long history produces distinct `requestHistory` and non-null `promptBudget`.
- [x] Add SDK query test: resume/continue with long history uses canonical stack projection.
- [x] Add `sendMainTurn` test: force-fit user request persists original user content, not pruned request text.
- [x] Add injected-block test: request-only reminders are absent from persisted history after tiny-budget force-fit.
- [x] Add middle-layer invariant test: request-time stages affect `requestHistory` / assembled envelope, not persisted baseline.
- [x] Add `microcompact` contract test once Batch 0 decision is made.

### Implementation

- [x] Introduce or extract a shared adapter for app-server and SDK to call the canonical middle-layer stack.
  - Added `prepareTurnRequestProjection()` so app-server and SDK share the persisted-history/request-history/request-user projection boundary.
- [x] Pass `requestHistory` and `promptBudget` into app-server / SDK engine turns.
- [x] Separate persisted user from request-projected user where terminal prune can alter the current turn.
- [x] Keep terminal prune scoped to assembled request envelope.
- [x] Remove duplicate pre-stack `microcompact` execution if canonical stack already owns the stage.
- [x] If `microcompact` remains request-only, stop using microcompacted messages as `persistedHistoryCandidate`.
- [ ] If `microcompact` is intentionally persisted, update `docs/contracts/context-strategy-stack-contract.md` first and add explicit persisted-stub tests.

## Batch 2: Session Persistence / Resume Authority

### Risks

- [x] REPL `/resume` appends boundary-stripped active continuation as authoritative `history_state`.
  - Fixed in this batch: `/resume` now opens the existing writer and appends a `resume` event without immediately writing the active continuation as a new authoritative `history_state`; subsequent turn completion preserves the replay compact-boundary prefix when snapshotting active continuation.
- [x] Startup `resumeLast` appends boundary-stripped active continuation as authoritative `history_state`.
  - Fixed in this batch: startup writer open now records resume metadata without rewriting `history_state`, and `resolveInitialSession()` carries `replayHistory` so later turn snapshots can preserve compact-boundary authority.
- [x] SDK resume persistence appends boundary-stripped active history.
  - Fixed in this batch: file-backed SDK resume/continue stores `replayHistory` and persists post-turn snapshots via `buildSessionReplayHistoryWithActiveContinuation()`.
- [x] REPL `/resume` refreshes `.memory.json` before reading restore injected blocks.
  - Covered in this batch: `runResumeSessionTransition()` awaits sidecar refresh from restored active history before reading next-turn restore injected blocks.
- [x] App-server `thread/resume` derives restore blocks from stale sidecar before refreshing from JSONL replay.
  - Fixed in this batch: `ThreadStore.resumeThread()` now refreshes sidecar from boundary-aware active history before deriving returned pending restore blocks when a restore block is pending.
- [x] App-server clears pending restore blocks before durable model dispatch.
  - Verified in this batch: app-server keeps pending restore through `turn/start` accept and pre-dispatch failures, then consumes it only when the runner invokes the durable dispatch-consumption callback.

### Tests First

- [x] Add resume transition integration test with compact-boundary session fixture.
  - Covered by an app-server integration fixture that writes a real JSONL session with a compact boundary, resumes it, and verifies the same boundary remains visible across Web-facing thread surfaces.
- [x] Add startup `resumeLast` test asserting compact boundary remains visible to `readSessionFile`.
- [x] Add SDK resume persistence test asserting compact boundary survives after a resumed turn.
- [x] Add restore sidecar freshness test using stale sidecar + newer JSONL replay.
- [x] Add app-server pending restore retry/failure test.
- [x] Add cross-interface consistency test for `latestCompactBoundary` after resume/read/messages/replay.

### Implementation

- [x] Stop writing boundary-stripped active history as the latest authoritative snapshot.
- [x] Preserve session JSONL replay as authority; active continuation should be runtime view only.
- [x] Resolve restore artifacts before sidecar refresh where needed.
- [x] For app-server resume, derive next-turn restore blocks from fresh boundary-aware active history or refresh sidecar before consuming artifacts.
- [x] Move app-server pending restore consumption to a safer dispatch/success boundary, or update the contract if “turn accepted” is the intended consumption point.

## Batch 3: App-Server / Web Parity

### Risks

- [x] Live `compact_boundary` event does not update `latestCompactBoundaryByThreadId`.
- [x] Projection drops compact boundary `messageKind`, producing empty transcript rows.
- [ ] Replay source suppresses `latestRequestCollapse`.
- [ ] Optional RPC fields are treated as required.
- [ ] App-server `/context` text omits latest compact boundary.
- [ ] App-server `/context` plan mode uses `planPath: null`.
- [x] Live/replay compact boundary cache may briefly return null or stale values after compact events.

### Tests First

- [x] Add `processNotification` test for live compact boundary cache update.
- [x] Add projection/render test for compact boundary row or explicit suppression.
- [ ] Add `useTranscriptDisplayState` test for replay + `latestRequestCollapse` intended behavior.
- [ ] Add RPC parser tests for omitted optional compact/collapse/restore fields.
- [ ] Add app-server `/context` text/json consistency test.
- [ ] Add plan-mode `/context` diagnostics test.
- [x] Add replay cache test: `turn/event compact_boundary` followed immediately by `thread/replay` returns the same boundary.

### Implementation

- [x] Update live event handling to write compact/collapse caches.
  - Compact boundary cache is now refreshed from live `turn/event compact_boundary` in both app-server replay metadata and Web runtime notification handling. Collapse remains sourced from RPC/replay diagnostics because there is no live collapse event in the current protocol.
- [x] Extend `TranscriptItem` / projection model to preserve compact boundary UI kind or explicitly suppress it with a documented rule.
  - Web render-model messages now preserve projection `messageKind`; empty `compact_boundary` system rows are explicitly suppressed so they do not render as blank assistant transcript rows.
- [ ] Relax optional field parsers for compact/collapse/restore fields.
- [ ] Pass latest compact boundary into diagnostics text formatting.
- [ ] Pass real plan path into app-server diagnostics, or expose an explicit unknown/unavailable state.
- [ ] Align `thread/read`, `thread/messages`, `thread/resume`, `thread/replay`, and `/context` compact/collapse summaries.

## Batch 4: Algorithm Edge Cases

### Risks

- [ ] `resolveHistoryForCompaction` with boundary and empty continuation may recompact old summary.
- [ ] Collapse tail selection counts compaction summary as a normal user turn.
- [ ] Working-set anchor behavior with `keepLastTurns=0` may drop a recent execution cluster.
- [ ] `sanitizeReminderText` already handles basic mixed-case tags, but not tagged variants with attributes.
- [ ] Time-aware microcompact stale-turn definition may be too narrow if assistant-only drift should count.

### Tests First

- [ ] Add compact test: boundary exists and continuation is empty.
- [ ] Add collapse test: compaction summary is not counted as normal user turn.
- [ ] Add working-set test: manual compact with `keepLastTurns=0` preserves recent execution cluster if contract requires it.
- [ ] Add sanitize test for `<system-reminder attr="x">`.
- [ ] Decide whether assistant-only staleness should count for time-aware microcompact.

### Implementation

- [ ] Patch only edge cases confirmed by failing tests.
- [ ] Keep behavior unchanged where WebGPT finding was a false positive or intentional design.
- [ ] Update `docs/contracts/context-strategy-stack-contract.md` if algorithm semantics change.

## Known False Positives / Low Confidence

- [ ] `sanitizeReminderText` already handles basic mixed-case tags via `/gi`; only attribute variants remain a possible gap.
- [ ] `toolResultBudget savedTokens <= 0` does continue to the next candidate; the WebGPT finding that it stops early appears false.
- [ ] Manual compact vs auto/reactive partial compaction may be intentional; confirm via contract before changing behavior.
- [ ] Time-aware microcompact counting only subsequent non-tool user turns may be intended; do not change without a clear product/contract decision.

## Suggested Execution Order

1. Batch 0 decisions that affect test expectations.
2. Batch 1 tests-first for runtime stack ownership.
3. Batch 2 tests-first for session authority.
4. Batch 3 Web/app-server parity tests and fixes.
5. Batch 4 algorithm edge-case tests and targeted fixes.

## Validation Commands

Use targeted tests first; avoid coverage runs in this loop.

- [ ] `bun run test -- <targeted core test files>`
- [ ] `npm run test -- <targeted web-reference-react test files>`
- [ ] `bun run test:repl-semantic-gate` if touching `packages/core/src/features/repl/**` semantic flow
- [ ] `bun run type-check` after implementation batches
- [ ] Mandatory review after tests pass:

```sh
mkdir -p .tmp/codex-review-result
codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high" > .tmp/codex-review-result/review-latest.txt 2>&1
tail -n 80 .tmp/codex-review-result/review-latest.txt
```
