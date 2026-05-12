# 2026-05-12 - Compact protocol deeper inspection parity

## Context

`thread/replay` already preserved deeper compact-boundary facts such as `keepStrategy`, `rehydrationPlan`, `rehydrationCost`, and `preservedSegment`.

The remaining drift was on the Web inspection path:

1. `asThreadMessages()` only kept a shallow `latestCompactBoundary` summary.
2. `threadDataOps` only compared shallow compact-boundary fields before refreshing the thread-scoped cache.

That combination meant history-driven inspection could silently downgrade an already richer compact summary.

## Decision

Introduce a shared Web helper for compact-boundary parsing and equality, then route both parser paths and cache refresh logic through it.

## Implementation

- Added `packages/web-reference-react/src/app/core/compactBoundarySummary.ts`
  - `parseCompactBoundarySummary(...)`
  - `areCompactBoundarySummariesEqual(...)`
- `rpcContracts.ts` now reuses the shared parser helper.
- `rpcParsers.ts` now preserves deeper compact-boundary fields for `thread/messages`.
- `threadDataOps.ts` and `useRuntimeEventOrchestrator.ts` now reuse the shared equality helper so cache refresh decisions no longer depend on shallow-only fields.

## Result

Web history/replay/read/resume inspection paths now preserve the same compact-boundary depth:

- `keepStrategy`
- `rehydrationPlan`
- `rehydrationCost`
- `preservedSegment`

No authority model changed. This was a consumer-parity fix, not a persistence or transport redesign.
