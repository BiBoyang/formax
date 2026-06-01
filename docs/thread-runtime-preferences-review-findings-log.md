# Thread Runtime Preferences Review Findings Log

## Current Scope

- Task todo: `docs/todolist.md`
- Accepted contracts: Loop 4 Web controlled composer and hydration in `docs/todolist.md`
- Current loop: Loop 4 - Web controlled composer and hydration
- Review command/profile: `codex review --uncommitted -c model="gpt-5.4" -c model_reasoning_effort="medium"`
- Review scope rule: review findings must be classified before code changes.

## Finding Summary

| ID | Review round | Priority | Finding | Evidence / file(s) | Touched invariant | Contract mapping | Loop mapping | Classification | Decision | Action / test | Status |
|---|---:|---:|---|---|---|---|---|---|---|---|---|
| TRP-L1-R1-001 | 1 | P1 | Docs guarantee cross-process durable thread preferences before JSONL writer/reader exists. | `docs/contracts/session-persistence-contract.md` | Durable authority / implementation availability | `SES-108..110`; Loop 2 JSONL persistence | Loop 2 | valid but current-loop doc blocker | Keep target semantics but mark as planned/unavailable until Loop 2 implementation lands. | Updated contract/API wording; Loop 2 already has JSONL parser/reducer/handler checklist. | resolved |
| TRP-L1-R1-002 | 1 | P1 | Docs advertise runtime-state RPC methods and notification before app-server handlers exist. | `docs/contracts/app-server-interaction-contract.md` | Protocol availability / client compatibility | `thread/runtimeState/*`, `config/runtimeDefaults/*`; Loop 2 protocol handlers | Loop 2 | valid but current-loop doc blocker | Keep accepted method names/shapes but label them as planned target surfaces and require feature detection until implemented. | Updated contract/API wording; Loop 2 already has parser/handler/notification checklist. | resolved |
| TRP-L1-R2-001 | 2 | P2 | Replay hydration can overwrite newer live thread preferences with an older replay snapshot. | `packages/web-reference-react/src/app/runtime/replayThreadEvents.ts` | `replaySeq` monotonic runtime side state | `SEM-205`, `WEB-509` | Loop 1 | true blocker | Preserve newer live runtime state when replay snapshot cursor is stale. | Added replay hydration regression test. | resolved |
| TRP-L1-R3-001 | 3 | P1 | Stale replay guard skipped runtime cache hydrate but still applied stale active UI mode/pending-input sync. | `packages/web-reference-react/src/app/runtime/replayThreadEvents.ts` | `replaySeq` monotonic runtime side state / active UI parity | `SEM-205`, `WEB-509` | Loop 1 | true blocker | Gate active UI runtime sync with the same stale replay check. | Extended replay hydration regression test to assert no pending-input/mode sync from stale replay. | resolved |
| TRP-L1-R4-001 | 4 | P1 | Full replay rebuild can still regress newer runtime preferences because staged runtime state is cleared before replay hydrate. | `packages/web-reference-react/src/app/runtime/useRuntimeEventOrchestrator.ts` | `replaySeq` monotonic runtime side state / full replay parity | `SEM-205`, `WEB-509` | Loop 1 | true blocker | Preserve staged runtime state so stale replay guard can compare against newer live preferences during full replay. | Added full replay rebuild regression test. | resolved |
| TRP-L1-R4-002 | 4 | P2 | Runtime-state reducer ignores authoritative `state.preferences` snapshots on notifications. | `packages/core/src/features/semantics/runtime/threadRuntimeState.ts` | Runtime-state notification recovery | `SEM-106`, app-server `thread/runtimeStateChanged` target shape | Loop 1 | true blocker | Prefer valid reduced `state.preferences` over patch-only reduction when present. | Added reducer test for authoritative state snapshot. | resolved |
| TRP-L1-R5-001 | 5 | P1 | Preference patch helper uses nullable clone pattern that blocks TypeScript compilation. | `packages/core/src/features/semantics/runtime/threadRuntimeState.ts` | Type-check/build gate | Loop 1 implementation hygiene | Loop 1 | true blocker | Replace nullable clone with explicit clone and changed flag. | Re-run type-check and targeted reducer tests. | resolved |
| TRP-L1-R6-001 | 6 | P2 | hasGap fallback snapshot publishes `preferences: {}` when runtime cache is missing, falsely clearing unknown thread preferences. | `packages/core/src/app-server/server.ts` | Unknown-vs-empty runtime preference authority | `SEM-106`, Web omitted-field cache semantics | Loop 1 | true blocker | Make replay snapshot preferences optional and omit them for projection-only fallback snapshots. | Added app-server fallback snapshot regression assertion. | resolved |
| TRP-L1-R7-001 | 7 | P1 | Full replay with `state: null` can preserve stale staged runtime state instead of clearing it. | `packages/web-reference-react/src/app/runtime/useRuntimeEventOrchestrator.ts` | Full replay authoritative empty state | Web replay hydrate semantics | Loop 1 | true blocker | Pass live baseline separately so staged runtime state can start empty while stale replay snapshots can still compare against newer live state. | Added full replay empty-state regression test. | resolved |
| TRP-L1-R7-002 | 7 | P2 | Malformed authoritative `state.preferences` parses to `{}` and clears valid cached overrides. | `packages/core/src/features/semantics/runtime/threadRuntimeState.ts` | Runtime-state notification recovery / malformed tolerance | `SEM-106`, `SES-110` tolerance model | Loop 1 | true blocker | Treat non-empty snapshots with no valid preference fields as malformed and fall back to patch reduction. | Added malformed authoritative snapshot reducer test. | resolved |
| TRP-L2-R1-001 | 1 | P1 | Replay synthesized a full default runtime state from persisted preferences alone after cache miss/restart. | `packages/core/src/app-server/server.ts` | Replay state authority / recoverable-vs-ephemeral runtime fields | `SEM-106`, Loop 2 replay preferences exposure | Loop 2 | true blocker | Expose durable preferences as top-level replay data when no runtime state exists; do not fabricate `mode`, turn status, pending inputs, or tool-name state. | Added app-server replay regression test proving `state` remains `null` while `preferences` is returned. | resolved |
| TRP-L2-R2-001 | 2 | P1 | `config/runtimeDefaults/patch` wrote `llm.defaultTier` directly instead of reusing `/model` persistence semantics. | `packages/core/src/app-server/index.ts` | Global default tier persistence / context-window metadata sync | Loop 2 global runtime defaults; config settings contract | Loop 2 | true blocker | Route model-tier global default updates through `persistDefaultModelTier` so context-window metadata stays aligned. | Re-ran app-server protocol/server targeted tests and type-check. Existing `persistDefaultModelTier` tests cover the persistence helper; they are currently not part of this loop gate because of pre-existing mock-path drift. | resolved |
| TRP-L2-R2-002 | 2 | P2 | `thread/runtimeState/patch` rejected documented empty patch no-op requests. | `packages/core/src/app-server/protocol.ts` | Generic patch API idempotency / feature probing | Loop 2 strict parser behavior; empty patch no-op decision | Loop 2 | true blocker | Allow `{ patch: {} }` and normalize it to an empty preferences patch. | Added protocol parser regression test for empty patch normalization. | resolved |
| TRP-L3-R1-001 | 1 | P2 | Execution preference resolver could keep returning stale in-memory preferences after the durable thread record changed outside the current server instance. | `packages/core/src/app-server/server.ts` | Execution profile freshness / durable thread preference authority | Loop 3 effective profile execution wiring | Loop 3 | true blocker | Refresh from `ThreadStore.readThread` before turn execution and `/context`; only fall back to cached in-memory preferences if durable read fails. | Added app-server regression test proving a second turn uses updated durable preferences after the first turn completed. | resolved |
| TRP-L3-R2-001 | 2 | P1 | The durable preference refresh also overwrote live runtime state while a turn could still be in flight. | `packages/core/src/app-server/server.ts` | Frozen active-turn runtime state / replay truthfulness | Loop 3 mid-turn preference freeze | Loop 3 | true blocker | Durable refresh may update the preference cache used for future materialization, but must not mutate `runtimeStateByThreadId`. | Removed the live runtime-state overwrite and added diagnostics/replay regression coverage. | resolved |
| TRP-L4-R1-001 | 1 | P1 | Replayed thread preferences can be hidden after the first ordinary live event because active Web rendering preferred `runtimeState.preferences` from the live reducer over the replay/read preference cache. | `packages/web-reference-react/src/app/useAppRuntime.ts` | Web mirror cache / thread preference render authority | Loop 4 controlled Web composer and hydration | Loop 4 | true blocker | Treat the explicit Web preference cache as the render authority; live non-preference runtime events must not erase replayed preferences. | Active preference rendering now reads from the explicit preference cache; fallback patch merges also use that cache. Targeted Web runtime tests rerun. | resolved |
| TRP-L4-R1-002 | 1 | P2 | Omitted additive `preferences` fields from old/unsupported replay/resume responses cleared cached thread preferences. | `packages/web-reference-react/src/app/useAppRuntime.ts`, `packages/web-reference-react/src/app/runtime/replayThreadEvents.ts`, `packages/web-reference-react/src/app/runtime/threadDataOps.ts`, `packages/web-reference-react/src/app/runtime/useRuntimeEventOrchestrator.ts` | Old-client additive-field compatibility / explicit-empty vs omitted semantics | Loop 4 omitted fields must not clear cache; explicit `{}` means no override | Loop 4 | true blocker | Only update the preference cache when a response explicitly contains the additive `preferences` field; keep explicit `{}` as a supported no-override state. | Added replay regression tests for omitted-vs-explicit preferences and reran Web runtime tests. | resolved |
| TRP-L4-R2-001 | 2 | P2 | Cross-client `thread/runtimeStateChanged` notifications without `replaySeq` did not update Web preference cache. | `packages/web-reference-react/src/app/runtime/processNotification.ts` | Live preference notification parity / cross-client Web state | Loop 4 live notification hydration | Loop 4 | true blocker | Apply runtime-state preference notifications even when no replay sequence is present, without advancing the replay cursor. | Added process-notification regression test for no-`replaySeq` runtime preference updates. | resolved |
| TRP-L4-R2-002 | 2 | P2 | Thread overrides could not be cleared back to inherited global defaults from the Web selector. | `packages/web-reference-react/src/app/useAppRuntime.ts`, `packages/web-reference-react/src/app/runtime/runtimePreferences.ts` | Thread override clear semantics / global fallback | Loop 4 active-thread patch routing; `null` clears override contract | Loop 4 | true blocker | When a thread selection equals the current global default, send `null` for that field so the server clears the thread override. | Added runtime-preference helper test for default-matching clear patches and reran Web runtime/integration tests. | resolved |

