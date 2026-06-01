# Thread Runtime Preferences Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] TUI `/model <tier>` currently writes global `llm.defaultTier`; this task must preserve that behavior.
- [x] TUI `/config thinkingMode` currently writes global boolean `llm.thinkingMode`; this task must preserve that behavior.
- [x] Web `ComposerDock` currently owns model tier and reasoning choice in component-local state, so the selections are cosmetic and do not affect app-server execution.
- [x] Current app-server `turn/start` and `command/dispatch` payloads carry thread/action data but do not carry model tier or thinking preferences.
- [x] Current backend thinking semantics are boolean `thinkingMode`; there is no durable `low | medium | high | max` reasoning-effort contract.
- [x] Existing thread-scoped `mode` behavior establishes the main precedent: shared `ThreadRuntimeState`, app-server notifications, replay snapshot hydration, and Web mirror cache.
- [x] Cross-process recoverable thread state must be durable in the JSONL session file, not Web local state, sidecar memory, or process-only maps.
- [x] Runtime execution must use a frozen `RuntimeModelProfile` per turn, including model identity, context-window facts, thinking mode, and fingerprint.

### 0.2 Goals
- [ ] Make active-thread model tier and thinking mode thread-scoped, durable, and replay/resume-safe.
- [ ] Make no-active-thread and new-thread-draft model/thinking changes update global defaults, matching current TUI global semantics.
- [ ] Ensure future `turn/start` and turn-dispatch commands resolve their effective runtime profile from app-server-owned thread state plus global config.
- [ ] Make Web composer controls controlled by server/replay state, not component-local durable state.
- [ ] Collapse Web reasoning UI to boolean thinking semantics unless and until a real effort-level backend contract exists.
- [ ] Establish a reusable thread-bound runtime-state pattern for future per-thread data.

### 0.3 Non-goals
- [x] Do not silently change existing TUI `/model` or `/config thinkingMode` commands from global to thread-scoped.
- [x] Do not add authoritative `modelTier` or `thinkingMode` fields to every `turn/start` or `command/dispatch` request in v1.
- [x] Do not persist concrete provider model strings as thread preferences; persist user-level tier and boolean thinking only.
- [x] Do not introduce four-level reasoning effort semantics without a separate provider/request contract.
- [x] Do not store thread preferences in Web local storage or sidecar memory as the durable authority.
- [x] Do not create transcript rows for preference changes; they are runtime side state.
- [x] Do not override provider, auth, base URL, tier model maps, context-window env overrides, or tier model env vars with thread preferences.

### 0.4 Current suspected hot spots
- [x] `packages/core/src/features/semantics/runtime/threadRuntimeState.ts` owns shared thread runtime state.
- [x] `packages/core/src/app-server/replayStateSnapshot.ts` owns replay state snapshots consumed by Web.
- [x] `packages/core/src/features/repl/sessionSave/*` and related app-server session helpers own JSONL read/write semantics.
- [x] `packages/core/src/app-server/protocol.ts` owns JSON-RPC params parsing and validation.
- [x] `packages/core/src/app-server/server.ts` / `packages/core/src/app-server/index.ts` own app-server handlers, runner resolution, and notification wiring.
- [x] `packages/core/src/config/modelTier.ts` and runtime model profile helpers own model-tier resolution.
- [x] `packages/core/src/app-server/turnRunner.ts` owns frozen per-turn runtime execution.
- [x] `packages/web-reference-react/src/components/composer/ComposerDock.tsx` owns current Web composer controls.
- [x] `packages/web-reference-react/src/app/runtime/replayThreadEvents.ts` and runtime cache code own Web replay hydration.

