# Web Replay Cursor and Harness Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] WebGPT `repomix-output/rsesponse/2.md` identifies W1 as a confirmed bug: Web `turnEventCursor` keeps one global `lastReplaySeq`.
- [x] Current `packages/web-reference-react/src/turnEventCursor.ts` still stores `lastReplaySeq: number | null` globally in `TurnEventCursorState`.
- [x] Current `packages/web-reference-react/src/turnEventCursor.test.ts` asserts global replaySeq ordering, including rejecting replaySeq `11` after `12` without thread scope.
- [x] WebGPT says a live/replay notification from thread A with a high replay sequence can cause replay hydration for thread B with lower replay sequence to be rejected as stale.
- [x] WebGPT `repomix-output/rsesponse/1.md` and `2.md` both call out duplicated Web RPC test harness behavior across integration tests.
- [x] Current Web integration tests still inline repeated `rpcMock`, `inferThreadId`, and `inferTurnId` helpers in multiple `packages/web-reference-react/src/__tests__/*.integration.test.tsx` files.
- [x] W2 active-thread/null surface appears at least partially addressed by `deriveVisibleSurface()` and `AppShell` gating on `visibleSurface === 'thread' && activeThreadId != null`.
- [x] W4 `pendingSessionMemoryRestore` malformed optional parsing appears at least partially addressed by existing `rpcParsers` / `rpcContracts` tests for omitted/null/additive restore fields.
- [x] The previous `sessionSave` layer-boundary todo is complete and committed.

### 0.2 Goals
- [ ] Fix Web replay sequencing so replay hydration for one thread cannot be rejected by another thread's higher replay sequence.
- [ ] Preserve event-id dedupe and per-trace live notification ordering semantics.
- [ ] Make replay/live sequencing ownership explicit enough that future Web runtime changes do not reintroduce cross-thread cursor coupling.
- [ ] Add targeted tests for cross-thread replaySeq behavior and replay hydration behavior before or with the fix.
- [ ] Defer shared Web RPC harness extraction unless unit/runtime tests cannot prove the W1 replay hydration regression.
- [ ] Keep each implementation loop reviewable and committed after targeted verification and `codex review`.

### 0.3 Non-goals
- [x] Do not rewrite the whole Web runtime or app-server JSON-RPC protocol.
- [x] Do not implement the broader `prepareTurnContextRequest` unification in this task.
- [x] Do not migrate renderer-neutral `ToolViewBlock` / `ToolCallViewModel` in this task.
- [x] Do not split `policyPreflight.ts` in this task.
- [x] Do not migrate all Web integration tests to a new harness in one pass.
- [x] Do not change app-server replay payload shapes unless a targeted contract test proves the current shape is insufficient.
- [x] Do not treat W2 or W4 as open implementation work unless current tests or inspection prove a remaining bug.

### 0.4 Current suspected hot spots
- [x] `packages/web-reference-react/src/turnEventCursor.ts` owns sequenced notification accept/reject decisions.
- [x] `packages/web-reference-react/src/app/useAppRuntime.ts` calls `shouldAcceptSequencedNotification(eventCursorRef.current, params)`.
- [x] `packages/web-reference-react/src/app/runtime/replayThreadEvents.ts` handles replay hydration and replay fact cache updates.
- [x] `packages/web-reference-react/src/app/runtime/processNotification.ts` processes live and replay-like notifications.
- [x] `packages/web-reference-react/src/__tests__/app-thread.integration.test.tsx`, `app-composer.integration.test.tsx`, `app-approval.integration.test.tsx`, `app-diff.integration.test.tsx`, and `App.test.tsx` contain duplicated RPC mock scaffolding.

## 1. Definitions First

