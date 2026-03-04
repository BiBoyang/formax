# 2026-03-05: Web runtime domain-boundary consolidation (Slice P)

## What changed

- Updated `apps/web-reference-react/src/app/useAppRuntime.ts`:
  - moved diff semantics assembly out of `threadDataOps` composition and into dedicated `diffDataOps` composition.
  - replaced in-file dev load-all state machine logic with `useDevLoadAllHistory` hook.
  - replaced in-file thread/composer/diff UI callback assembly blocks with dedicated runtime handler composers.
  - kept `useAppRuntime` as composition root: lifecycle wiring + domain action composition + AppShell prop mapping.

- Added `apps/web-reference-react/src/app/runtime/diffDataOps.ts`:
  - owns diff refresh fallback policy (`bridge/readDiffSummary` -> `bridge/readDiff`), diff snapshot parsing, and single-file patch fetch.

- Updated `apps/web-reference-react/src/app/runtime/threadDataOps.ts`:
  - removed diff responsibilities; now focuses on thread list/history/resume and history state bookkeeping only.

- Added `apps/web-reference-react/src/app/runtime/useDevLoadAllHistory.ts`:
  - encapsulates dev-only "load all earlier history" state machine (`requested`, `bootstrapAttempts`, `sawHistoryLoading`) with existing semantics preserved.

- Added runtime UI handler composers:
  - `apps/web-reference-react/src/app/runtime/threadUiHandlers.ts`
  - `apps/web-reference-react/src/app/runtime/composerUiHandlers.ts`
  - `apps/web-reference-react/src/app/runtime/diffUiHandlers.ts`
  - `apps/web-reference-react/src/app/runtime/runAsyncSafely.ts`

- Added/updated tests:
  - new: `diffDataOps.test.ts`, `useDevLoadAllHistory.test.tsx`, `threadUiHandlers.test.ts`, `composerUiHandlers.test.ts`, `diffUiHandlers.test.ts`
  - updated: `threadDataOps.test.ts` (thread-only coverage after diff extraction)

## Why

- `useAppRuntime` still contained cross-domain internals, especially `dev` and `diff`, which kept the composition root larger than necessary.
- Splitting by domain (`thread/composer/diff/dev`) preserves behavior while making ownership explicit and reducing future coupling risk.
- The new layout matches the target model:
  - `useAppRuntime`: aggregate and wire
  - `runtime/thread*`: thread semantics
  - `runtime/composer*`: send/interrupt/input semantics
  - `runtime/diff*`: diff semantics
  - `runtime/dev*`: dev-only semantics

## Validation

- `npm --prefix apps/web-reference-react run test -- src/app/runtime/threadDataOps.test.ts src/app/runtime/diffDataOps.test.ts src/app/runtime/useDevLoadAllHistory.test.tsx src/app/runtime/threadUiHandlers.test.ts src/app/runtime/composerUiHandlers.test.ts src/app/runtime/diffUiHandlers.test.ts src/app/runtime/threadActions.test.ts src/App.test.tsx`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
