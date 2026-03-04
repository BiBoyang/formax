# 2026-03-04: Web markdown Shiki runtime slimming

## Context

`apps/web-reference-react` markdown highlighting used top-level `shiki` runtime loading. Production build emitted broad language/theme fan-out chunks plus WASM/runtime artifacts that were not aligned with reference-client needs.

## Decision

Introduce a shared markdown highlighter runtime:

- New module: `apps/web-reference-react/src/app/core/markdownShikiRuntime.ts`
- Use `shiki/core` + `shiki/engine/javascript` + `github-light` theme
- Restrict lazy language loading to a curated set used in common code fences
- Normalize aliases (`js -> javascript`, `ts -> typescript`, `sh -> bash`, etc.)
- Fallback to `text` when unsupported labels are encountered
- Keep both main-thread fallback and worker highlighting paths on the same runtime contract

## Why

- Reduce bundle noise from full `shiki` entrypoint fan-out.
- Avoid pulling Oniguruma WASM path for this reference client.
- Keep behavior stable: markdown still renders, highlighting still works for common languages, unsupported languages degrade gracefully to plain text.

## Validation

- `npm --prefix apps/web-reference-react run type-check`
- `npm --prefix apps/web-reference-react run test -- src/app/core/markdownService.test.ts src/app/core/markdownShikiRuntime.test.ts src/components/MarkdownRenderer.test.tsx`
- `npm --prefix apps/web-reference-react run build`

Build comparison (before vs after):

- Removed the previous broad `shiki` language/theme + wasm fan-out.
- Now emits only curated language/theme runtime chunks plus a dedicated worker bundle.

