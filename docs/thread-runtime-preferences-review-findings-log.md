# Thread Runtime Preferences Review Findings Log

## Current Scope

- Task todo: `docs/todolist.md`
- Accepted contracts: Loop 1 thread runtime preferences contracts in `docs/todolist.md`
- Current loop: Loop 1 - Contracts and semantic state
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

- Review rounds in current loop: 7
- Contradictory findings detected: no
- Spec convergence required: yes
- User question required: no
- Churn trigger status: triggered after repeated Loop 1 replay/runtime-state P1/P2 findings in the same semantic cluster.
- Convergence decision: do not run additional Loop 1 review rounds before commit unless a new targeted test or type-check failure exposes a concrete blocker.
- Current resolution: all classified Loop 1 review findings have a recorded decision, action, and regression test or future-loop mapping.

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
