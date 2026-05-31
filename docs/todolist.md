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
- [x] Fix Web replay sequencing so replay hydration for one thread cannot be rejected by another thread's higher replay sequence.
- [x] Preserve event-id dedupe and per-trace live notification ordering semantics.
- [x] Make replay/live sequencing ownership explicit enough that future Web runtime changes do not reintroduce cross-thread cursor coupling.
- [x] Add targeted tests for cross-thread replaySeq behavior and replay hydration behavior before or with the fix.
- [x] Defer shared Web RPC harness extraction unless unit/runtime tests cannot prove the W1 replay hydration regression.
- [x] Keep each implementation loop reviewable and committed after targeted verification and `codex review`.

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
- [x] Re-read `docs/contracts/web-parity-adapter-contract.md` before changing cursor or replay hydration behavior.
- [x] Re-read `docs/contracts/app-server-interaction-contract.md` if replay payload presence/null semantics are touched.
- [x] Re-read `packages/web-reference-react/AGENTS.md` before editing Web tests or package scripts.
- [x] Update `docs/contracts/web-parity-adapter-contract.md` only if this task changes the cursor contract wording.
- [x] Update `packages/web-reference-react/CODEMAP.md` if new shared Web test harness files are added.
- [x] Add/update a short learning note under `docs/learnings/` after the cursor fix lands.

### 1.2 Cursor ownership model
- [x] Define whether `replaySeq` ordering is scoped by `threadId`, by explicit replay stream key, or by another stable source.
- [x] Define how live notifications with `traceId` / `seq` interact with replay hydration entries that carry `replaySeq`.
- [x] Define whether event-id dedupe stays global or becomes scoped; default should stay global unless tests prove cross-thread collisions are valid.
- [x] Define whether replay hydration should bypass live sequenced-notification gating entirely or use a replay-specific accept path.
- [x] Define when cursor state is reset, if ever, across app initialization, thread switching, and explicit reloads.
- [x] Define the owner API explicitly as `{ kind: 'live-stream' } | { kind: 'thread-replay'; threadId: string }`; do not pass a bare threadId.
- [x] Define that live-stream `eventId` dedupe remains global, but replay hydration must not consult global live `seenEventIds`.
- [x] Define that replay hydration scope is the requested `thread/replay` threadId, not an inferred `params.threadId`.
- [x] Define missing replay scope as a reject/dev-test failure, not accept-by-default.

### 1.3 Test harness boundary
- [x] Define the minimal shared RPC harness API needed for replay/cursor tests.
- [x] Keep the harness data-driven: tests should configure scenario responses and notifications, not duplicate protocol inference logic.
- [x] Keep harness extraction small enough to review independently; migrate only the tests touched by this task plus one contract test.
- [x] Do not make the harness a second source of app-server protocol truth; parser/contract tests remain authoritative for payload shape.

## 2. Runtime / Platform

### 2.1 Cursor implementation
- [x] Replace global `lastReplaySeq` with replay ordering state scoped to the correct replay owner.
- [x] Preserve bounded `seenEventIds` eviction behavior.
- [x] Preserve per-`traceId` live `seq` monotonic behavior.
- [x] Ensure out-of-order replay entries are rejected only within the same replay scope.
- [x] Ensure a higher live/replay notification for thread A does not reject thread B replay hydration.
- [x] Ensure accepted/rejected decisions do not advance unrelated scope bookkeeping.
- [x] Make cursor acceptance two-phase: validate duplicate/stale conditions before mutating eventId, replaySeq, or trace seq state.
- [x] Preserve live behavior: global eventId dedupe, global live replaySeq, and per-trace seq.

### 2.2 Replay hydration flow
- [x] Inspect whether replay hydration currently flows through the same `handleNotification` path as live notifications.
- [x] Ensure replay hydration calls `handleReplayNotification(notification, threadId)` or `handleNotification(notification, { kind: 'thread-replay', threadId })`; it must not call bare live `handleNotification`.
- [x] Treat acceptance as a precondition before any mutation: no `runtimeStateByThreadRef` write, no `replayCursorByThreadRef` write, no projection dispatch, no compact/restore/cache update, no thread refresh.
- [x] Preserve compact-boundary, durable snip, request-collapse, and pending restore cache update semantics.
- [x] Preserve gap detection and replay state snapshots.

