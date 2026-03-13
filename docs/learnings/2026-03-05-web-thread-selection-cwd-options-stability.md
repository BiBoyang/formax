# 2026-03-05: Web thread selection cwd-options stability

## What changed

- Updated `packages/web-reference-react/src/app/runtime/useThreadSelection.ts`:
  - added value-based array reconciliation for `cwdOptions`.
  - when computed cwd options values/order are unchanged, the hook now reuses previous `cwdOptions` array reference.

- Updated `packages/web-reference-react/src/app/runtime/useThreadSelection.test.tsx`:
  - added regression test verifying `cwdOptions` reference stability across rerenders with unchanged cwd list/order.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice H complete and kept Slice I pending.

## Why

- Sidebar list rendering relies on derived cwd options; unnecessary array identity churn can invalidate memoized downstream selectors/effects.
- Reusing array references for semantically unchanged options helps keep render paths stable without changing behavior.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/app/runtime/useThreadSelection.test.tsx`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
