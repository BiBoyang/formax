# Thread Latest Compact Boundary Surface

- Date: 2026-04-07
- Area: app-server / context / cross-surface parity

## What changed

`thread/read` and `thread/messages` now expose an optional `latestCompactBoundary` summary alongside the existing `latestRequestCollapse` summary.

The boundary summary is read from persisted session replay, not reconstructed from a separate store, and currently carries the same minimal compact facts we already rely on in `/context` diagnostics:

- `schemaVersion`
- `trigger?`
- `triggerReason?`
- `preTokens?`
- `summaryKind?`

## Why this matters

Before this change, cross-surface consumers could learn about request-time collapse from thread surfaces, but they still needed `/context` to understand the last persisted compact boundary.

That created an awkward split:

- thread surfaces knew the latest collapse fact
- diagnostics knew the latest compact fact

Surfacing `latestCompactBoundary` on thread endpoints keeps those key restore/compact facts closer together and reduces pressure to call `/context` just to answer simple thread-level questions.

## Guardrails

- This is still a summary surface, not a persisted compact store.
- The source of truth remains session replay/history.
- Thread item semantics are unchanged; the new field lives at the response top level.
