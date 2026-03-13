# 2026-03-05: Web transcript render-view single-filter path

## What changed

- Updated `packages/web-reference-react/src/components/TranscriptPane.tsx`:
  - refactored `transcriptRenderView` computation to build `visibleItems` in a single pass over `logs`.
  - replaced the prior two-pass full-log scan (`count visible` + `build rendered rows`) with:
    - one full scan to collect visible items,
    - one bounded scan over the render window to build rows.
  - preserved existing turn-boundary semantics (first visible row in a sliced window can still be marked as a new turn boundary).

- Existing tests in `packages/web-reference-react/src/components/TranscriptPane.test.tsx` continue to lock render-window and turn-boundary behavior.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice J complete and generated Slice K.

## Why

- Transcript rendering previously evaluated visibility predicate across the full log list twice per recomputation.
- This refactor keeps behavior unchanged while reducing duplicate full-list scans in a hot render path.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/components/TranscriptPane.test.tsx src/App.test.tsx`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
