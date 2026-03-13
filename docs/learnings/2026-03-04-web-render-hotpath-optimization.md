# 2026-03-04: Web transcript render hot-path optimization

## What changed

- Optimized transcript derivation path in:
  - `packages/web-reference-react/src/components/TranscriptPane.tsx`
- Previously, active transcript rendering performed:
  - `filter` -> `slice` -> `map` (multiple arrays/passes) for each log update.
- Now, transcript view derivation is computed in one memoized pass:
  - calculates `visibleLogCount`
  - computes `hiddenInMemoryCount`
  - builds `renderedRows` directly from the windowed visible range.

- Added rendering optimization utility class:
  - `packages/web-reference-react/src/styles.css`
  - `.ui-content-auto { content-visibility: auto; contain-intrinsic-size: 140px; }`
  - applied to transcript row container to reduce off-screen render/layout work.

- Stabilized diff-pane callback identity:
  - `packages/web-reference-react/src/app/useAppRuntime.ts`
  - replaced inline `onRequestDiffPatch` closure with `useCallback` (`onRequestDiffPatch`) so `MemoWorktreeDiffPane` can avoid unnecessary re-renders.

## Why

- Long transcript updates are among the hottest render paths in this app.
- Reducing intermediate arrays and traversals lowers per-update CPU and GC pressure.
- `content-visibility` reduces off-screen work for long transcript threads.
- Stable callback identity is required for memoized child components to realize re-render savings.

## Guardrails

- Existing e2e performance gate (`test:perf:gate`) is used to detect regressions after this optimization.
- Queue and bundle guardrails remain active in CI.

## Follow-up (same day)

- Further render-tree decoupling in `TranscriptPane`:
  - extracted `TranscriptRowsList` as a memoized child to isolate heavy row mapping from unrelated feed state updates.
  - memoized serialized RPC error detail text (`JSON.stringify`) to avoid repeat serialization work on unrelated updates.
  - removed an unused `autoStick` dependency from the active-turn expansion effect to avoid redundant scheduling.

- Selector/index optimization in hooks:
  - `useTranscriptDisplayState` now builds a thread index `Map` and derives active thread/title from the indexed lookup.
  - `useThreadSelection` now uses `Map` + `Set` (`threadById`, `cwdOptionSet`) to avoid repeated linear lookups in sync effect.

- Thread sort parse optimization:
  - `selectSortedThreadViewModels` now precomputes `updatedAt` timestamps once per thread before sorting, avoiding repeated `Date.parse` calls inside comparator hot loops.