### 1.1 Canonical docs
- [ ] Re-read `docs/contracts/web-parity-adapter-contract.md` before changing cursor or replay hydration behavior.
- [ ] Re-read `docs/contracts/app-server-interaction-contract.md` if replay payload presence/null semantics are touched.
- [ ] Re-read `packages/web-reference-react/AGENTS.md` before editing Web tests or package scripts.
- [ ] Update `docs/contracts/web-parity-adapter-contract.md` only if this task changes the cursor contract wording.
- [ ] Update `packages/web-reference-react/CODEMAP.md` if new shared Web test harness files are added.
- [ ] Add/update a short learning note under `docs/learnings/` after the cursor fix lands.

### 1.2 Cursor ownership model
- [ ] Define whether `replaySeq` ordering is scoped by `threadId`, by explicit replay stream key, or by another stable source.
- [ ] Define how live notifications with `traceId` / `seq` interact with replay hydration entries that carry `replaySeq`.
- [ ] Define whether event-id dedupe stays global or becomes scoped; default should stay global unless tests prove cross-thread collisions are valid.
- [ ] Define whether replay hydration should bypass live sequenced-notification gating entirely or use a replay-specific accept path.
- [ ] Define when cursor state is reset, if ever, across app initialization, thread switching, and explicit reloads.
- [ ] Define the owner API explicitly as `{ kind: 'live-stream' } | { kind: 'thread-replay'; threadId: string }`; do not pass a bare threadId.
- [ ] Define that live-stream `eventId` dedupe remains global, but replay hydration must not consult global live `seenEventIds`.
- [ ] Define that replay hydration scope is the requested `thread/replay` threadId, not an inferred `params.threadId`.
- [ ] Define missing replay scope as a reject/dev-test failure, not accept-by-default.

### 1.3 Test harness boundary
- [ ] Define the minimal shared RPC harness API needed for replay/cursor tests.
- [ ] Keep the harness data-driven: tests should configure scenario responses and notifications, not duplicate protocol inference logic.
- [ ] Keep harness extraction small enough to review independently; migrate only the tests touched by this task plus one contract test.
- [ ] Do not make the harness a second source of app-server protocol truth; parser/contract tests remain authoritative for payload shape.

## 2. Runtime / Platform

### 2.1 Cursor implementation
- [ ] Replace global `lastReplaySeq` with replay ordering state scoped to the correct replay owner.
- [ ] Preserve bounded `seenEventIds` eviction behavior.
- [ ] Preserve per-`traceId` live `seq` monotonic behavior.
- [ ] Ensure out-of-order replay entries are rejected only within the same replay scope.
- [ ] Ensure a higher live/replay notification for thread A does not reject thread B replay hydration.
- [ ] Ensure accepted/rejected decisions do not advance unrelated scope bookkeeping.
- [ ] Make cursor acceptance two-phase: validate duplicate/stale conditions before mutating eventId, replaySeq, or trace seq state.
- [ ] Preserve live behavior: global eventId dedupe, global live replaySeq, and per-trace seq.

### 2.2 Replay hydration flow
- [ ] Inspect whether replay hydration currently flows through the same `handleNotification` path as live notifications.
- [ ] Ensure replay hydration calls `handleReplayNotification(notification, threadId)` or `handleNotification(notification, { kind: 'thread-replay', threadId })`; it must not call bare live `handleNotification`.
- [ ] Treat acceptance as a precondition before any mutation: no `runtimeStateByThreadRef` write, no `replayCursorByThreadRef` write, no projection dispatch, no compact/restore/cache update, no thread refresh.
- [ ] Preserve compact-boundary, durable snip, request-collapse, and pending restore cache update semantics.
- [ ] Preserve gap detection and replay state snapshots.

### 2.3 App-server contract touchpoints
- [ ] Verify app-server replay/read/messages/resume still provide enough thread identity for scoped replay ordering.
- [ ] Avoid app-server changes unless Web cannot determine replay scope from existing payloads.
- [ ] If app-server changes become necessary, update `docs/contracts/app-server-interaction-contract.md` first.

