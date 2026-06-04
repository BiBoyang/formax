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

## Preflight gate for large cross-layer tasks

Before writing `docs/todolist.md`, use a short **Decision Draft** when the task crosses any of these Formax boundaries:

- permissions / policy / approval / hooks
- runtime config / persistent settings / credentials / secrets
- tool runtime / prompt exposure / deferred exposure / ToolSearch
- SDK / REPL / app-server / Web / Electron entrypoints
- protocol boundaries, child processes, startup timing, session lifecycle, result mapping, files, binary payloads, or cleanup

Do not write the final todo until the Decision Draft is aligned. The draft should be short and must answer:

- Storage and config source: where data lives, who reads it, and who must not read it.
- Schema and strictness: accepted fields, rejected fields, default values, and unknown-field behavior.
- Startup / activation timing: which entrypoint may create side effects and which phases are pure.
- Permission model: whether existing Formax permission / approval / hook flow can express the behavior before adding new actions.
- Capability level: whether the feature is a tool, slash command, SDK control, hook, transcript renderer, config setting, or prompt exposure behavior.
- Entrypoints: REPL, SDK, app-server, Web, and Electron behavior.
- Result / IO boundaries: output caps, file locations, binary/media handling, cleanup, secrets, and timeout behavior.
- Non-goals: what is explicitly out of Phase 1 and what user-visible behavior that implies.

For small single-layer fixes, skip the Decision Draft and keep the todo lightweight.

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

9. Add an **EntryPoint Matrix** for cross-entrypoint features
   - required when behavior may differ across REPL, SDK, app-server, Web, or Electron
   - each relevant entrypoint must say whether it reads config, starts/activates runtime, exposes the capability, renders UI/transcript state, and has tests
   - if an entrypoint is explicitly out of scope, say what it does instead, such as empty overlay, unsupported error, no-op with diagnostic, or no surface

10. Attribute critical semantic decisions
    - mark each non-obvious rule as one of:
      - `Reference-derived` with the concrete reference, such as Claude Code, OpenAI SDK, MCP SDK/spec, or another repo source
      - `Formax-existing` for behavior inherited from current contracts/code
      - `Formax-Phase-1 safety choice` for thresholds, fail-closed defaults, local caps, cleanup, or bounded behavior we choose ourselves
      - `User-aligned` for decisions explicitly settled with the user
    - do not label a rule as parity/reference behavior unless the source was actually checked

11. Prefer existing Formax models before inventing new concepts
    - for permissions, first test whether existing permission / policy / approval / hook flow can express the behavior
    - for tools, first decide the product level: normal tool, dynamic tool, ToolSearch/deferred catalog behavior, slash command, SDK control, or renderer
    - add new policy actions, protocol fields, brokers, registries, or config files only after documenting why existing Formax contracts cannot express the need

12. Make non-goals actionable
    - for large protocol/runtime/config tasks, a non-goal should say:
      - whether the upstream/reference system has the capability
      - whether Formax Phase 1 implements it
      - what behavior the user sees in Phase 1
    - avoid vague non-goals such as "defer X" without the resulting behavior

13. Run a vague-language scan before finalizing the todo
    - search for terms like `where needed`, `if needed`, `if practical`, `either`, `or explicitly`, `fallback`, `unless scoped`, `later`, `may`, `might`, `optional`, `as needed`, `TBD`, `unresolved`
    - every hit must become one of:
      - a Phase 1 accepted rule
      - an explicit non-goal
      - a Phase 2 backlog item
      - a stop condition
      - a question for the user
    - do not leave implementation-time choices hidden in prose

14. Source thresholds and IO bounds
    - any output cap, timeout, byte limit, file-backed path, cleanup policy, binary/media behavior, or secret redaction rule must cite its source
    - if the value is a Formax local safety choice, say that explicitly and add tests that pin the behavior

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

### 0.5 Decision Draft Summary
- [ ] Storage/config source:
- [ ] Schema/defaults/rejected fields:
- [ ] Startup/activation timing:
- [ ] Permission model:
- [ ] Capability level:
- [ ] Result/IO/cleanup bounds:
- [ ] Explicit non-goals:

## 1. Definitions First

### 1.1 Canonical docs
- [ ] align with existing canonical docs
- [ ] decide whether a new canonical doc will be needed later

### 1.2 Data model
- [ ] ...

### 1.3 Types / Interfaces
- [ ] ...

### 1.4 Semantic decision table
| Decision | Accepted rule | Source | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|---|
| ... | ... | `Reference-derived` / `Formax-existing` / `Formax-Phase-1 safety choice` / `User-aligned` | ... | ... | ... |

### 1.5 EntryPoint Matrix
| EntryPoint | Reads config? | Activates runtime? | Exposes capability? | UI/transcript behavior | Tests |
|---|---|---|---|---|---|
| REPL | ... | ... | ... | ... | ... |
| SDK | ... | ... | ... | ... | ... |
| app-server | ... | ... | ... | ... | ... |
| Web | ... | ... | ... | ... | ... |
| Electron | ... | ... | ... | ... | ... |

### 1.6 Review finding triage policy
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
- make entrypoint differences visible instead of implicit
- distinguish reference parity from Formax safety choices

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

## Vague-language final check

Before handing the todo back to the user, run a text search over the todo for ambiguous planning language:

```sh
rg -n "where needed|if needed|if practical|either|or explicitly|fallback|unless scoped|later|may|might|optional|as needed|TBD|unresolved" docs/todolist.md
```

Classify every match. It is acceptable for a match to remain only when it is clearly inside a Phase 2 backlog item, a stop condition, or a review triage rule. It is not acceptable for a Phase 1 implementation item to leave the decision open.

## Completion rule

When the work is finished:

1. stable long-lived facts should live in the repo's canonical docs
2. `docs/todolist.md` should be deleted
3. no parallel definitions should remain behind