### 0.5 Spec lock and review-churn prevention
- [x] Spec lock is required because this feature crosses shared semantics, session persistence, app-server protocol, runtime profile resolution, runner cache behavior, and Web UI state.
- [x] Review findings are evidence, not direct edit commands; every finding must be classified before code changes.
- [x] Current-loop review should be scoped by the loop contract, not final-feature completeness.
- [x] Later-loop findings must be logged and linked to a future loop instead of forcing current-loop churn.
- [x] Spec ambiguity must stop implementation and update contracts/todo before code changes.
- [x] Findings that conflict with accepted contracts or confirmed user decisions should be recorded as not adopted, with a regression test if the issue recurs.
- [x] Review churn trigger: after 2 review rounds in one loop with new semantic P1/P2 findings, or any contradictory findings in the same semantic cluster, stop code edits and run a convergence pass.
- [x] Review findings log for this feature: `docs/thread-runtime-preferences-review-findings-log.md`.
- [x] Protocol/runtime boundary changes discovered during review must update contracts/todo before code changes, especially if they move authority between thread state, request payloads, Web local state, TUI globals, JSONL, or runtime profiles.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Update `docs/contracts/semantics-contract.md` to define thread runtime preferences as shared runtime side state.
- [x] Update `docs/contracts/session-persistence-contract.md` to define the JSONL event schema, latest-valid-wins replay, malformed-event handling, and old-session fallback.
- [x] Update `docs/contracts/app-server-interaction-contract.md` to define preference patch/read APIs, notification shape, replay/read/resume fields, and the non-transcript rule.
- [x] Update `docs/contracts/model-settings-contract.md` to define thread override precedence before global `llm.defaultTier` / `llm.thinkingMode` for thread-bound execution.
- [x] Update `docs/contracts/config-settings-contract.md` to clarify that TUI `/model` and `/config thinkingMode` remain global defaults.
- [x] Update `docs/contracts/web-parity-adapter-contract.md` to state Web preference state is a server/replay mirror, not canonical Web state.
- [x] Update `docs/references/app-server-api-reference.md` with the new RPC methods, notifications, response fields, and runtime-defaults read surface.
- [x] Update `docs/frontend/app-server-ui-spec.md` if Web visible-surface preference routing or composer control behavior needs UI-spec coverage; otherwise explicitly record why Web parity contract is sufficient.
- [x] Add a short learning note under `docs/learnings/` describing the reusable thread runtime-state facet pattern.
- [x] Update `CODEMAP.md` only if new cross-cutting helpers or ownership entrypoints are added.

### 1.2 Semantic model
- [x] Add `ThreadRuntimePreferences` as a facet of `ThreadRuntimeState`.
- [x] Decide and freeze the reduced-state representation: prefer absent fields / `{}` as “inherit global”; use `null` only in patch APIs to clear an override.
- [x] Ensure reduced `state.preferences` omits cleared fields; `null` must appear only in patch/event raw input, not in read/resume/replay reduced state.
- [x] Define effective model tier as `thread.preferences.modelTier ?? runtimeConfig.llm.defaultTier ?? 'sonnet'`.
- [x] Define effective thinking mode as `thread.preferences.thinkingMode ?? runtimeConfig.llm.thinkingMode`.
- [x] Define preference changes as runtime side state, not transcript projection and not canonical message events.
- [x] Define that preference changes during an active turn affect future turns only.
- [x] Define old sessions with no preference events as no override, inheriting current effective global/project/env config.

### 1.3 Protocol names and shapes
- [x] Freeze thread update method name; recommended: `thread/runtimeState/patch`.
- [x] Define `thread/runtimeState/patch` as generic by method name only; v1 accepts only the `preferences` facet.
- [x] Reject unknown runtime-state facets in live protocol parsers until each facet has a contract, reducer, JSONL schema, replay/read/resume surface, and tests.
- [x] Explicitly state that `mode`, active turn state, pending inputs, sticky tool names, replay cursor state, and transcript projection are not patchable through `thread/runtimeState/patch` in v1.
- [x] Freeze global runtime defaults method names; recommended: `config/runtimeDefaults/read` and `config/runtimeDefaults/patch`.
- [x] Add `thread/runtimeState/read` as a thin helper-backed read surface only if Web or recovery paths need a direct runtime-state rehydrate; active threads should still hydrate from `thread/read`, `thread/resume`, and `thread/replay`.
- [x] `config/runtimeDefaults/read` or an equivalent initialize/bootstrap surface is required for no-active-thread/new-thread-draft controls; Web must not hardcode global model/thinking defaults after initialization.
- [x] Define `ThreadRuntimeStatePatch` with `preferences.modelTier?: ModelTier | null` and `preferences.thinkingMode?: boolean | null`.
- [x] Define global runtime defaults patch with concrete `modelTier?: ModelTier` and `thinkingMode?: boolean`; no `null` clears for global defaults.
- [x] Define global runtime defaults read/patch response with saved defaults, effective values/profile summary, and capability metadata; saved global values may differ from effective values because of project/env/flag precedence.
- [x] Define thread patch response state summary in Loop 2; include effective profile summary only after the shared effective-profile resolver exists.
- [x] Define strict parser behavior: reject invalid tiers, non-boolean thinking values, unknown preference keys, and misleading effort strings.
- [x] Define empty patch behavior; prefer no-op return for idempotency if it does not complicate parser semantics.
- [x] Keep `opId` optional in v1; echo it when present, allow best-effort duplicate diagnostics/dedupe, but do not rely on `opId` for correctness.

