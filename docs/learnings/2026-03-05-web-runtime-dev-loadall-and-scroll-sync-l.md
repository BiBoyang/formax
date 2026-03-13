# 2026-03-05: Web runtime dev-load-all + scroll-sync stabilization (Slice L)

## What changed

- Updated `packages/web-reference-react/src/app/useAppRuntime.ts`:
  - replaced direct dev-load-all state writes with idempotent helpers:
    - `resetDevLoadAllState`
    - `startDevLoadAllState`
  - updated thread-switch reset, manual trigger, and error/terminal paths to reuse these helpers.
  - this removes redundant writes when values are already at target state.

- Updated `packages/web-reference-react/src/components/TranscriptPane.tsx`:
  - removed redundant `autoStick` ref-sync effect because refs are now updated through the single `setAutoStickState` write path.
  - keeps existing behavior while reducing one per-render sync effect.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice L complete and generated Slice M.

## Why

- Dev load-all control-flow had repeated tri-state writes even when values were unchanged.
- Transcript auto-stick refs were being synchronized both at write time and by an extra effect.
- The new path keeps semantics intact and reduces state/update overhead in hot runtime loops.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/components/TranscriptPane.test.tsx src/components/LeftRail.test.tsx src/App.test.tsx`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