## 3. Frontend Boundary

### 3.1 Visible surface behavior
- [ ] Preserve current `deriveVisibleSurface()` behavior for welcome/draft/thread surfaces.
- [ ] Preserve thread-only shell gating: no thread chrome/projection when `activeThreadId == null`.
- [ ] If `processNotification` active-thread gating is touched, add one W2 no-thread regression: `activeThreadIdRef.current = null` must not apply visible projection/chrome.

### 3.2 Runtime state ownership
- [ ] Keep Web as consumer of explicit app-server facts, not an inference engine for compression/restore facts.
- [ ] Avoid moving projection fact parsing into UI components.
- [ ] Keep replay cursor logic out of React render components.
- [ ] If thread/replay parsing or cache application is touched, run existing W4 `rpcParsers` / `rpcContracts` / `threadDataOps` restore tests.

### 3.3 RPC harness
- [ ] Add `packages/web-reference-react/src/test/createRpcHarness.ts` only if unit/runtime tests cannot prove the W1 replay hydration regression.
- [ ] Add a focused harness contract test for request recording, notification emission, thread/turn inference, and reset behavior if a harness is introduced.
- [ ] Migrate the replay-focused integration test to the shared harness only if that integration test is required for W1 proof.
- [ ] Defer broad migration of composer/approval/diff/terminal integration tests.

## 4. Tests

### 4.1 Cursor unit tests
- [ ] Add a failing test that thread A replaySeq `100` does not reject thread B replaySeq `1`.
- [ ] Add a same-thread replaySeq test that still rejects older or duplicate replaySeq values within that thread.
- [ ] Add a test proving event-id dedupe still rejects repeated event IDs.
- [ ] Add a test proving per-trace live sequence behavior is unchanged.
- [ ] Add a test for missing replay scope if the new API requires a scope key.
- [ ] Add a test that a rejected stale replaySeq does not consume eventId dedupe state.
- [ ] Add a test that live-stream replaySeq ordering remains global while thread-replay ordering is scoped.

### 4.2 Replay/runtime tests
- [ ] Add or update `packages/web-reference-react/src/app/runtime/replayThreadEvents.test.ts` for cross-thread replay hydration.
- [ ] Add or update `packages/web-reference-react/src/app/runtime/processNotification.test.ts` if live notification acceptance order changes.
- [ ] Add `packages/web-reference-react/src/app/runtime/useRuntimeEventOrchestrator.test.tsx` coverage if replay/live source ownership is wired through the orchestrator.
- [ ] In `processNotification.test.ts`, assert rejected sequenced notifications leave `runtimeStateByThreadRef` and `replayCursorByThreadRef` unchanged.
- [ ] Add or update a Web integration test only if unit/runtime tests cannot prove the user-visible replay bug.
- [ ] Keep pending restore / compact fact tests green after cursor changes.

### 4.3 Harness tests
- [ ] Add `packages/web-reference-react/src/test/createRpcHarness.contract.test.ts` if a harness is introduced.
- [ ] Run only targeted Web tests during implementation loops.
- [ ] Run package-level Web test command only in the final loop or when harness extraction touches many tests.

## 5. Recommended Execution Order

### Loop 1: Fix scoped replay cursor
Review gate for this loop:
- Blocking: replaySeq remains globally ordered across all threads, event-id dedupe regresses, live trace ordering regresses, or cursor acceptance mutates unrelated scope state.
- Non-blocking: broad Web RPC harness duplication remains pending.

- [ ] Re-read `docs/contracts/web-parity-adapter-contract.md`.
- [ ] Add failing `turnEventCursor` tests for cross-thread replaySeq acceptance and same-thread replaySeq rejection.
- [ ] Introduce typed live/replay owner API and update all compile-time call sites.
- [ ] Change `turnEventCursor` state/API to scope replaySeq ordering by owner.
- [ ] Add two-phase cursor mutation tests.
- [ ] Update `useAppRuntime` and any direct cursor call sites to pass the scoped replay owner.
- [ ] Run targeted cursor/runtime tests.
- [ ] Run `codex review` for this loop after targeted verification passes.
- [ ] Commit this loop after review passes.

