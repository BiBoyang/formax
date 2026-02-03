# Bugfix TODO (from `plans/bugfix/1.txt`)

> Goal: fix the user-visible regressions reported in `plans/bugfix/1.txt`, add targeted tests to lock behavior, then tick items here.
>
> Constraint: avoid `bun run test:coverage`; run only targeted tests for touched areas.

## P0 — Tool UI: `Edit()` shows empty params

- [x] Fix: tool call header must not render as `⏺ Edit()` with empty parens when Edit has a file path.
  - Expected: `⏺ Edit(LICENSE)` or `⏺ Edit(src/path)` (Claude-style), never `Edit()`.
  - Notes:
    - Root symptom shows up when `tool_input` doesn’t populate `toolInfo.input` in time.
    - Also affects Edit diff preview start line when `patchStartLineNumber` falls back to `1`.
- [ ] Add/adjust tests:
  - [x] Ensure Edit presenter renders the file name/path from tool input.
  - [x] Ensure `patchStartLineNumber` is computed from tool input (when available) and not defaulted spuriously.

## P0 — Approval UI: Enter does nothing (ConfirmMenu)

- [x] Fix: approval prompts using `ConfirmMenu` must accept **Enter** reliably to submit the selected option.
  - Repro examples in `plans/bugfix/1.txt` #2 and #4.
  - Expected: pressing Enter triggers `onDecision(...)` immediately (no “stuck” UI).
  - Likely root: return/enter key detection differs between terminals / ink versions.
- [ ] Add/adjust tests:
  - [x] `ConfirmMenu` submits on both `\\r` and when `key.return` isn’t set (fallback detection).

## P0 — Chat engine: `Tool loop exceeded iteration limit`

- [x] Fix: avoid unexpected `Error: Tool loop exceeded iteration limit` during normal tool usage.
  - Repro examples in `plans/bugfix/1.txt` #3 and #6.
  - Goal: make this error either (a) extremely unlikely (raise limit + better progress), or (b) diagnosable with actionable context.
- [ ] Add/adjust tests:
  - [x] Regression test for tool-loop termination behavior (small synthetic client that keeps returning `tool_use`).
  - [x] Ensure tool loop does not spin when tool results are missing / pruned.
