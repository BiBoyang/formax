# 2026-03-04: Web runtime ref sync scope reduction

## What changed

- Updated `packages/web-reference-react/src/app/runtime/useRuntimeRefSync.ts`:
  - removed ref-sync responsibilities already covered by `useThreadSnapshotRefs` (`activeThreadIdRef`, `stateLogsRef`, `selectedInputIdRef`).
  - kept only runtime-specific responsibilities:
    - sync `logsByThreadIdRef`
    - mirror active thread logs into `logsByThreadId` cache via `setLogsByThreadId`.

- Updated `packages/web-reference-react/src/app/useAppRuntime.ts` callsite to match narrowed hook contract.

- Added `packages/web-reference-react/src/app/runtime/useRuntimeRefSync.test.tsx`:
  - verifies `logsByThreadIdRef` synchronization and active-thread cache mirror behavior.
  - verifies no mirror writes occur when active thread is null.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice E complete and regenerated next pending slices.

## Why

- The previous hook contract duplicated ref synchronization already handled elsewhere, adding unnecessary effects and cognitive overhead.
- Reducing the hook to one clear responsibility improves maintainability and avoids redundant work on each render.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/app/runtime/useRuntimeRefSync.test.tsx src/App.test.tsx`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