### 1.4 JSONL event model
- [x] Freeze durable event name; recommended: `thread_runtime_state_patch`.
- [x] Define event schema version `1`.
- [x] Include `threadId`, optional `opId`, source, patch, timestamp/revision metadata as needed.
- [x] Define latest valid event wins by JSONL order.
- [x] Define malformed events as ignored without clearing prior valid state.
- [x] Define `null` inside a patch as clearing only that thread override.
- [x] Ensure preference event replay feeds `ThreadRuntimeState`, not transcript projection.
- [x] Define live protocol parsing as strict and JSONL replay parsing as tolerant: live requests reject invalid/unknown fields, while replay ignores malformed records or fields without clearing prior valid state.
- [x] Unknown `schemaVersion`, missing/invalid `threadId`, absent/non-object patch, or threadId mismatch must not corrupt existing reduced state.
- [x] Unknown future facets are rejected live in v1 and ignored during replay unless/until their schema is registered.

### 1.5 Effective runtime profile
- [x] Define a shared helper for resolving an effective `RuntimeModelProfile` from base runtime config plus thread preferences.
- [x] Ensure model tier override recomputes concrete model using existing tier resolution priority.
- [x] Ensure context-window source/binding are recomputed against the effective tier and concrete model.
- [x] Ensure thinking override participates in the runtime profile fingerprint.
- [x] Ensure runner cache keys use the effective profile fingerprint, not the global config profile.
- [x] Ensure `/context` diagnostics report the same effective profile that the next thread turn would use.
- [x] Ensure the same frozen effective profile snapshot feeds runner cache keying, `TurnRunner` construction/start, `RunningTurn.runtimeProfile`, prompt budget, context meter budget, cache-editing provider decisions, and diagnostics.
- [x] Ensure every thread-bound provider-request materialization path uses the shared effective profile helper, not only `turn/start`.

### 1.6 Semantic decision table
| Decision | Accepted rule | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|
| Active-thread preference ownership | Thread-scoped runtime state, durable through JSONL and reduced into shared `ThreadRuntimeState`. | Web local state, sidecar memory authority, or per-request ad hoc authority. | semantics, session persistence, app-server interaction | JSONL -> replay -> Web cache parity; active-thread patch persists. |
| No-thread / draft behavior | Update global defaults, matching current TUI global semantics. | Creating a fake thread or draft-local durable preference in v1. | config settings, app-server interaction, Web parity | Draft/no-thread patch writes global config, not thread JSONL. |
| Thinking semantics | Boolean `thinkingMode` only in v1. | `low | medium | high | max` backend-facing semantics. | model settings, config settings, Web parity | Parser rejects effort strings; Web removes four-effort UI. |
| Turn request authority | `turn/start` and `command/dispatch` remain narrow; app-server resolves from `threadId`. | Sending model/thinking as canonical request-local fields in v1. | app-server interaction, model settings | Web payload tests prove no ad hoc authority fields. |
| Effective profile timing | Resolve and freeze `RuntimeModelProfile` at turn admission; mid-turn updates apply next turn. | Mutating an in-flight turn or relying on global profile after thread override. | model settings, app-server interaction | Mid-turn update test; runner cache fingerprint tests. |
| TUI behavior | Existing `/model` and `/config thinkingMode` remain global. | Silently making existing TUI commands thread-scoped. | config settings, model settings | TUI regression tests for global writes. |
| Generic patch boundary | `thread/runtimeState/patch` is a closed v1 preferences-facet API. | Arbitrary partial writes to `ThreadRuntimeState`. | app-server interaction, semantics | Parser rejects unknown facets and protected runtime state fields. |
| Draft/no-thread write target | Use explicit visible surface / preference target, not raw `!activeThreadId`. | Inferring semantics only from missing active thread. | Web parity, app-server interaction | Tests cover thread, draft, welcome/no-thread, and locked/unsupported surfaces. |
| Send sequencing | Web awaits confirmed preference persistence before starting a turn/dispatch with the displayed profile. | Sending while controls show uncommitted optimistic state. | Web parity, app-server interaction | Pending update barrier tests and failure rehydrate/blocking tests. |

### 1.7 Review finding triage policy
- [x] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [x] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, update `docs/thread-runtime-preferences-review-findings-log.md` and ensure the future loop has an acceptance item.
- [x] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test if needed.
- [x] Re-run review only after triage is documented and targeted tests pass.
- [x] Every finding must include loop mapping, contract mapping, touched invariant, classification, action, and test/deferred-loop mapping before implementation.
- [x] If a finding proposes changing method names, payload authority, JSONL schema, runtime-profile fingerprint inputs, durable authority, or transcript-vs-runtime-state ownership after Loop 1 lock, stop implementation and run a convergence pass.

