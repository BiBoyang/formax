# 2026-04-06: request-time collapse now exposes minimal recap metadata

## Context

After the request-time `context collapse MVP` and the `collapse_recap` contributor kind landed, diagnostics could tell us that collapse happened, but not much about how the synthetic recap was assembled.

## Decision

- Keep collapse request-only; do not introduce a persisted collapse store yet.
- Add a minimal `ContextCollapseMeta` to `ContextCollapseResult`.
- Surface the same metadata through `nextTurnFixed.collapseImpact.metadata`.

## Current stable fields

- `schemaVersion`
- `kind = request_recap`
- `keepLastTurns`
- `preservedTailMessageCount`
- `retainedCompactSummary`
- `recentUserPromptCount`
- `recentFileCount`
- `earlierToolResultBlockCount`
- `recapFingerprint`

## Why

- This gives collapse a small but stable “state card” without pretending we already have a full collapse store.
- Diagnostics can now explain not just that collapse happened, but also which recap strategy produced the synthetic reminder.
- Later collapse-state work can build on this metadata instead of introducing a second client-facing shape.
