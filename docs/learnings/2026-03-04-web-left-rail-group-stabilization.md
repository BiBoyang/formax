# 2026-03-04: Web LeftRail group derivation stabilization

## What changed

- Updated `apps/web-reference-react/src/components/LeftRail.tsx`:
  - introduced `LeftRailThreadGroup` derivation with precomputed `folderName`, `sortLabel`, and `sortPath`.
  - replaced repeated comparator normalization work with one-time per-group key computation before sorting.
  - unified cwd normalization via `normalizeCwdPath` and reused it in folder label derivation.
  - updated relative-time rendering to compute `nowMs` once per render and pass it into `relativeTime`.

## Why

- LeftRail group sorting previously normalized/parsed cwd values repeatedly inside comparator paths.
- Precomputing sort metadata and folder labels reduces repeated string processing during thread-group rendering.
- Sharing a single `nowMs` per render avoids repeated `Date.now()` calls for each thread row.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/components/LeftRail.test.tsx`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