### 2.3 App-server contract touchpoints
- [x] Verify app-server replay/read/messages/resume still provide enough thread identity for scoped replay ordering.
- [x] Avoid app-server changes unless Web cannot determine replay scope from existing payloads.
- [x] If app-server changes become necessary, update `docs/contracts/app-server-interaction-contract.md` first.

## 3. Frontend Boundary

### 3.1 Visible surface behavior
- [x] Preserve current `deriveVisibleSurface()` behavior for welcome/draft/thread surfaces.
- [x] Preserve thread-only shell gating: no thread chrome/projection when `activeThreadId == null`.
- [x] If `processNotification` active-thread gating is touched, add one W2 no-thread regression: `activeThreadIdRef.current = null` must not apply visible projection/chrome.

### 3.2 Runtime state ownership
- [x] Keep Web as consumer of explicit app-server facts, not an inference engine for compression/restore facts.
- [x] Avoid moving projection fact parsing into UI components.
- [x] Keep replay cursor logic out of React render components.
- [x] If thread/replay parsing or cache application is touched, run existing W4 `rpcParsers` / `rpcContracts` / `threadDataOps` restore tests.

### 3.3 RPC harness
- [x] Add a shared Web RPC harness file only if unit/runtime tests cannot prove the W1 replay hydration regression.
- [x] Add a focused harness contract test for request recording, notification emission, thread/turn inference, and reset behavior if a harness is introduced.
- [x] Migrate the replay-focused integration test to the shared harness only if that integration test is required for W1 proof.
- [x] Defer broad migration of composer/approval/diff/terminal integration tests.

## 4. Tests

### 4.1 Cursor unit tests
- [x] Add a failing test that thread A replaySeq `100` does not reject thread B replaySeq `1`.
- [x] Add a same-thread replaySeq test that still rejects older or duplicate replaySeq values within that thread.
- [x] Add a test proving event-id dedupe still rejects repeated event IDs.
- [x] Add a test proving per-trace live sequence behavior is unchanged.
- [x] Add a test for missing replay scope if the new API requires a scope key.
- [x] Add a test that a rejected stale replaySeq does not consume eventId dedupe state.
- [x] Add a test that live-stream replaySeq ordering remains global while thread-replay ordering is scoped.

### 4.2 Replay/runtime tests
- [x] Add or update `packages/web-reference-react/src/app/runtime/replayThreadEvents.test.ts` for cross-thread replay hydration.
- [x] Add or update `packages/web-reference-react/src/app/runtime/processNotification.test.ts` if live notification acceptance order changes.
- [x] Add `packages/web-reference-react/src/app/runtime/useRuntimeEventOrchestrator.test.tsx` coverage if replay/live source ownership is wired through the orchestrator.
- [x] In `processNotification.test.ts`, assert rejected sequenced notifications leave `runtimeStateByThreadRef` and `replayCursorByThreadRef` unchanged.
- [x] Add or update a Web integration test only if unit/runtime tests cannot prove the user-visible replay bug.
- [x] Keep pending restore / compact fact tests green after cursor changes.

### 4.3 Harness tests
- [x] Add a shared Web RPC harness contract test if a harness is introduced.
- [x] Run only targeted Web tests during implementation loops.
- [x] Run package-level Web test command only in the final loop or when harness extraction touches many tests.

## 5. Recommended Execution Order

### Loop 1: Fix scoped replay cursor
Review gate for this loop:
- Blocking: replaySeq remains globally ordered across all threads, event-id dedupe regresses, live trace ordering regresses, or cursor acceptance mutates unrelated scope state.
- Non-blocking: broad Web RPC harness duplication remains pending.

