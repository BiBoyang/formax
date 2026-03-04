# 2026-03-04: Web history/cache write dedup in threadDataOps

## What changed

- Updated `apps/web-reference-react/src/app/runtime/threadDataOps.ts` to skip redundant writes for thread history bookkeeping:
  - `setThreadHistoryLoading` now returns early when loading state is already equal.
  - `setThreadHistoryCursor` now returns early when cursor value is unchanged.
  - `setThreadTranscriptSource` now returns early when source is unchanged.
  - `clearThreadHistoryCursor` now returns early when neither loading nor cursor keys exist, and only writes the slices that actually exist.

- Added no-op coverage in `apps/web-reference-react/src/app/runtime/threadDataOps.test.ts`:
  - unchanged source/loading updates do not trigger state setter calls.
  - clearing missing thread history state does not trigger setter calls.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - Removed completed Slice B from pending queue.

## Why

- History paging and replay hydration paths are called frequently and previously invoked setter callbacks even on no-op values.
- These guards reduce avoidable state-set scheduling and help keep runtime updates quieter under heavy transcript operations.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/app/runtime/threadDataOps.test.ts`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
