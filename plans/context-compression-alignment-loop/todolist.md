# App-Server / SDK Reactive Compact Parity Audit Todo

Date: 2026-05-31

Current execution entrypoint: this file only.

The previous post-`CCA-181` rolling todo is complete in Git history. This todo starts the next narrow mainline recommended by `TODO-INDEX.md`: audit whether app-server and SDK request paths need the same reactive compact fallback semantics that now exist in the TUI `sendMainTurn` path.

This is intentionally characterization-first. Do not assume app-server / SDK must implement reactive compact. First prove the current behavior, compare it to the canonical contracts, then choose either a minimal parity implementation slice or a documented non-goal.

## 0. Context and Boundary

### 0.1 Confirmed Facts

- [x] TUI `runMainSendTurn()` has a reactive compact fallback path for eligible context-overflow provider errors.
- [x] TUI reactive compact fallback currently preserves abort semantics before overflow classification.
- [x] TUI reactive compact fallback treats auth / rate-limit signals as non-eligible even when the message also contains overflow-like text.
- [x] TUI reactive compact fallback retries at most once; a retry overflow does not start another reactive compact loop.
- [x] TUI reactive compact retry uses reactive-prepared `history`, `requestHistory`, `requestUser`, and `cacheEditPlan`.
- [x] TUI pending request-collapse commit drainage is attempted before reactive full compact and persistence failure does not suppress the overflow retry.
- [x] `reactive_compact_applied` currently means fallback prepared / retry attempted, not retry succeeded.
- [x] `packages/core/src/app-server/turnRunner.ts` currently prepares request projection, calls `engine.runTurn()` once on the normal app-server path, then commits durable snip/collapse state only after a successful turn.
- [x] `packages/core/src/sdk/query/runner.ts` currently prepares request projection and calls `runtime.engine.runTurn()` inside the SDK query loop; the visible retry loop is for structured-output validation, not context-overflow reactive compact.
- [x] Current repository search finds TUI reactive classifier usage under `packages/core/src/features/repl/controller/send/`; app-server / SDK paths do not currently call `classifyReactiveCompactError()` or `runReactiveCompact()`.
- [x] Batch 1 characterization confirms app-server currently fail-fast on `HTTP 413` / context-overflow provider errors and calls `engine.runTurn()` once.
- [x] Batch 1 characterization confirms app-server interrupted turns keep `interrupted` status even when the abort error text is overflow-like.
- [x] Batch 1 characterization confirms app-server context-overflow failure does not commit durable collapse / snip state during the normal turn path.
- [x] Batch 1 characterization confirms SDK query currently fail-fast on `HTTP 413` / context-overflow provider errors and calls `runtime.engine.runTurn()` once.
- [x] Batch 1 characterization confirms SDK abort-like failures remain single-attempt `error_during_execution` results and do not enter any context-overflow retry path.
- [x] Batch 1 characterization confirms SDK structured-output retries remain separate from context-overflow failures; overflow returns `error_during_execution` after one `runTurn()` call rather than consuming output retry budget.
- [x] Batch 1 characterization confirms SDK context-overflow failure does not commit durable collapse / snip state during session persistence.
- [x] Full durable collapse store / archived spans remains deferred unless this audit finds a concrete blocker.

### 0.2 Goals

- [x] Characterize app-server normal turn behavior when `engine.runTurn()` rejects with eligible context-overflow errors.
- [x] Characterize SDK query behavior when `runtime.engine.runTurn()` rejects with eligible context-overflow errors.
- [ ] Decide whether app-server and SDK should share TUI's reactive compact fallback semantics, intentionally stay fail-fast, or expose a narrower opt-in behavior.
- [ ] If parity is required, select exactly one minimal implementation slice for app-server and/or SDK.
- [ ] Keep canonical request-time vs durable projection boundaries intact: request-only reducers must not become durable state by accident.
- [ ] Preserve current structured-output retry semantics in SDK; context-overflow fallback must not multiply with JSON/schema validation retries.
- [ ] Preserve app-server turn lifecycle semantics: pending inputs, notifications, session snapshots, durable commits, and failure status must remain coherent.
- [ ] Keep Web UI unchanged unless a server-owned surface change is explicitly selected.

### 0.3 Non-Goals

