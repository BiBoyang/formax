# REPL Session Decomposition v2 Milestone (2026-03-13)

## Scope
This milestone closes the v2 "de-rust" plan for `useReplController` and the session save path.
The goal was to reduce cross-domain coupling and effect-ordering risk without changing user-visible behavior.

## Baseline vs Current
Baseline values are from the v2 kickoff plan.

| Metric | Baseline | Current | Delta |
| --- | ---: | ---: | ---: |
| `packages/core/src/features/repl/useReplController.ts` lines | 1219 | 598 | -621 (-50.9%) |
| `packages/core/src/features/repl/sessionSave/writer.ts` lines | 503 | 233 | -270 (-53.7%) |
| `packages/core/src/features/repl/sessionSave/reader.ts` lines | 679 | 541 | -138 (-20.3%) |
| `__*TestOnly` exports in `packages/core/src/features/repl/**` | 37 | 0 | -37 |

## What Landed

### Phase 0: characterization + pure helper migration
- Added protective tests to lock ordering/guard behavior before deeper refactors.
- Moved pure helper logic out of `useReplController` into domain modules.

### Phase 1: state-owner boundaries + session I/O layering
- Grouped refs by ownership (`canonical`, `turnFlow`, `runtime`, `session`, `turnStreaming`).
- Session reader/writer cleanup:
  - Removed `__readerTestOnly` / `__writerTestOnly` export surfaces.
  - Split and stabilized session read/write internals behind focused modules.

### Phase 2: coupling hotspot decomposition
- Extracted canonical event handling into dedicated hook/module boundaries.
- Extracted session persistence/lifecycle/event recorder hooks with ordering-safe behavior.

### Phase 3: turn orchestration convergence
- Structured `runSendAction` inputs into typed grouped contexts.
- Structured `runAbortAction` wiring into grouped `refs/callbacks/runtime` inputs.
- Kept top-level `ReplController.state/actions` contract unchanged.

## Key Commit Chain
Chronological range used for this milestone:

- `63999e5` refactor(repl): extract transcript surface action hook
- `bf4b902` refactor(repl): extract canonical event handler hook
- `bf661a0` refactor(repl): structure runSendAction parameter contexts
- `ee2130c` test(repl): add turnActions guard and abort coverage
- `e26281f` refactor(session-save): reduce test-only export surface
- `0a52213` test(repl): add module tests for extracted action hooks
- `cd08d2f` test(repl): cover canonical and writer lifecycle hooks
- `cd66bf1` test(repl): add session persistence hook coverage
- `61dfa3f` refactor(repl): move bash tail wiring into turn actions
- `2f4fb8d` refactor(repl): extract session reset action hook
- `876d423` refactor(repl): extract config dialog injection hook
- `3abd8cf` refactor(session-save): drop reader test-only export
- `b7b1baa` refactor(session-save): drop writer test-only export
- `fc9ac04` refactor(repl): extract session action wiring hook
- `3acab35` refactor(repl): group reset refs in session reset hook
- `c58ee4c` refactor(repl): remove useReplController test-only exports
- `945b79c` refactor(repl): group turn streaming refs
- `98fcb52` refactor(repl): group streaming refs in hook API
- `c8a6f8a` refactor(repl): group abort action wiring inputs
- `9dd2533` test(repl): cover abort fallback transition path

## Contract/Behavior Status
- `ReplController` external shape preserved.
- Session JSONL wire shape preserved.
- No intentional UI copy/layout/hotkey semantic changes in this milestone.

## Verification Gate (Passed)
Executed as milestone close gate:

- `bun run test -- packages/core/src/features/repl/useReplController.test.tsx`
- `bun run test -- packages/core/src/features/repl/sessionSave/`
- `bun run test -- packages/core/src/features/repl/controller/`
- `bun run type-check`
- `bun run ui:boundaries`
- `bun run check:partial-stage`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`

## Remaining Non-Blocking Polish
- Optional: further reduce tiny residual wiring wrappers in `useReplController` if they become noisy again.
- Optional: continue to prefer grouped inputs when touching cross-domain actions/hooks.
- No blocking de-rust items remain for v2 objectives.
