# Bugfix TODO (from `plans/bugfix/1.txt`)

> Goal: fix the user-visible regressions reported in `plans/bugfix/1.txt`, add targeted tests to lock behavior, then tick items here.
>
> Constraint: avoid `bun run test:coverage`; run only targeted tests for touched areas.

## P0 — Tool UI: empty `Tool()` params

- [x] Fix: tool call headers must not render empty parens like `⏺ Edit()` / `⏺ WebFetch()` when params are missing.
  - Implemented by conditionally rendering `(...)` only when `params.trim().length > 0`.
  - Also improved Edit patch preview line anchoring by:
    - not defaulting `patchStartLineNumber` to `1` when it can’t be inferred (avoid misleading line numbers), and
    - making `stripCatNPrefixes()` robust to single-space delimiters.
- [x] Tests:
  - `src/components/tool/ToolMessage.test.tsx` covers “no `Edit()` when params empty”.
  - `src/features/repl/controller/patchStartLineNumber.test.ts` covers cat-`-n` prefix stripping variants.
  - `src/tools/presenters/PatchPreview.test.tsx` covers insertion-only previews (no invented delete row).

## P0 — Tool UI: CC spacing + indentation

- [x] Fix: tool header spacing uses exactly one space after `⏺` (no `⏺  Read`, no `⏺Read`).
- [x] Fix: tool result subline is indented like CC (`  ⎿  ...`) via a shared left pad.
- [x] Fix: when Edit patch start line can’t be inferred, do **not** show fake line numbers (hide the line-number column instead).
- [x] Tests:
  - `src/components/tool/ToolMessage.test.tsx` asserts no double-space after `⏺`.
  - `src/tools/presenters/PatchPreview.test.tsx` asserts no line-number invention when `startLineNumber` is missing.

## P0 — Approval UI: Enter does nothing (ConfirmMenu)

- [x] Fix: approval prompts must *re-render* after submitting a decision (Enter previously looked “stuck”).
  - Root cause: `UserInputManager` lived in a stable context object; mutating internal Maps didn’t trigger React re-render.
  - Fix: `UserInputProvider` now publishes a version counter and bumps it on pending-state changes (submit/reject/request).
- [x] Tests:
  - `src/tools/modules/bash/presenter.test.tsx` asserts Enter submits and the approval prompt disappears immediately.

## P1 — Chat engine: `Tool loop exceeded iteration limit`

- [x] Fix: make `Tool loop exceeded iteration limit` actionable when it happens.
  - Repro examples in `plans/bugfix/1.txt` #3 and #6.
  - Added a short hint pointing to `FORMAX_TOOL_LOOP_LIMIT` (default is 200).
