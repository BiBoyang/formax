# Structured Restore Continuity Hints

Date: 2026-05-30

CCA-180 v8 keeps session-memory restore as next-turn-only, best-effort context. The implementation may carry richer hints, but those hints do not become runtime authority.

Key decisions:

- `recentDeferredToolNames` is derived from prior successful `ToolSearch` results. Structured `tool_reference` blocks are preferred; legacy text sections remain a compatibility fallback.
- `recentTaskContinuityHints` is additive and transcript-derived. It preserves `recentTaskHints` compatibility and excludes failed/error `Task` calls from reminder-rendered continuity hints.
- Task hint fields use observation wording such as `resumeHint`, `lastObservedStatus`, `evidenceSource`, and `evidenceConfidence` so they cannot be mistaken for task registry state.
- `restoreDiagnostics` describes the whole pending restore artifact while it is pending. After consumption, the public signal remains `pendingSessionMemoryRestore: null`.
- Web parsers accept v8 optional fields but do not reconstruct restore utility from transcript rows.

Canonical contracts:

- `docs/contracts/session-persistence-contract.md`
- `docs/contracts/prompt-tool-exposure-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
- `docs/contracts/web-parity-adapter-contract.md`