## Classification Rules

- `true blocker`: violates accepted contract, current loop contract, safety/security invariant, targeted test, or obvious lifecycle/data correctness.
- `valid but later-loop`: valid concern outside the current loop acceptance boundary and already planned or added to a future loop.
- `spec ambiguity`: requires choosing product/security/compatibility semantics that are not locked in the contract/todo.
- `reviewer preference`: style, polish, extraction, alternate design, or broad cleanup not tied to a current-loop bug.
- `conflicts with accepted contract`: recommends behavior that contradicts a locked contract or confirmed user decision.

## Not Adopted Findings

| ID | Reason | Contract/todo evidence | Contradicts? | User confirmed? | Regression test added? |
|---|---|---|---|---|---|
| TRP-L1-R1-001 | Durable JSONL recovery requires Loop 2 implementation. | Loop 2 | yes | no | planned |
| TRP-L1-R1-002 | Runtime-state RPC handlers require Loop 2 implementation. | Loop 2 | yes | no | planned |

## Later-Loop Findings

| ID | Finding | Future loop | Todo item added? | Repeated in review? | Status |
|---|---|---|---|---|---|
| | | | | | |

## Spec Ambiguity / Conflict Clusters

| Cluster | Findings | Conflict or open decision | Accepted resolution | Contract update |
|---|---|---|---|---|
| | | | | |

