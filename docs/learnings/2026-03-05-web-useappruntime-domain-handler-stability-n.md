# 2026-03-05: Web useAppRuntime domain-handler stability (Slice N)

## What changed

- Updated `apps/web-reference-react/src/app/useAppRuntime.ts`:
  - added guarded stable setters:
    - `setModeStable`
    - `setSelectedCwdStable`
    - `setNoticeMessageStable`
  - switched runtime composition wiring to these setters where cross-domain callbacks are assembled (`threadActions`, archived-thread notification handler, thread selection sync).
  - introduced a shared async safety helper `runAsyncSafely(task)` for fire-and-forget UI-triggered runtime actions.
  - grouped UI callback composition by domain with memoized handler bundles:
    - `threadUiHandlers`
    - `composerUiHandlers`
    - `diffUiHandlers`
  - return path now maps AppShell props from these domain bundles instead of many scattered callback wrappers.

## Why

- `useAppRuntime` is the composition root, but callback wrappers were spread across the file and recreated in multiple independent hooks.
- Domain grouping plus guarded setters reduces top-level props identity churn and removes duplicate setState writes on same-value transitions.
- This keeps behavior unchanged while improving maintainability and render-path stability.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/App.test.tsx src/app/runtime/threadActions.test.ts src/app/runtime/useThreadSelection.test.tsx`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
