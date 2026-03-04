# 2026-03-04: Web entry chunk split + markdown e2e hardening

## Context

After markdown runtime slimming, `apps/web-reference-react` build still emitted a large entry chunk (`index-*.js` around 622 KB minified), which increased first-load parse/execute pressure.

## Changes

1. Entry chunk split (Vite Rollup manual chunks)

- File: `apps/web-reference-react/vite.config.ts`
- Added `build.rollupOptions.output.manualChunks`:
  - `vendor-react`: `react`, `react-dom`, `scheduler`
  - `vendor-radix`: `@radix-ui/*`
  - `vendor-icons`: `lucide-react`
  - `vendor-markdown`: `marked`, `dompurify`

2. Markdown worker/fallback e2e coverage

- Added `apps/web-reference-react/e2e/markdown-render-worker.spec.js`
- Covers:
  - worker success path renders fenced code + copy button
  - worker error path falls back to main-thread highlight path
  - copy button still writes code content on both paths

3. Docs sync

- Updated `apps/web-reference-react/README.md` e2e list.

## Build impact

From local build logs:

- Before: `index-*.js` around `622 KB` minified (single large entry chunk warning).
- After: entry split into:
  - `index-*.js` around `254 KB`
  - `vendor-react-*.js` around `216 KB`
  - plus focused vendor chunks (`vendor-radix`, `vendor-markdown`, `vendor-icons`)
- Result: large entry chunk warning removed.

## Validation

- `npm --prefix apps/web-reference-react run type-check`
- `npm --prefix apps/web-reference-react run test -- src/app/core/markdownService.test.ts src/app/core/markdownShikiRuntime.test.ts src/components/MarkdownRenderer.test.tsx src/App.test.tsx`
- `npm --prefix apps/web-reference-react run test:e2e -- e2e/markdown-render-worker.spec.js`
- `npm --prefix apps/web-reference-react run build`