- [x] Do not implement full durable collapse store / archived spans in this todo.
- [x] Do not redesign provider cache editing.
- [x] Do not introduce Web-local inference for reactive compact facts.
- [x] Do not add `latestReactiveCompact` to `thread/resume`, `thread/read`, `thread/messages`, or `thread/replay` unless this audit selects a contract-backed server-owned surface.
- [x] Do not change `reactive_compact_applied` into a retry-success event unless characterization proves the current fallback-prepared semantics are misleading for a real consumer.
- [x] Do not merge TUI, app-server, and SDK send paths into one abstraction before tests prove the shared shape is stable.
- [x] Do not treat Claude Code internal helper order as the authority; Formax contracts remain the source of truth.

## 1. Definitions First

### 1.1 Canonical Docs

- [x] Re-read `docs/contracts/context-strategy-stack-contract.md` `CSS-305a`, `CSS-309b`, `CSS-310`, and `CSS-312`.
- [x] Re-read `docs/contracts/session-persistence-contract.md` `SES-304F`.
- [x] Re-read `docs/contracts/app-server-interaction-contract.md` turn lifecycle and `/context` diagnostics sections.
- [x] Re-read SDK query README / docs if a query-specific runtime contract exists; current SDK README links session/semantics contracts and has no SDK-specific reactive compact contract.
- [ ] Decide whether app-server / SDK reactive compact semantics belong in existing context/session contracts or need a small SDK/app-server contract note.
- [ ] Keep stable facts in canonical docs once selected; do not leave long-lived behavior only in this todo.

### 1.2 Data Model / Ownership

- [x] Identify the app-server owner for pending durable snip / collapse commits during a failed normal turn: `TurnRunner` owns pending durable commits and only flushes them after successful turn completion.
- [x] Identify the SDK owner for collapse store snapshot updates and session persistence during query execution: `packages/core/src/sdk/query/runner.ts` updates `collapseStoreSnapshot` and writes committed collapse events after successful `runtime.engine.runTurn()`.
- [ ] Decide whether app-server reactive compact can safely drain pending request-collapse commits before retry without making final turn status ambiguous.
- [ ] Decide whether SDK reactive compact can safely drain pending request-collapse commits before retry while preserving streaming result shape.
- [ ] Define whether a failed reactive retry should keep `reactive_compact_applied` semantics identical across TUI, app-server, and SDK.
- [ ] Define whether app-server / SDK should persist a `reactive_compact_applied` event at all if no diagnostics consumer exists.
- [ ] Confirm that failed drainage persistence must not suppress an otherwise eligible overflow retry.

### 1.3 Types / Interfaces

- [ ] Audit whether `ReactiveCompactErrorKind`, `classifyReactiveCompactError()`, and `isReactiveCompactEligibleError()` should move from TUI send code into a shared runtime module before app-server / SDK reuse.
- [ ] Audit whether `createContextCompressionService().runReactiveCompact()` is reusable outside TUI or whether app-server / SDK need a smaller shared helper.
- [ ] Audit whether app-server `TurnRunner` can reuse `createContextCompressionService()` without importing TUI-only dependencies.
- [ ] Audit whether SDK query runner can reuse `createContextCompressionService()` or should share lower-level compact preparation helpers.
- [ ] Decide the minimal event/callback interface for recording reactive compact and drained collapse commits outside TUI.

## 2. Runtime / Platform

### 2.1 App-Server TurnRunner Characterization

- [x] Add/verify app-server test: eligible provider overflow currently fails or retries; current behavior is fail-fast with exactly one `engine.runTurn()` call.
- [x] Add/verify app-server test: abort/interrupted turn remains interrupted even if error text is overflow-like.
- [x] Add/verify app-server test: auth / rate-limit with overflow-like text is non-eligible; current behavior is fail-fast with exactly one `engine.runTurn()` call.
- [x] Add/verify app-server test: if request-time collapse produces a commit candidate and the provider overflows, current code either loses it or preserves it; current behavior writes no durable collapse / snip commit on failed turn.
- [x] Add/verify app-server test: failed normal turn does not commit durable snip / collapse state unless explicitly drained by selected behavior.
- [ ] Add/verify app-server test: if a reactive retry is selected later, it must not run a second reactive compact after retry overflow.
- [ ] Add/verify app-server test: retry must use recomputed reactive `requestHistory`, `requestUser`, and `cacheEditPlan`.
- [ ] Add/verify app-server test: pending input cleanup, turn status, error notifications, and writer flush behavior stay coherent after failed compact / failed retry.