## 2. Runtime / Platform

### 2.1 Shared semantics state
- [x] Extend `ThreadRuntimeState` with `preferences`.
- [x] Seed initial thread runtime state with no preferences.
- [x] Add reducer support for the selected live notification, such as `thread/runtimeStateChanged`.
- [x] Preserve existing `mode`, active turn, pending input, sticky tool-name, and replay sequencing behavior.
- [x] Add stale/replay-order tests so older runtime-state notifications cannot overwrite newer preference state.
- [x] Ensure preference notifications do not enter canonical transcript projection.

### 2.2 Replay snapshots and read/resume surfaces
- [x] Add `preferences` to `ReplayStateSnapshot`.
- [x] Update `buildReplayStateSnapshot` to copy preferences from runtime state.
- [ ] Expose the same preference state on `thread/read` and `thread/resume` as additive optional fields.
- [ ] Use one app-server helper to compute preference state for replay/read/resume instead of scanning JSONL in multiple places.
- [ ] Ensure replay hydration and live notifications reduce to equivalent Web runtime state.

### 2.3 Session persistence
- [ ] Add a typed JSONL event parser/reducer for thread runtime preference patches.
- [ ] Add tests for old sessions with no events returning no override.
- [ ] Add tests for latest valid event wins.
- [ ] Add tests for malformed event data not clearing prior valid preferences.
- [ ] Add tests for unknown schema versions, unknown future facets, invalid field types, and threadId mismatch not corrupting prior valid reduced state.
- [ ] Add tests for clear patches falling back to global config.
- [ ] Add tests proving clear patches reduce to omitted fields, not persisted `null` fields.
- [ ] Ensure `thread/runtimeState/patch` materializes provisional thread session files before reporting success.

### 2.4 App-server protocol and handlers
- [ ] Add protocol parser tests for valid model tiers and boolean thinking mode.
- [ ] Add parser rejection tests for invalid tiers, `low | medium | high | max`, non-boolean thinking values, unknown keys, and invalid patch shapes.
- [ ] Add parser rejection tests for unknown runtime-state facets and attempts to patch protected runtime-state fields such as `mode`, active turn, pending inputs, sticky tool names, replay cursor, or transcript projection.
- [ ] Implement thread preference patch handler: validate, ensure thread file, append JSONL event, update runtime state, emit sequenced notification, return state and effective summary.
- [ ] Implement global runtime defaults read handler for no-active-thread/new-thread-draft initialization.
- [ ] Implement global runtime defaults patch handler: reuse existing global `/model` and `thinkingMode` persistence paths, return saved and effective values.
- [ ] Add optional read handlers if selected in definitions.
- [ ] Add capability metadata if Web needs feature detection for old/new app-server compatibility.
- [ ] Ensure thread patch/update responses do not claim a runtime profile fingerprint unless the shared effective-profile resolver is used.

### 2.5 Runtime profile and runner cache
- [ ] Add or extend model profile resolver to accept thread preference overrides before profile construction.
- [ ] Recompute concrete model from effective tier rather than mutating `cfg.llm.defaultTier` after config load.
- [ ] Recompute context-window source/binding from the effective tier/model.
- [ ] Compute runner cache keys only after applying thread preferences to the effective runtime profile.
- [ ] Ensure `TurnRunner` constructor/runtime config and `startTurn` running profile cannot diverge from the effective profile used for cache keying.
- [ ] Route `turn/start` through the effective thread profile resolver.
- [ ] Route turn-dispatch commands such as `/init` and `/compact` through the same resolver.
- [ ] Route every command-dispatch path that materializes a model/provider request through the same resolver; current required fixtures are `/init` and `/compact`.
- [ ] Route `/context` diagnostics through the same resolver.
- [ ] Make `TurnRunner` construction/start use the same frozen effective `RuntimeModelProfile` used for the cache key.
- [ ] Preserve plan-path adoption behavior when runner profile changes and a new cached runner is selected.
- [ ] Ensure preference changes during an in-flight turn do not mutate that running turn's frozen profile.
- [ ] Ensure `/context` diagnostics, thread patch effective summaries, and the next `turn/start` agree on the runtime profile fingerprint once effective profile summaries are enabled.

### 2.6 TUI preservation
- [ ] Add regression tests proving `/model <tier>` still writes global `llm.defaultTier`.
- [ ] Add regression tests proving `/config thinkingMode` still writes global boolean `llm.thinkingMode`.
- [ ] Do not add thread-scoped TUI commands in this task.
- [ ] Document a future follow-up if thread-scoped TUI commands are desired later.

