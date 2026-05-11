# 2026-05-11 - Reactive compact shaping v2

## Context

Reactive compact already retried once after provider-side context overflow, but the system only retained a coarse `reactive_error` compact trigger and the retry result itself. That made `/context` and other diagnostics surfaces under-explain the last reactive fallback.

## Decision

Add a minimal structured reactive compact fact path:

1. classify overflow errors into stable `triggerKind` values
2. record successful fallback usage as `reactive_compact_applied`
3. expose the latest persisted/runtime fact as `latestReactiveCompact` in diagnostics payloads

## Why

This keeps the reactive path explainable without changing retry count or introducing a heavier recovery state model.

The new fact answers:
- what kind of overflow triggered reactive compact
- whether fallback used `session_memory` or `model_summary`
- what error detail was seen most recently

## Guardrails

- still only a single reactive retry
- no persisted collapse/store model changes
- no replay-time projection rebuild
- diagnostics should prefer persisted/runtime reactive facts instead of re-deriving them later