## Stop / Escalation State

- Review rounds in current loop: 2
- Contradictory findings detected: no
- Spec convergence required: yes
- User question required: no
- Churn trigger status: triggered after two Loop 4 review rounds produced same-feature P1/P2 findings.
- Convergence decision: apply the four classified Web preference true blockers, then stop broad review reruns for Loop 4 and rely on targeted tests/type-check unless a concrete unclassified blocker remains.
- Current resolution: all classified Loop 4 review findings have a recorded decision, action, and regression test.

## Churn Trigger

Stop implementation edits and run a convergence pass when any condition is true:

- Two review rounds in the same loop produce new P1/P2 semantic findings after targeted tests pass.
- Any finding contradicts an accepted contract or confirmed user decision.
- The same semantic cluster receives opposite recommendations across rounds.
- A finding requires changing behavior outside the current loop contract.
- More than three findings in one review are not obvious code bugs.
- Any credential, secret, startup gate, fail-open/fail-closed, durable-state, runtime-profile, or protocol-boundary finding is not already covered by contract/todo.
- We are about to make a third code change in the same semantic area only to satisfy review.
- A finding proposes changing method names, payload authority, JSONL schema, durable authority, transcript-vs-runtime-state ownership, runtime-profile fingerprint inputs, or runner cache semantics after Loop 1 lock.
- A finding moves authority across boundaries, such as adding authoritative model/thinking fields to `turn/start`, making Web local state durable, making sidecar memory authoritative, or changing existing TUI commands to thread-scoped.
- A repeated later-loop finding appears in two review rounds without a concrete future-loop checklist item or explicit not-adopted decision.

## Required Finding Fields

Each review finding must include these fields before implementation changes:

- `ID`
- `review round`
- `current loop`
- `claim`
- `evidence / files`
- `touched invariant`
- `contract mapping`
- `loop contract mapping`
- `classification`
- `decision`
- `action`
- `test added/updated or deferred-loop item`
- `contradiction cluster`, when applicable
