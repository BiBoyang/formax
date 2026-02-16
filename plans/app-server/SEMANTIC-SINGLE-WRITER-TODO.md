# Semantic Single-Writer TODO

Goal: migrate REPL transcript writing to canonical semantics as the single source of truth, removing dual-write and tail-rewrite stopgaps.

## Core (must)

- [x] 1. Extend canonical events with user/system message events (`user_message`, `system_message`) and shared helpers.
- [x] 2. Extend transcript projection to materialize user/system segments and preserve deterministic ordering.
- [x] 3. Route send-path user append + slash/system sublines through canonical emitters (not direct transcript writes).
- [x] 4. Route local bash mode transcript output through canonical tool events, preserving existing UI shape.
- [x] 5. Convert streaming adapter path to canonical-first writes (legacy direct message writes removed for assistant/thinking/tool/footer).
- [x] 6. Convert `useReplController` render source to projection-derived messages for static/transient output.
- [x] 7. Remove canonical tail rewrite (`replaceTurnTailWithCanonicalMessages`) and related bridge flags.
- [x] 8. Remove transcript dedupe stopgaps tied to dual-write (`dedupeRenderableMessages` path).

## Hardening (should)

- [x] 9. Normalize abort/failed/interrupted footer semantics across providers.
- [x] 10. Align session-save persistence checks with canonical output ordering assumptions.
- [x] 11. Add regression tests for no-dup tool rows, no-lost assistant text, and stable loading/thinking behavior.

## Validation

- [x] A. Targeted tests for changed files pass.
- [x] B. `bun run type-check` passes.
- [x] C. `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="high"` passes (timeout >= 1200000).