### 2.2 SDK Query Runner Characterization

- [x] Add/verify SDK test: eligible provider overflow currently fails or retries; current behavior is fail-fast with exactly one `runtime.engine.runTurn()` call and `error_during_execution`.
- [x] Add/verify SDK test: abort-like errors keep abort semantics before overflow classification.
- [x] Add/verify SDK test: auth / rate-limit with overflow-like text is non-eligible; current behavior is fail-fast with exactly one `runtime.engine.runTurn()` call.
- [x] Add/verify SDK test: structured-output validation retries remain separate from context-overflow reactive compact.
- [x] Add/verify SDK test: if context-overflow fallback is selected later, the fallback must not multiply with `outputMaxRetries` into unbounded attempts; current overflow fails before structured-output retry.
- [ ] Add/verify SDK test: retry must use recomputed reactive `requestHistory`, `requestUser`, and `cacheEditPlan`.
- [x] Add/verify SDK test: session persistence collapse commits are only written when the selected lifecycle permits it; current overflow failure writes no durable collapse / snip commit.
- [ ] Add/verify SDK test: streamed result / error message shape remains compatible with existing SDK callers.

### 2.3 Shared Runtime Shape

- [ ] Decide whether to extract a shared reactive overflow classifier module.
- [ ] Decide whether to extract shared "reactive compact preparation" around `runCompactFlow` / session memory fallback.
- [ ] Decide whether pending collapse drainage should be a shared helper or host-owned callback.
- [ ] Keep app-server / SDK host lifecycle code host-owned unless duplication becomes risky.
- [ ] Avoid importing React/TUI/controller-only modules into app-server or SDK layers.

## 3. Frontend / Surface Boundary

- [ ] Confirm no Web UI change is needed for pure request-path parity.
- [ ] Confirm app-server thread surfaces should not expose `latestReactiveCompact` unless a concrete consumer is selected.
- [ ] If app-server persists `reactive_compact_applied`, decide whether `/context` diagnostics is sufficient.
- [ ] If a server-owned `latestReactiveCompact` surface is selected, update app-server/Web parser/cache tests before UI display changes.
- [ ] Ensure Web does not infer reactive compact state from transcript rows, error text, compact boundary rows, or local retry behavior.

## 4. Tests

### 4.1 Existing Tests To Extend

- [x] `packages/core/src/app-server/turnRunner.test.ts`: app-server overflow classification, retry/no-retry behavior, status/notification/persistence cleanup.
- [x] `packages/core/src/sdk/query.options-alignment.test.ts` or adjacent SDK query tests: SDK overflow classification, retry/no-retry behavior, output retry separation.
- [ ] `packages/core/src/features/repl/controller/send/reactiveCompact.test.ts`: move or preserve classifier coverage if the classifier module is extracted.
- [ ] `packages/core/src/features/repl/controller/send/sendMainTurn.test.ts`: keep existing TUI behavior green after any shared extraction.
- [ ] `packages/core/src/features/repl/sessionSave/reactiveCompactEvents.test.ts`: keep latest-valid event semantics green if app-server / SDK persist the same event.

### 4.2 Verification Commands

- [ ] Run targeted app-server tests selected by the implementation slice.
- [ ] Run targeted SDK query tests selected by the implementation slice.
- [ ] Run targeted TUI reactive compact tests if any shared code moves.
- [x] Run `bun run type-check`.
- [ ] Run `codex review` for each implementation loop after targeted verification passes.

## 5. Recommended Execution Order

### Batch 1: Characterize Current App-Server / SDK Behavior

