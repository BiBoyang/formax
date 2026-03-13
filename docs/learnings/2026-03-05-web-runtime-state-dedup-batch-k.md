# 2026-03-05: Web runtime state-dedup batch (Slice K)

## What changed

- Updated `packages/web-reference-react/src/components/TranscriptPane.tsx`:
  - added `NEAR_BOTTOM_THRESHOLD_PX` + `isViewportNearBottom(viewport)` shared helper for scroll-threshold calculations.
  - introduced shared state-write helpers (`setAutoStickState`, `setNearBottomState`, `syncViewportScrollState`) to dedupe repeated `autoStick/isNearBottom` updates.
  - kept scroll-event timing semantics by only syncing `isNearBottom` inside frame flush / initial mount paths (not directly in burst scroll handler).
  - added `resetRenderLimit` callback with no-op guard and reused it in both thread-switch and active-turn reset paths.

- Updated `packages/web-reference-react/src/app/useAppRuntime.ts`:
  - added `areStringArraysEqual` helper and `setHiddenGroupCwdsStable` wrapper.
  - switched hidden-group updates (`thread/group/hide` + `createThreadDataOps` injection) to value-stable setter to avoid no-op state writes.

- Updated `packages/web-reference-react/src/components/LeftRail.tsx`:
  - memoized active-thread lookup by `threads + activeThreadId`.
  - added no-op guards for rename-dialog state transitions (`open/close/success`) to reduce redundant state churn.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice K complete and generated Slice L.

## Why

- Scroll and UI state paths still had duplicate write patterns that triggered unnecessary rerenders in long transcript sessions.
- Hidden group and rename-dialog updates could dispatch state updates even when values were unchanged.
- This batch keeps semantics unchanged while reducing update churn across hot UI paths.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/components/TranscriptPane.test.tsx src/components/LeftRail.test.tsx src/App.test.tsx`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
