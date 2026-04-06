# 2026-04-07: runtime request-collapse state should travel with prepared turns

## Context

After request-time collapse diagnostics and recap metadata landed, collapse semantics were visible in `/context`, but the send pipeline still had to rediscover collapse from `requestHistory` if any later runtime consumer wanted to use it.

## Decision

- Keep request-time collapse request-only.
- Add a minimal `collapseState` to `prepareHistoryForTurn()` and `runReactiveCompact()`.
- Build it from the same `ContextCollapseResult` that already produces `requestHistory`, so prepare/reactive paths cannot drift.

## Shape

- `applied`
- `collapsedHeadMessageCount`
- `estimatedTokensSaved`
- `metadata`

## Why

- This makes collapse runtime-visible without committing to a persisted collapse store yet.
- Future send/app-server/event consumers can use the real collapse outcome directly instead of re-parsing `requestHistory`.
- A shared projection helper keeps normal send and reactive retry aligned.
