---
name: write-task-todo
description: Use after task analysis when a non-trivial Formax repository task needs a structured `docs/todolist.md` with [x]/[ ] items, definitions-before-UI ordering, explicit non-goals, tests, and loop-ready execution slices.
---

# Write Task Todo

Use this skill after `analyze-task` **and after the analysis has been discussed and aligned** when a task is large enough to need multiple implementation loops, commits, reviews, or cross-layer coordination.

This skill turns an analysis result into a **single working task document**:

- `docs/todolist.md`

## Purpose

Create a todo that is:

- structured
- execution-friendly
- test-aware
- biased toward definitions and interfaces before UI

This skill is **not** for coding and **not** for long-form design writing.

## Core rules

1. Use a single working todo file
   - default path: `docs/todolist.md`

2. Do **not** create a parallel source-of-truth doc at the start
   - put evolving definitions in the todo first
   - once a concept becomes stable and long-lived, promote that part into the repo's canonical docs
   - in Formax, canonical docs usually mean `docs/contracts/*`, `docs/frontend/*`, `docs/environment-variables.md`, or tightly owned package-local README deep dives
   - after promotion, the todo should reference the canonical doc rather than maintain a second truth

3. Prefer **definitions before implementation**
   - canonical-doc impact
   - data model
   - types / interfaces
   - tests
   - then implementation layers

4. Use `[x]` and `[ ]` strictly
   - `[x]` only for confirmed facts, fixed decisions, or completed work
   - `[ ]` for pending work
   - never mark assumptions as `[x]`

5. The todo must be **loop-ready**
   - break work into mainline slices that can be implemented, verified, reviewed, and committed independently
   - every meaningful implementation loop should include an explicit unchecked `codex review` item
   - every meaningful implementation loop should include a `Loop Contract` that says what review may block on and what must be classified as later-loop/non-blocking
   - use the repository's existing review profile instead of redefining model, reasoning, or timeout in the todo

6. If the task is too small to justify a todo
   - say so explicitly
   - do not create `docs/todolist.md`

7. Do not generate a todo while key alignment questions are still unresolved
   - if scope, semantics, host/scope boundaries, or architecture direction are still under discussion, stop and ask for alignment first

8. Add a **spec lock / review-scope lock** for high-risk multi-loop work
   - required when the task crosses multiple layers such as shared semantics, app-server protocol, session persistence, runtime config/profile, credentials/secrets, startup/recovery, Electron/Web bridge, or Web UI state
   - required when review is likely to confuse final-feature completeness with the current implementation slice
   - include a semantic decision table and a review finding triage policy before implementation loops
   - create a dedicated review findings log when the task is large enough to expect multiple `codex review` runs
   - do not let the todo imply that review findings are direct edit commands; findings must be classified before code changes

## Required structure

Use this shape unless a task has a strong reason to be simpler:

```md
# <Feature Name> Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] ...

### 0.2 Goals
- [ ] ...

### 0.3 Non-goals
- [x] ...

### 0.4 Spec lock and review-scope
- [x/ ] Spec lock required:
- [x/ ] Review findings log:
- [x/ ] Review findings must be classified before code changes
- [x/ ] Current-loop review is scoped by each loop's `Loop Contract`
- [x/ ] Later-loop findings are logged, not chased in the current loop
- [x/ ] Spec ambiguity stops implementation until contracts/todo/user alignment are updated

## 1. Definitions First

### 1.1 Canonical docs
- [ ] align with existing canonical docs
- [ ] decide whether a new canonical doc will be needed later

### 1.2 Data model
- [ ] ...

### 1.3 Types / Interfaces
- [ ] ...

### 1.4 Semantic decision table
| Decision | Accepted rule | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

### 1.5 Review finding triage policy
- [ ] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`
- [ ] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs
- [ ] For later-loop findings, update the review findings log and make sure a future loop owns the acceptance item
- [ ] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code
- [ ] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope
- [ ] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test if needed
- [ ] Re-run review only after triage is documented and targeted tests pass

## 2. Runtime / Platform
- [ ] core
- [ ] contracts
- [ ] app
- [ ] runtime

## 3. Frontend Boundary
- [ ] repo
- [ ] service
- [ ] runtime
- [ ] ui

## 4. Tests
- [ ] runtime tests
- [ ] ui tests
- [ ] integration tests

## 5. Recommended Execution Order

### Loop 1
#### Loop Contract
- Purpose:
- In scope:
- Out of scope:
- Blocking findings:
- Non-blocking / later-loop findings:
- Known unresolved semantics:
- Required targeted tests:
- Review prompt scope:
- Exit criteria:

- [ ] ...
- [ ] triage review findings into the review findings log
- [ ] run `codex review` for this loop after targeted verification passes

### Loop 2
#### Loop Contract
- Purpose:
- In scope:
- Out of scope:
- Blocking findings:
- Non-blocking / later-loop findings:
- Known unresolved semantics:
- Required targeted tests:
- Review prompt scope:
- Exit criteria:

- [ ] ...
- [ ] triage review findings into the review findings log
- [ ] run `codex review` for this loop after targeted verification passes
```

## Adaptation rules

- Drop sections that truly do not apply, but keep the ordering principle.
- If the task is backend-only or frontend-only, simplify the irrelevant half instead of filling it with noise.
- If the task is documentation-only, keep the todo much smaller and avoid fake engineering sections.
- If the prior analysis still has unresolved `Alignment Questions`, do not write the todo yet.
- If the task is primarily a Formax web GUI/runtime task, prefer `Runtime / Platform` plus `Frontend Boundary` over generic backend/database sections.

## What good looks like

A good todo should:

- make the next implementation loop obvious
- make verification obvious
- make loop-level review explicit
- show where tests belong
- prevent UI-first drift
- make it easy to know when the todo is done
- reflect aligned decisions rather than unresolved debate

## Review rule

When writing `## 5. Recommended Execution Order`:

- include a `codex review` checkbox in every meaningful implementation loop
- include a `Loop Contract` before every meaningful implementation loop's checklist
- make the `Loop Contract` explicit about blocking vs non-blocking/later-loop findings
- place the review item after the loop's targeted verification step
- place a review-finding triage/logging item after targeted verification and before the review is considered handled
- keep the item unchecked unless that loop has actually been completed
- prefer wording like `- [ ] run \`codex review\` for this loop`
- do not restate model, reasoning, or timeout settings if the repository already defines a single-source-of-truth review profile
- if review finds issues, the next todo update should classify them before code edits:
  - `true blocker`: fix in the current loop
  - `valid but later-loop`: log and bind to a later loop
  - `spec ambiguity`: stop implementation and update contracts/todo or ask the user
  - `reviewer preference`: usually do not adopt unless low-risk and local
  - `conflicts with accepted contract`: do not implement; cite the contract and consider a regression test

## Review churn trigger

For large multi-loop tasks, include a stop/escalation rule in the todo or review findings log. Stop implementation edits and run a convergence pass when any condition is true:

- two review rounds in the same loop produce new P1/P2 semantic findings after targeted tests pass
- any finding contradicts an accepted contract or confirmed user decision
- the same semantic cluster receives opposite recommendations across rounds
- a finding requires changing behavior outside the current loop contract
- more than three findings in one review are not obvious code bugs
- a credential, secret, startup gate, fail-open/fail-closed, durable-state, runtime-profile, or protocol-boundary finding is not already covered by contract/todo
- the agent is about to make a third code change in the same semantic area only to satisfy review

## Completion rule

When the work is finished:

1. stable long-lived facts should live in the repo's canonical docs
2. `docs/todolist.md` should be deleted
3. no parallel definitions should remain behind
