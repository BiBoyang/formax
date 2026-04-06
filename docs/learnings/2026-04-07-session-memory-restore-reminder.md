# Session Memory Restore Reminder

- Date: 2026-04-07
- Area: context / session-memory / restore

## What changed

REPL `/resume` and CLI `resumeLast` now consume rolling session memory more directly after restore.

After a persisted session is restored and the active history is rebuilt from the latest compact-boundary continuation view, Formax now best-effort derives a one-turn session-memory reminder block from the adjacent `.memory.json` sidecar and injects it through the existing request-time `pendingInjectedBlocksRef` path.

## Why this was the right next step

Before this change, restore paths only refreshed the sidecar. That was useful for later memory-first auto compact, but it did not help the *very next* user turn.

Using the existing next-turn injection path gives restore a low-risk consumption point:

1. the next request can benefit from session memory immediately
2. persisted replay/history semantics remain unchanged
3. the reminder disappears after one turn, so it does not silently become long-term history

## Guardrails

- The reminder is request-time only.
- It must not be written back into persisted history.
- Boundary-aware restore remains the source of truth for active history.
- Sidecar read failures remain best-effort and do not block restore.

## Follow-up implication

This moves session memory from “restore refresh only” to “restore refresh + one-turn consumption” for REPL/CLI, which is a safer bridge toward deeper restore-time working-memory behavior without introducing a heavier persisted state model.
