# 2026-03-05: Web runtime composition polish (Slice R)

## What changed

- Updated `apps/web-reference-react/src/app/runtime/useRuntimeActionsBundle.ts`:
  - replaced flat 25+ args signature with grouped deps:
    - `core` (request/dispatch/log)
    - `thread` (thread refs + thread actions deps)
    - `composer` (composer state + composer action deps)
  - fixed archive-op tracking callback variable naming to avoid shadowing and preserve pending-op bookkeeping.

- Updated `apps/web-reference-react/src/app/runtime/useRuntimeRefSync.ts`:
  - extended to synchronize additional refs in one place:
    - `activeTurnIdRef`
    - `pendingInputsRef`
    - `sortedThreadsRef`
  - keeps existing logs cache synchronization behavior unchanged.

- Updated `apps/web-reference-react/src/app/useAppRuntime.ts`:
  - switched `useRuntimeActionsBundle` callsite to grouped deps API.
  - removed three local one-line ref-sync effects and delegated to `useRuntimeRefSync`.
  - removed local notice auto-dismiss effect.

- Updated `apps/web-reference-react/src/app/runtime/useRuntimeViewState.ts`:
  - added notice auto-dismiss effect (`2600ms`) within view-state ownership.

- Added/updated tests:
  - new: `apps/web-reference-react/src/app/runtime/useRuntimeViewState.test.tsx`
  - updated: `apps/web-reference-react/src/app/runtime/useRuntimeRefSync.test.tsx`

## Why

- `useRuntimeActionsBundle` flat args list was becoming a maintenance hotspot and obscured ownership boundaries.
- Ref synchronization effects were split across `useAppRuntime`, increasing cognitive load for state-flow tracing.
- Notice auto-dismiss is a view-state behavior; colocating it with view-state ownership makes boundaries clearer.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/app/runtime/threadActions.test.ts src/app/runtime/composerActions.test.ts src/app/runtime/useRuntimeRefSync.test.tsx src/app/runtime/useRuntimeViewState.test.tsx src/app/runtime/integration/threadArchiving.test.ts src/app/runtime/orchestrator/runtimeRegressions.integration.test.ts src/App.test.tsx`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
