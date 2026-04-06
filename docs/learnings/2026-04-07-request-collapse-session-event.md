# 2026-04-07 Request Collapse Session Event

## Summary

We promoted request-time collapse from diagnostics-only state into a minimal runtime event sink by recording `request_collapse_applied` in session persistence when a real model request uses a collapsed request projection.

## Why

Before this change, collapse metadata existed in:

- `ContextCollapseResult`
- `/context` diagnostics
- Web diagnostics parsing

But the runtime send path itself did not persist any evidence that a real request had actually used collapse. That made later work on collapse-aware replay tooling or richer runtime state harder, because the only source of truth was re-derivation.

## What changed

- `runMainSendTurn()` now calls an `onRequestCollapse` callback when:
  - the initial request projection used collapse
  - the reactive retry projection used collapse
- `useSessionEventRecorders()` records those callbacks as `request_collapse_applied`
- the event currently stores:
  - `phase`
  - `collapsedHeadMessageCount`
  - `estimatedTokensSaved`
  - minimal request-recap metadata such as `keepLastTurns`, `preservedTailMessageCount`, and `recapFingerprint`

## Guardrail

This event is request-time only. It does **not** mean persisted history was rewritten, and it must not be interpreted as a collapse store.
