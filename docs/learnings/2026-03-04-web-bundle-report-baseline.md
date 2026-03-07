# 2026-03-04: Web bundle report script + baseline

## What was added

- New script: `apps/web-reference-react/scripts/report-bundle.mjs`
- New npm script:
  - `npm --prefix apps/web-reference-react run perf:bundle:report`
  - `npm --prefix apps/web-reference-react run perf:bundle:baseline:write`
  - `npm --prefix apps/web-reference-react run perf:bundle:baseline:compare`
  - `npm --prefix apps/web-reference-react run perf:bundle:baseline:check`
  - `npm --prefix apps/web-reference-react run perf:bundle:baseline:sync`
  - `npm --prefix apps/web-reference-react run perf:bundle:baseline:check:ci`

The report reads `dist/index.html` and `dist/assets/*`, then prints:

- entry assets referenced by `index.html`
- top-N largest assets (raw + gzip)
- total JS/CSS footprint summary

## Current baseline (local run)

Command:

```bash
npm --prefix apps/web-reference-react run build
npm --prefix apps/web-reference-react run perf:bundle:report
npm --prefix apps/web-reference-react run perf:bundle:baseline:write
npm --prefix apps/web-reference-react run perf:bundle:baseline:compare
npm --prefix apps/web-reference-react run perf:bundle:baseline:check
```

Observed key numbers:

- Entry assets:
  - `index-*.js`: ~249 KB raw / ~71.5 KB gzip
  - `vendor-react-*.js`: ~211 KB raw / ~67.1 KB gzip
  - `vendor-radix-*.js`: ~77.6 KB raw / ~22.9 KB gzip
  - `vendor-markdown-*.js`: ~63.3 KB raw / ~21.0 KB gzip
  - `index-*.css`: ~72.9 KB raw / ~12.6 KB gzip
- Bundle summary (all emitted JS/CSS assets):
  - total: ~3.16 MB raw / ~575 KB gzip
  - js: ~3.09 MB raw / ~562 KB gzip
  - css: ~72.9 KB raw / ~12.6 KB gzip

## Notes

- The assets list includes chunks emitted for both main app graph and markdown worker graph.
- This is expected after introducing worker-side markdown rendering.
- For startup performance tracking, prioritize `Entry Assets` section; for overall payload monitoring, use `Bundle Summary`.
- Baseline file path defaults to `apps/web-reference-react/perf/web-reference-react-bundle-baseline.json` (repo root).
- JSON mode outputs a single valid JSON document:
  - `--json`
  - `--json --compare-baseline` returns `{ current, baseline }`.
- CI guard mode:
  - `--enforce-baseline` exits non-zero on growth beyond configured thresholds.
  - defaults are strict (`0` growth) for `total bytes` and `entry bytes`.
  - CI path now uses a small tolerance (`1024` bytes for `total`, `1024` bytes for `entry`).
- Baseline sync mode:
  - `--verify-baseline-sync` compares current build bytes against committed baseline snapshot.
  - used as a guardrail to catch code changes that forgot to update `apps/web-reference-react/perf/web-reference-react-bundle-baseline.json`.