## 3. Frontend Boundary

### 3.1 Web runtime state
- [ ] Extend Web RPC contracts/parsers for preference fields in replay/read/resume responses.
- [ ] Extend `replayThreadEvents` hydration so `runtimeStateByThreadRef.current[threadId].preferences` mirrors server state.
- [ ] Add or generalize a cache hook from `useThreadModeCache` to handle full thread runtime state preferences.
- [ ] Ensure thread switching renders controls from the selected thread's preferences plus global fallback, not from the previous thread's local UI state.
- [ ] Ensure replay/read/resume hydration updates composer controls.
- [ ] Ensure Web optimistic updates, if any, are reconciled from server notification/response.
- [ ] Omitted `preferences` from old/unsupported responses must not clear existing cache; explicit supported `{}` means no thread overrides.
- [ ] Reduced Web runtime state must not store `null` preference fields.
- [ ] Display values should be derived from `threadOverride ?? globalRuntimeDefaults`; do not copy global defaults into thread preferences just to render inherited values.

### 3.2 ComposerDock controls
- [ ] Make `ComposerDock` controlled for model tier and thinking mode.
- [ ] Remove `selectedModelTier` component-local durable state.
- [ ] Remove `selectedReasoningEffort` component-local durable state.
- [ ] Replace four reasoning effort options with a boolean thinking control.
- [ ] Keep existing token-design menu styling and focus behavior from the previous compose-dock work.
- [ ] Surface thread/global source only if there is an agreed product need; do not add explanatory UI text by default.

### 3.3 Web update behavior
- [ ] Add a single `resolvePreferenceWriteTarget(visibleSurface, activeThreadId)` helper that returns explicit targets such as `thread`, `draft`, `noThread`, or unsupported/locked.
- [ ] Do not route preference writes by raw `!activeThreadId` alone.
- [ ] Active-thread model tier changes call the thread runtime-state patch API.
- [ ] Active-thread thinking changes call the thread runtime-state patch API.
- [ ] New-thread draft / no-active-thread model tier changes call the global defaults patch API.
- [ ] New-thread draft / no-active-thread thinking changes call the global defaults patch API.
- [ ] Maintain a per-target pending preference mutation barrier; send/start/dispatch must await the patch response, not only optimistic local state or notification.
- [ ] If a preference patch fails, send must be blocked or must rehydrate/revert to the previously confirmed server profile before sending.
- [ ] Ensure no ad hoc `modelTier` or `thinkingMode` fields are sent in `turn/start` / `command/dispatch` as authority.
- [ ] Handle update failures by reverting or rehydrating from server state without leaving controls lying about the active profile.

## 4. Tests

### 4.1 Core semantics tests
- [x] Initial `ThreadRuntimeState` has no preferences.
- [x] Preference update sets model tier.
- [x] Preference update sets thinking mode.
- [x] `null` patch clears each override independently.
- [x] Stale replay/runtime notifications do not overwrite newer preference state.
- [x] Existing mode/input/tool-name reducer behavior remains unchanged.
- [x] Preference events do not create transcript rows.

### 4.2 Session tests
- [ ] JSONL replay reconstructs latest preferences.
- [ ] Existing sessions with no event produce no override.
- [ ] Malformed tier/thinking fields are ignored.
- [ ] Unknown schema versions, unknown future facets, invalid event shape, and threadId mismatch do not corrupt reduced state.
- [ ] Clear patch removes override and effective value falls back to global config.
- [ ] Clear patch reduces to missing property, not `property: null`.
- [ ] Provisional thread preference update materializes a durable session file.

### 4.3 Protocol and app-server tests
- [ ] Parser accepts `haiku | sonnet | opus`.
- [ ] Parser rejects invalid model tiers.
- [ ] Parser accepts boolean `thinkingMode`.
- [ ] Parser rejects effort strings and non-boolean thinking values.
- [ ] Parser rejects unknown runtime-state facets and protected runtime-state field patches.
- [ ] Thread patch persists JSONL and emits sequenced runtime-state notification.
- [ ] Thread patch updates thread state without mutating global config.
- [ ] Global runtime defaults read initializes no-thread/draft model and thinking controls without Web hardcoded defaults.
- [ ] Global runtime defaults patch writes global config without writing thread JSONL.
- [ ] `thread/read`, `thread/resume`, and `thread/replay` expose consistent preferences from one helper.
- [ ] Patch response effective summary, `/context` diagnostics, and next `turn/start` use the same runtime profile fingerprint once effective summaries are enabled.

