# 2026-03-04: Web reducer no-op guards

## What changed

- Updated `apps/web-reference-react/src/store.ts` to short-circuit no-op actions:
  - `set_active_thread`: skip state write when thread id unchanged and projection already null.
  - `set_active_turn`: skip when turn id unchanged.
  - `replace_logs`: skip when logs reference unchanged and projection already null.
  - `prepend_logs`: skip when incoming prepend list is empty.
  - `clear_pending_inputs`: skip when pending map already empty and no selected input.
  - `input_resolved`: skip when target input does not exist and selection does not reference it.
  - `set_selected_input`: skip when selected input id unchanged.

- Extended `apps/web-reference-react/src/store.test.ts` with no-op stability tests for the cases above.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - Removed completed Slice A from pending queue (TODO keeps only unfinished slices).

## Why

- UI runtime dispatches several housekeeping actions frequently.
- Without reducer no-op guards, semantically unchanged actions still create new state objects and trigger avoidable rerenders.
- The guards preserve behavior while improving state identity stability.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/store.test.ts`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
