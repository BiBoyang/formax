# 2026-04-07 App-Server Thread Read Latest Collapse

## Summary

`thread/read` now exposes an optional `latestRequestCollapse` summary so clients can consume the most recent request-time collapse fact without scanning raw session JSONL events themselves.

## Why

We had already reached three intermediate steps:

1. runtime send flow knew when request-time collapse was applied
2. session persistence recorded `request_collapse_applied`
3. app-server session-event readers could parse those events

But no app-server surface actually consumed that data yet. This left collapse state visible in diagnostics and storage, but not yet in a stable cross-surface API result.

## What changed

- `ThreadStore.readThread()` now reads the latest persisted request-collapse event
- `thread/read` returns `latestRequestCollapse` when available
- the summary intentionally stays minimal:
  - `phase`
  - `collapsedHeadMessageCount`
  - `estimatedTokensSaved`
  - `recapFingerprint`

## Guardrail

`latestRequestCollapse` is a request-time summary only. It does not imply that replay history was rewritten, and it should not be treated as a full collapse store.
