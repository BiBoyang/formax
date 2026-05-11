# 2026-05-12: restore surfaces should expose canonical compact facts

## What changed

- `thread/resume` now returns `latestCompactBoundary` from the same canonical replay/compact-boundary source already used by `thread/read` and `thread/messages`.
- Web runtime `resumeThreadInputs()` now consumes that field directly and updates the thread-scoped compact-boundary cache on restore.

## Why

- Before this change, restore surfaces could recover stale inputs and next-turn-only reminder blocks, but they still needed an extra `thread/read`/`thread/messages` round-trip to learn the most recent compact boundary.
- That created an avoidable parity gap: compact protocol facts existed, but restore flow did not consume them.

## Decision

- Keep `latestCompactBoundary` on `thread/resume` as a read-only, canonical protocol fact.
- Do not introduce a second persisted authority model or a restore-only compact summary.
- Prefer reusing the same replay-derived compact boundary metadata across all thread surfaces.

## Result

- app-server restore surfaces now align better with compact protocol semantics.
- Web restore path can update compact boundary state immediately after `thread/resume`.
- The change stays intentionally small: restore now consumes compact protocol facts without reopening collapse/store design.