### Loop 2: Wire replay hydration semantics through runtime
Review gate for this loop:
- Blocking: replay hydration can still be dropped by another thread's cursor state, rejected replay entries update caches before acceptance, or compact/restore facts drift.
- Non-blocking: broad RPC harness migration remains pending.

- [ ] Add replay hydration regression tests for thread A high replaySeq plus thread B lower replaySeq.
- [ ] Replace bare replay `handleNotification` calls with replay-owned processing.
- [ ] Ensure replay hydration uses the scoped cursor path or bypasses live notification cursor as appropriate.
- [ ] Ensure rejected entries do not advance per-thread runtime state before acceptance.
- [ ] Prove replay hydration from thread B with replaySeq `1` / `2` still applies after live thread A replaySeq `100`.
- [ ] Prove from-start replay is not suppressed by global live eventId dedupe.
- [ ] Run targeted Web runtime tests for replay, processNotification, threadDataOps, and cursor.
- [ ] Run `codex review` for this loop after targeted verification passes.
- [ ] Commit this loop after review passes.

### Loop 3: Optional targeted Web RPC harness, only if Loop 2 requires an integration test
Review gate for this loop:
- Blocking: harness becomes a second protocol implementation, migrated tests lose assertions, or harness extraction expands across unrelated test families.
- Non-blocking: remaining duplicated RPC mocks in unrelated integration tests.

- [ ] Decide whether unit/runtime tests already prove W1; if yes, move this loop to deferred without implementation.
- [ ] Design the smallest `createRpcHarness` API for replay/cursor integration tests only if integration coverage is required.
- [ ] Add a harness contract test only if a harness is introduced.
- [ ] Migrate one replay-focused integration test or the smallest affected integration test to the harness only if needed.
- [ ] Leave unrelated integration tests unchanged unless they are directly touched by this bug fix.
- [ ] Run targeted migrated Web tests plus harness contract test if this optional loop is implemented.
- [ ] Run `codex review` for this loop after targeted verification passes if this optional loop is implemented.
- [ ] Commit this loop after review passes if this optional loop is implemented.

### Loop 4: Final convergence and documentation
Review gate for this loop:
- Blocking: Web cursor contract docs are stale, CODEMAP misses new harness path, package tests fail, or todo still has implementation ambiguity.
- Non-blocking: prepare-turn-context unification, ToolViewBlock migration, policy preflight split, package ownership migration.

- [ ] Update `docs/contracts/web-parity-adapter-contract.md` if cursor scope semantics changed.
- [ ] Update `packages/web-reference-react/CODEMAP.md` if a shared harness file was added.
- [ ] Add/update `docs/learnings/` note for Web replay cursor scoping.
- [ ] Run final targeted Web tests.
- [ ] Run `bun run type-check`.
- [ ] Run `codex review` for this loop after targeted verification passes.
- [ ] Commit this loop after review passes.

## 6. Deferred Follow-Up Candidates

- Broader Web RPC harness migration across composer, approval, diff, terminal, and App integration tests.
- Initial shared Web RPC harness extraction if W1 is fully proven by unit/runtime tests.
- Web local boundary gate for `app/core`, `app/runtime`, parity/adapters, and components.
- Broader `prepareTurnContextRequest` unification across REPL, app-server, and SDK.
- Cross-layer context/compact golden fixture matrix across REPL, app-server, SDK, diagnostics, and Web.
- Renderer-neutral `ToolViewBlock` / `ToolCallViewModel` migration.
- `policyPreflight.ts` decision/effect pipeline split.
- Public package ownership migration for `@formax/semantics` and `@formax/shared`.