### 4.4 Runtime profile and execution tests
- [ ] Thread model tier override changes active tier and concrete provider model for `turn/start`.
- [ ] Thread model tier override recomputes context-window source/binding.
- [ ] Thread thinking override changes effective `thinkingMode` and runtime profile fingerprint.
- [ ] Field-independent fallback: overriding only `modelTier` still inherits global thinking, and overriding only `thinkingMode` still inherits global model tier.
- [ ] Clearing one override does not clear the other override.
- [ ] No thread override falls back to global config.
- [ ] Global default changes do not affect a thread with an explicit override for that field.
- [ ] Thread tier override selects the tier while concrete model and context-window rules still respect tier env/project/config bindings.
- [ ] `/init` and `/compact` dispatch use the same effective profile path as `turn/start`.
- [ ] `/context` diagnostics report the same effective model/thinking/fingerprint as the next turn.
- [ ] Two threads with different effective tier/thinking do not reuse an incompatible runner.
- [ ] Same cwd and same global config with different thread overrides cannot reuse the wrong runner.
- [ ] Updating preferences mid-turn affects only subsequent turns.

### 4.5 Web tests
- [ ] `ComposerDock` receives model tier and thinking mode through props.
- [ ] Active-thread selector changes call the thread runtime-state patch API.
- [ ] Draft/no-thread selector changes call the global defaults patch API.
- [ ] Preference write target is derived from explicit visible surface / target helper, not only from falsy `activeThreadId`.
- [ ] No-thread/draft initialization reads global runtime defaults or uses an equivalent bootstrap surface before rendering committed control values.
- [ ] Failed defaults/preference read does not fall back to durable Web local state.
- [ ] Draft global patch does not create or mutate `runtimeStateByThreadRef`.
- [ ] Thread switching restores each thread's preferences.
- [ ] Replay hydration restores composer model/thinking controls.
- [ ] Send waits for pending preference update or otherwise cannot race ahead of the durable update.
- [ ] Failed pending preference update blocks send or rehydrates/reverts before send.
- [ ] `turn/start` and `command/dispatch` Web payloads do not carry model/thinking as request-local authority.
- [ ] Four-level reasoning effort labels are removed or disabled behind a real capability contract.

### 4.6 Contract and parity tests
- [ ] JSONL preference event -> app-server replay state -> Web parser -> Web runtime cache parity test.
- [ ] Live preference notification -> Web runtime cache parity test.
- [ ] Stale preference notification is ignored.
- [ ] Preference notifications do not touch transcript projection.
- [ ] Old clients can ignore additive fields without breaking app-server execution semantics.
- [ ] Omitted old-client preference fields do not clear existing Web cache; explicit `{}` from a supporting server means no overrides.

## 5. Recommended Execution Order

### Loop 1: Contracts and semantic state
#### Loop Contract
- Purpose: lock canonical semantics and add the first shared runtime-state facet without making persistence, execution, or Web UI authoritative yet.
- In scope: contract updates, `ThreadRuntimePreferences` type/reducer, replay snapshot type alignment if needed, reducer tests.
- Out of scope: JSONL write/read handlers, app-server patch APIs, runner cache changes, Web composer wiring.
- Blocking findings: missing/incorrect canonical ownership, generic patch lane not closed to the `preferences` facet in v1, thinking still modeled as four-level backend semantics, TUI global semantics contradicted, reducer can create transcript projection, stale runtime events can overwrite current state.
- Non-blocking / later-loop findings: app-server persistence gaps belong to Loop 2; effective runtime profile/runner cache gaps belong to Loop 3; Web controlled UI gaps belong to Loop 4.
- Review prompt scope: review only Loop 1 against accepted contracts and this loop contract; classify persistence/execution/Web findings as later-loop unless this loop creates an incompatible contract.

Review gate for this loop:
- Blocking: thread preferences are not defined as shared runtime side state, thinking semantics remain four-level, or docs imply TUI global behavior changes.
- Non-blocking: Web UI still cosmetic until later loops.

- [x] Update canonical docs for semantics, session persistence, app-server interaction, model settings, config settings, and Web parity.
- [x] Update app-server API reference and frontend UI spec if the new method/visible-surface semantics require them.
- [x] Add `ThreadRuntimePreferences` and reducer support in shared semantics.
- [x] Add core reducer tests for set/clear/stale/no-transcript behavior.
- [x] Add replay snapshot type changes if needed for compile-time alignment.
- [x] Run targeted semantics/replay snapshot tests.
- [x] Triage review findings into `docs/thread-runtime-preferences-review-findings-log.md`.
- [x] Run `codex review` for this loop after targeted verification passes; stopped further Loop 1 reruns by the churn trigger after seven classified rounds.
- [x] Commit this loop after review passes.