- [x] Re-read `docs/contracts/web-parity-adapter-contract.md`.
- [x] Add failing `turnEventCursor` tests for cross-thread replaySeq acceptance and same-thread replaySeq rejection.
- [x] Introduce typed live/replay owner API and update all compile-time call sites.
- [x] Change `turnEventCursor` state/API to scope replaySeq ordering by owner.
- [x] Add two-phase cursor mutation tests.
- [x] Update `useAppRuntime` and any direct cursor call sites to pass the scoped replay owner.
- [x] Run targeted cursor/runtime tests.
- [x] Run `codex review` for this loop after targeted verification passes.
- [x] Commit this loop after review passes.

### Loop 2: Wire replay hydration semantics through runtime
Review gate for this loop:
- Blocking: replay hydration can still be dropped by another thread's cursor state, rejected replay entries update caches before acceptance, or compact/restore facts drift.
- Non-blocking: broad RPC harness migration remains pending.

- [x] Add replay hydration regression tests for thread A high replaySeq plus thread B lower replaySeq.
- [x] Replace bare replay `handleNotification` calls with replay-owned processing.
- [x] Ensure replay hydration uses the scoped cursor path or bypasses live notification cursor as appropriate.
- [x] Ensure rejected entries do not advance per-thread runtime state before acceptance.
- [x] Prove replay hydration from thread B with replaySeq `1` / `2` still applies after live thread A replaySeq `100`.
- [x] Prove from-start replay is not suppressed by global live eventId dedupe.
- [x] Run targeted Web runtime tests for replay, processNotification, threadDataOps, and cursor.
- [x] Run `codex review` for this loop after targeted verification passes.
- [x] Commit this loop after review passes.

### Loop 3: Optional targeted Web RPC harness, only if Loop 2 requires an integration test
Review gate for this loop:
- Blocking: harness becomes a second protocol implementation, migrated tests lose assertions, or harness extraction expands across unrelated test families.
- Non-blocking: remaining duplicated RPC mocks in unrelated integration tests.

- [x] Decide whether unit/runtime tests already prove W1; if yes, move this loop to deferred without implementation.
- [x] Design the smallest `createRpcHarness` API for replay/cursor integration tests only if integration coverage is required.
- [x] Add a harness contract test only if a harness is introduced.
- [x] Migrate one replay-focused integration test or the smallest affected integration test to the harness only if needed.
- [x] Leave unrelated integration tests unchanged unless they are directly touched by this bug fix.
- [x] Run targeted migrated Web tests plus harness contract test if this optional loop is implemented.
- [x] Run `codex review` for this loop after targeted verification passes if this optional loop is implemented.
- [x] Commit this loop after review passes if this optional loop is implemented.

### Loop 4: Final convergence and documentation
Review gate for this loop:
- Blocking: Web cursor contract docs are stale, CODEMAP misses new harness path, package tests fail, or todo still has implementation ambiguity.
- Non-blocking: prepare-turn-context unification, ToolViewBlock migration, policy preflight split, package ownership migration.

- [x] Update `docs/contracts/web-parity-adapter-contract.md` if cursor scope semantics changed.
- [x] Update `packages/web-reference-react/CODEMAP.md` if a shared harness file was added.
- [x] Add/update `docs/learnings/` note for Web replay cursor scoping.
- [x] Run final targeted Web tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.
- [x] Commit this loop after review passes.

## 6. Deferred Follow-Up Candidates

- Broader Web RPC harness migration across composer, approval, diff, terminal, and App integration tests.
- Initial shared Web RPC harness extraction if W1 is fully proven by unit/runtime tests.
- Web local boundary gate for `app/core`, `app/runtime`, parity/adapters, and components.
- Broader `prepareTurnContextRequest` unification across REPL, app-server, and SDK.
- Cross-layer context/compact golden fixture matrix across REPL, app-server, SDK, diagnostics, and Web.
- Renderer-neutral `ToolViewBlock` / `ToolCallViewModel` migration.
- `policyPreflight.ts` decision/effect pipeline split.
- Public package ownership migration for `@formax/semantics` and `@formax/shared`.
