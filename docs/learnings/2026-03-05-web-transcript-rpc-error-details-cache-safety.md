# 2026-03-05: Web transcript RPC error details cache safety

## What changed

- Updated `apps/web-reference-react/src/components/TranscriptPane.tsx`:
  - added `formatRpcErrorDetails(error)` as the shared formatter for RPC error details.
  - added a bounded module-level cache (`RPC_ERROR_DETAILS_CACHE_LIMIT = 80`) for formatted error details.
  - changed cache-key generation to be content-sensitive for `error.data` payloads (object payloads key by serialized content, not identity).
  - kept `null` and `undefined` payload data as distinct cache-key branches to prevent stale entry reuse.
  - switched `TranscriptFeed` error-detail memoization to call `formatRpcErrorDetails`.

- Updated `apps/web-reference-react/src/components/TranscriptPane.test.tsx`:
  - added coverage that equivalent payload objects reuse full error serialization work.
  - added regression for in-place payload mutation to ensure cache invalidation.
  - added regression for `data: undefined` vs `data: null` key separation.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice I complete and generated Slice J.

## Why

- Error-detail rendering used repeated JSON serialization on repeated renders.
- A naive identity-based cache introduced stale detail risk when payload objects were mutated in place.
- Keeping cache keys content-sensitive and distinguishing `null`/`undefined` preserves correctness while still reducing repeated full-error serialization on repeated payload shapes.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/components/TranscriptPane.test.tsx src/App.test.tsx`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