### Loop 2: JSONL durability and app-server patch APIs
#### Loop Contract
- Purpose: make thread preference changes durable and observable through app-server protocol/replay surfaces, and introduce the pure effective-profile helper needed for API summaries without yet changing turn execution.
- In scope: JSONL event parser/reducer, thread patch handler, global runtime defaults read/patch handlers, replay/read/resume exposure, sequenced non-transcript notification, pure effective runtime profile helper.
- Out of scope: `TurnRunner` effective profile execution, runner cache invalidation, Web composer controls.
- Blocking findings: durable authority is not JSONL, malformed events clear valid state, provisional thread patch can return before durable materialization, live parser accepts unknown facets/protected runtime fields, global runtime defaults write thread JSONL, thread patch mutates global config, notification enters transcript projection, API response claims fingerprint without using the shared resolver.
- Non-blocking / later-loop findings: turn execution still using global profile belongs to Loop 3; Web controls still local belong to Loop 4.
- Review prompt scope: review only persistence/protocol/server-state semantics for this loop; classify execution and UI findings as later-loop unless the API design makes them impossible.

Review gate for this loop:
- Blocking: durable authority is not JSONL, malformed events can clear valid state, provisional threads can acknowledge non-durable preferences, or global patch writes thread state.
- Non-blocking: turn execution may still use global profile until Loop 3.

- [x] Implement JSONL event parser/reducer for thread runtime preference patches.
- [x] Implement thread runtime-state patch protocol parser and handler.
- [x] Implement global runtime defaults read/patch protocol parsers and handlers.
- [x] Implement pure preference-aware effective runtime profile resolver for API summaries, without wiring turn execution yet.
- [x] Expose preferences through replay/read/resume from one server helper.
- [x] Emit sequenced non-transcript runtime-state notification after successful thread patch.
- [x] Add protocol, session, and app-server handler tests.
- [x] Run targeted protocol/session/app-server tests.
- [x] Triage review findings into `docs/thread-runtime-preferences-review-findings-log.md`.
- [x] Run `codex review` for this loop after targeted verification passes; stopped further Loop 2 reruns by the churn trigger after two classified rounds.
- [x] Commit this loop after review passes.

### Loop 3: Effective runtime profile and execution wiring
#### Loop Contract
- Purpose: make app-server execution use the effective thread/global runtime profile consistently for future turns and turn-dispatch commands.
- In scope: wiring the Loop 2 preference-aware profile resolver into `turn/start`, all model-facing command dispatch paths, `/context`, runner cache keying, frozen profile behavior.
- Out of scope: Web composer controlled UI, optional source badges, thread-scoped TUI commands.
- Blocking findings: concrete model is not recomputed from effective tier, context-window binding/source stays global after tier override, runner cache key is computed before preferences, runner cache can cross profiles, `TurnRunner` construction/start and `RunningTurn.runtimeProfile` use different snapshots, `/context` reports a different profile than next turn, a thread-bound provider request path bypasses the shared resolver, mid-turn preference update mutates running turn.
- Non-blocking / later-loop findings: Web local UI state belongs to Loop 4; explicit TUI thread commands are deferred follow-up.
- Review prompt scope: review execution/profile/cache correctness for this loop; classify Web UI findings as later-loop unless they reveal an app-server contract break.

Review gate for this loop:
- Blocking: concrete model is not recomputed from effective tier, runner cache can cross model/thinking profiles, `/context` disagrees with next turn, or active turns mutate after preference changes.
- Non-blocking: Web controls may still need final controlled-state polish.

- [x] Route `turn/start` through the Loop 2 effective profile resolver.
- [x] Route `/init`, `/compact`, and `/context` through the same effective profile resolver.
- [x] Scan command-dispatch routing for any other current model-facing provider request path and wire or explicitly defer it.
- [x] Ensure `TurnRunner` uses the frozen effective profile used for cache keying.
- [x] Preserve existing runner plan-path adoption behavior.
- [x] Add runtime profile, command dispatch, diagnostics, cache, and mid-turn preference tests.
- [x] Run targeted runtime/app-server execution tests.
- [x] Triage review findings into `docs/thread-runtime-preferences-review-findings-log.md`.
- [x] Run `codex review` for this loop after targeted verification passes; stopped further Loop 3 reruns by the churn trigger after two classified rounds.
- [x] Commit this loop after review passes.

