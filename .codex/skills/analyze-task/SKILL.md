---
name: analyze-task
description: Use when a Formax repository task is non-trivial and you should analyze goals, non-goals, boundaries, data/type/interface impact, contract impact, test strategy, and whether an xhigh subagent is actually needed before writing a todo or code.
---

# Analyze Task

Use this skill before coding for non-trivial repository work:

- new features
- cross-layer changes
- architecture or model changes
- complex bugs
- tasks that likely need multiple commits / reviews / loops

Do **not** use it for tiny local edits that can be implemented and verified immediately.

## Purpose

Produce a short **Analysis Brief** that makes the task discussable and executable.

This skill is for:

- clarifying the goal
- defining non-goals
- identifying what must be decided before coding
- deciding whether a subagent is justified
- preparing the task for a scope-alignment discussion
- setting up the handoff to `write-task-todo` only after alignment

This skill is **not** for writing code and **not** for writing `docs/todolist.md`.

## Core rules

1. Prioritize **structure before UI**
   - think about canonical docs/contracts, data model, types, interfaces, repo/service/runtime boundaries before UI details

2. Prefer **explicit boundaries**
   - say what is in scope and what is not
   - surface ambiguity instead of silently choosing

3. Use subagents **selectively**
   - default is local analysis
   - use an `xhigh` explorer subagent only when the task is cross-layer, ambiguous, high-risk, or likely to benefit from an independent architectural read
   - if you use a subagent, give it a narrow question; do not outsource the entire solution

4. Do not create a canonical doc yet unless the concept is already clearly stable and long-lived
   - early definitions belong in analysis/todo first

5. Every analysis should end with an alignment state:
   - ready for alignment discussion
   - ready for `write-task-todo` after confirmation
   - or blocked on a single clarification

## Required output

Produce a brief with these sections:

```md
## Analysis Brief

### Goal

### Product Boundary

### Scope

### Non-goals

### Canonical-Doc Impact

### Data / Type / Interface First

### Layer Impact

### Risks / Ambiguities

### Need Subagent?

### Test Strategy

### Alignment Questions

### Ready for Todo?
```

## Section guidance

### Goal
- one concise sentence

### Product Boundary
- say whether the center of gravity is product, platform, or both

### Scope
- list what this task must accomplish

### Non-goals
- list what this task must not expand into

### Canonical-Doc Impact
- identify whether an existing canonical doc already governs this area
- in Formax, prefer checking `docs/contracts/*`, `docs/frontend/*`, `docs/environment-variables.md`, `CODEMAP.md`, and package-local README deep dives
- if yes, say which doc(s) govern the area
- if not, say whether this task is likely to need a new canonical doc later

### Data / Type / Interface First
- identify the definitions that should be settled before implementation
- examples:
  - payload shape
  - DTOs
  - repo interfaces
  - service boundaries
  - route contracts
  - surface/view state

### Layer Impact
- name affected layers as applicable:
  - `core`
  - `contracts`
  - `db`
  - `app`
  - `routes`
  - `schema`
  - `repo`
  - `service`
  - `runtime`
  - `ui`

### Risks / Ambiguities
- call out the likely failure modes or places where the task could go structurally wrong
- in Formax, explicitly consider parity drift, transcript/reset semantics, prompt/tool exposure drift, and thread/runtime state ownership when relevant

### Need Subagent?
- answer `yes` or `no`
- if `yes`, explain exactly what question the subagent should investigate

### Test Strategy
- identify what should be framed by tests first
- prefer focused tests over blanket integration-first thinking
- match Formax's repo guidance: targeted tests first, no coverage runs, protect user-visible behavior and runtime semantics

### Alignment Questions
- list the decisions or tradeoffs that should be explicitly confirmed before writing `docs/todolist.md`
- if there are no meaningful open questions, say so directly

### Ready for Todo?
- answer whether the task should proceed into `write-task-todo`
- default to `no` if important scope, boundary, or semantics questions are still open

## Handoff rule

Do not treat this skill as an automatic handoff to `write-task-todo`.

The normal sequence is:

1. produce the `Analysis Brief`
2. discuss and align the analysis with the user
3. only then hand off to `write-task-todo`

If the task is non-trivial and the analysis is already aligned, hand off to `write-task-todo`.

If the task is trivial, explicitly say that a structured todo is not needed.
