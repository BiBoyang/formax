# 2026-03-04: Web runtime refs effect consolidation

## What changed

- Updated `packages/web-reference-react/src/app/runtime/useRuntimeRefs.ts`:
  - consolidated `useThreadSnapshotRefs` synchronization from five separate effects into one combined effect.
  - consolidated `useThreadCacheRefs` synchronization from two separate effects into one combined effect.

- Added `packages/web-reference-react/src/app/runtime/useRuntimeRefs.test.tsx`:
  - verifies snapshot refs stay synchronized after rerender.
  - verifies cache refs stay synchronized after rerender.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice F complete and retained only Slice G as pending.

## Why

- Multiple small effects were synchronizing related refs independently, creating avoidable effect scheduling overhead.
- Consolidating by concern keeps behavior identical while reducing hook complexity and per-render effect churn.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/app/runtime/useRuntimeRefs.test.tsx src/app/runtime/useRuntimeRefSync.test.tsx`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