### Loop 4: Web controlled composer and hydration
#### Loop Contract
- Purpose: make Web display and update model/thinking preferences through server-owned state, without inventing local durable semantics.
- In scope: Web RPC contracts/parsers, replay/read/resume hydration, global runtime defaults read/bootstrap, controlled `ComposerDock`, explicit visible-surface write-target routing, pending mutation send barrier.
- Out of scope: backend thinking effort levels, thread-scoped TUI commands, optional source badges/copy unless required for correctness.
- Blocking findings: Web still owns durable preferences locally, controls initialize from hardcoded defaults after server defaults are available, active-thread changes call global defaults, draft/no-thread changes create thread state, write target is inferred only from `!activeThreadId`, send can race ahead of required persistence, failed patch still permits send with uncommitted displayed profile, four-effort UI reaches backend, Web payloads carry authoritative model/thinking fields.
- Non-blocking / later-loop findings: richer override indicators and real effort levels are deferred follow-ups.
- Review prompt scope: review Web state ownership, hydration, and update routing for this loop; do not require deferred product polish unless it hides semantics.

Review gate for this loop:
- Blocking: Web still owns durable model/thinking in component local state, active-thread updates call global defaults, draft updates create thread state, or sends can race before preference persistence.
- Non-blocking: optional source badges/copy are deferred unless product asks for them.

- [ ] Extend Web RPC contracts/parsers for preference fields and patch APIs.
- [ ] Hydrate preferences from replay/read/resume into Web runtime state cache and hydrate global runtime defaults for draft/no-thread controls.
- [ ] Make `ComposerDock` controlled for model tier and boolean thinking mode.
- [ ] Replace four reasoning effort options with boolean thinking UI.
- [ ] Add explicit `resolvePreferenceWriteTarget(visibleSurface, activeThreadId)` routing helper.
- [ ] Wire active-thread changes to thread patch API.
- [ ] Wire draft/no-thread changes to global runtime defaults patch API.
- [ ] Sequence sends behind pending preference updates with a per-target promise barrier and failure rehydrate/blocking path.
- [ ] Add Web component/runtime/integration tests.
- [ ] Run targeted Web tests.
- [ ] Triage review findings into `docs/thread-runtime-preferences-review-findings-log.md`.
- [ ] Run `codex review` for this loop after targeted verification passes.
- [ ] Commit this loop after review passes.

### Loop 5: Final convergence and regression sweep
#### Loop Contract
- Purpose: verify the feature as an integrated cross-layer behavior and clean up docs/todo state.
- In scope: TUI global regressions, final targeted core/app-server/Web tests, type-check, learning note, CODEMAP if needed, final review finding triage.
- Out of scope: new TUI thread-scoped commands, real reasoning effort levels, richer UI indicators.
- Blocking findings: TUI global behavior regresses, contracts disagree with shipped behavior, old-session fallback is untested, runner/profile/Web parity has no targeted coverage, review log has unresolved true blockers.
- Non-blocking / later-loop findings: deferred follow-up candidates already listed below.
- Review prompt scope: review integrated behavior against accepted contracts and all loop contracts; classify feature-expansion requests as deferred unless they expose a shipped invariant bug.

Review gate for this loop:
- Blocking: TUI global behavior regresses, contracts are stale, old-session fallback is untested, or todo leaves unresolved implementation ambiguity.
- Non-blocking: future thread-scoped TUI commands and real reasoning-effort levels remain deferred.

- [ ] Add or run TUI regression tests for `/model` and `/config thinkingMode`.
- [ ] Run final targeted core/app-server/Web tests touched by the feature.
- [ ] Run `bun run type-check`.
- [ ] Add/update learning note and CODEMAP if required.
- [ ] Ensure `docs/thread-runtime-preferences-review-findings-log.md` has no unresolved true blockers or unclassified findings.
- [ ] Run `codex review` for this loop after targeted verification passes.
- [ ] Commit this loop after review passes.
- [ ] Delete `docs/todolist.md` after all loops are complete and stable facts have been promoted into canonical docs.

## 6. Deferred Follow-Up Candidates

- Add explicit thread-scoped TUI commands after Web semantics land and product copy is agreed.
- Add real thinking effort levels only after backend/provider request semantics exist.
- Add an atomic “update preferences then start turn” RPC if UI testing proves sequencing two calls is too fragile.
- Generalize the thread runtime-state patch lane for future facets such as tool policy, workspace hints, or per-thread output style.
- Add richer UI indicators for thread override vs inherited global value if product wants that visibility.
