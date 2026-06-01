# Thread Runtime Preferences Review Findings Log

## Current Scope

- Task todo: `docs/todolist.md`
- Accepted contracts: pending Loop 1 updates
- Current loop: not started
- Review command/profile: repository default review profile from `AGENTS.md`
- Review scope rule: review findings must be classified before code changes.

## Finding Summary

| ID | Review round | Priority | Finding | Evidence / file(s) | Touched invariant | Contract mapping | Loop mapping | Classification | Decision | Action / test | Status |
|---|---:|---:|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

## Classification Rules

- `true blocker`: violates accepted contract, current loop contract, safety/security invariant, targeted test, or obvious lifecycle/data correctness.
- `valid but later-loop`: valid concern outside the current loop acceptance boundary and already planned or added to a future loop.
- `spec ambiguity`: requires choosing product/security/compatibility semantics that are not locked in the contract/todo.
- `reviewer preference`: style, polish, extraction, alternate design, or broad cleanup not tied to a current-loop bug.
- `conflicts with accepted contract`: recommends behavior that contradicts a locked contract or confirmed user decision.

## Not Adopted Findings

| ID | Reason | Contract/todo evidence | Contradicts? | User confirmed? | Regression test added? |
|---|---|---|---|---|---|
| | | | | | |

## Later-Loop Findings

| ID | Finding | Future loop | Todo item added? | Repeated in review? | Status |
|---|---|---|---|---|---|
| | | | | | |

## Spec Ambiguity / Conflict Clusters

| Cluster | Findings | Conflict or open decision | Accepted resolution | Contract update |
|---|---|---|---|---|
| | | | | |

## Stop / Escalation State

- Review rounds in current loop: 0
- Contradictory findings detected: no
- Spec convergence required: no
- User question required: no

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