- [x] Audit app-server `TurnRunner` normal request path, durable commit timing, and failure cleanup.
- [x] Audit SDK `query/runner` request path, output validation retry loop, session persistence, and collapse commit timing.
- [x] Add app-server characterization tests for eligible overflow, abort precedence, auth/rate-limit non-eligibility, failed turn persistence, and current collapse commit behavior.
- [x] Add SDK characterization tests for eligible overflow, abort precedence, auth/rate-limit non-eligibility, structured-output retry separation, and current collapse commit behavior.
- [x] Update this todo with the exact observed behavior and selected Batch 2 direction: app-server and SDK currently fail-fast; Batch 2 should decide whether to keep fail-fast or add parity.
- [x] Run targeted characterization tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(context): characterize reactive compact host paths`

### Batch 2: Minimal Parity Decision

- [ ] If app-server / SDK intentionally stay fail-fast, update contracts and learning note with the reason, then skip implementation batches.
- [ ] If app-server parity is required, select one minimal app-server slice: eligible overflow -> reactive compact -> one retry, with drainage attempt isolation.
- [ ] If SDK parity is required, select one minimal SDK slice: eligible overflow -> reactive compact -> one retry, without multiplying structured-output retries.
- [ ] Decide whether classifier extraction is necessary for the selected slice.
- [ ] Decide whether reactive compact preparation helper extraction is necessary for the selected slice.
- [ ] Update canonical contracts before behavior changes.
- [ ] Run targeted decision-support tests.
- [ ] Run `bun run type-check`.
- [ ] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `docs(context): choose reactive compact host parity`

### Batch 3: App-Server Minimal Implementation Slice

- [ ] Implement only if Batch 2 selects app-server parity.
- [ ] Keep turn lifecycle status, pending input cleanup, writer flush behavior, and durable commit timing coherent.
- [ ] Attempt pending collapse drainage before reactive retry if a valid commit candidate exists; isolate drainage persistence failure from overflow recovery.
- [ ] Retry at most once and use reactive-prepared request projection/cacheEditPlan.
- [ ] Add targeted app-server regression tests.
- [ ] Run targeted app-server tests.
- [ ] Run `bun run type-check`.
- [ ] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `fix(app-server): align reactive compact retry`

### Batch 4: SDK Minimal Implementation Slice

- [ ] Implement only if Batch 2 selects SDK parity.
- [ ] Keep structured-output retry accounting separate from context-overflow fallback.
- [ ] Retry at most once and use reactive-prepared request projection/cacheEditPlan.
- [ ] Preserve SDK result/error stream compatibility.
- [ ] Add targeted SDK regression tests.
- [ ] Run targeted SDK tests.
- [ ] Run `bun run type-check`.
- [ ] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `fix(sdk): align reactive compact retry`

### Batch 5: Closure / Next Routing

- [ ] Update `plans/context-compression-alignment-loop/TODO-INDEX.md`.
- [ ] Promote stable facts from this todo into canonical docs.
- [ ] Add/update learning note with final host parity decision.
- [ ] Decide whether remaining follow-up is app-server only, SDK only, shared runtime extraction, or no further context-compression work.
- [ ] Run docs/path checks through `bun run type-check`.
- [ ] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `docs(context): close reactive compact host audit`

## 6. Deferral Register

- [ ] Full durable collapse store / archived spans: defer unless app-server / SDK parity proves current committed collapse snapshot is insufficient.
- [ ] `latestReactiveCompact` thread surfaces: defer unless a real app-server/Web consumer is selected.
- [ ] `reactive_compact_applied` outcome schema: defer unless characterization proves fallback-prepared semantics are misleading.
- [ ] Shared send-path mega-refactor: defer until app-server / SDK tests prove a stable common abstraction.
- [ ] Broad cache-edit redesign: defer; only assert retry uses recomputed reactive cacheEditPlan if parity is selected.
- [ ] Web UI for reactive compact: defer; server-owned facts first.

## 7. Completion Criteria

- [x] App-server current overflow behavior is characterized with targeted tests.
- [x] SDK current overflow behavior is characterized with targeted tests.
- [ ] A clear parity decision exists for app-server and SDK: implement, intentionally fail-fast, or defer with reason.
- [ ] Any selected implementation retries at most once and preserves abort/auth/rate-limit boundaries.
- [ ] Any selected implementation recomputes request projection/cacheEditPlan for retry.
- [ ] Any selected implementation keeps durable state persistence explicit and does not persist request-only reducers accidentally.
- [ ] Contracts and learning notes reflect the final decision.
- [ ] TODO-INDEX points to the next real follow-up or says to pause the context-compression mainline.
