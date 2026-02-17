# REPL Semantic Single-Writer TODO

Status: `completed` (Phase 1-3 completed)
Owner: `codex`
Goal: remove patch-style transcript fixes by converging to a single semantic write path.

## Guardrails
- Each slice changes at most 1-3 core files (tests excluded).
- No mixed-purpose commits (one intent per commit).
- Every slice must have focused tests and one manual smoke command.

## Target Architecture
- Streaming layer emits canonical events only.
- Transcript state is finalized once per turn from canonical projection.
- Renderer is presentation-only (no semantic dedupe/recovery logic).

## Slice Plan

### Slice 1: Stabilize Tool Message Identity
Status: `completed`
Files:
- `src/features/repl/controller/streaming.ts`
- `src/features/repl/useReplController.ts`
- `src/features/repl/controller/streaming.test.tsx`

Changes:
- Introduce `toolUseId -> toolMessageId` stable mapping in streaming path.
- Ensure tool lifecycle (`start/input/update/end`) always targets the same message id.
- Clear mapping on `complete/error/reset`.

Acceptance:
- No duplicate tool row creation for repeated `tool_start`/`tool_input` updates.
- Existing streaming tests pass.

Result:
- Implemented in `streaming.ts` + `useReplController.ts`.
- Validated via targeted Vitest + type-check.

### Slice 2: Canonical-Only Tool Streaming
Status: `completed`
Files:
- `src/features/repl/controller/streaming.ts`
- `src/features/repl/useReplController.ts`
- `src/features/repl/controller/streaming.test.tsx`

Changes:
- When canonical bridge is active, tool events do not call `setMessages` directly.
- Keep loading/status updates, but tool transcript rows come from canonical projection.

Acceptance:
- Tool rows still render normally.
- `Bash(ls|pwd)` no longer depends on post-turn surface resets.

Result:
- `streaming.ts` no longer writes tool rows to `messages` when canonical bridge is active.
- canonical bridge regression test now asserts no legacy `assistant/tool` rows are appended.

### Slice 3: Remove Turn-End Surface Reconcile Patch
Status: `completed`
Files:
- `src/features/repl/useReplController.ts`
- `src/screens/repl/transcript.tsx`
- `src/screens/repl/transcript.test.tsx`

Changes:
- Remove any turn-end forced `resetTranscriptSurface()` used as transcript patching.
- Keep explicit reset only for true surface operations (`/clear`, resume, new session).
- Remove transient/static dedupe logic if it becomes unnecessary.

Acceptance:
- No duplicate tool rows without forced turn-end reconcile.
- Transcript tests validate single source behavior.

Result:
- Verified no turn-end `resetTranscriptSurface()` reconcile path remains in normal tool turn flow.
- `transcript.tsx` remains presentation-only (no transient/static semantic recovery patching).

### Slice 4: Invariant-Focused Regression Tests
Status: `completed`
Files:
- `src/screens/repl/surfaceSmoke.test.tsx`
- `scripts/surface-screen-model-smoke.tsx` (only if needed)

Changes:
- Replace case-by-case bug tests with invariants:
  - same `toolUseId` appears once in final transcript
  - no `running` tool rows after turn completion

Acceptance:
- Fewer, stronger tests (avoid one-test-per-bug growth).

Result:
- Added forced-Static invariant test in `surfaceSmoke.test.tsx` to assert one final tool row per `toolUseId`.
- Added canonical-bridge invariant in `streaming.test.tsx` to prevent legacy transcript writes for tool/explore paths.

## Phase 2 Slice Plan (5-8)

### Slice 5: Canonical Tool Metadata Hardening
Status: `completed`
Files:
- `src/features/semantics/core/canonicalEvents.ts`
- `src/features/semantics/adapters/streamCanonicalAdapter.ts`
- `src/features/semantics/projection/transcriptProjection.ts`
- `src/features/repl/controller/canonicalTurnMessages.ts`

Changes:
- Ensure canonical pipeline carries structured tool metadata (`input/result/middleLines/transcriptLines/nestedTools/usage`).
- Keep edge-case-safe merge rules (empty arrays should not wipe prior detail lines).
- Keep Task summary/transcript parsing consistent between streaming and canonical rendering.

Acceptance:
- Task rows render consistently in streaming/completed/replay paths.
- Empty `middleLines` updates do not clear existing visible detail lines.

Result:
- Canonical tool metadata (`input/result/middleLines/transcriptLines/nestedTools/usage`) now flows through event -> projection -> render.
- Task parsing and rendering are unified via shared helper; canonical/non-canonical summary behavior is aligned.
- Empty `middleLines` no longer clears previously visible detail lines in projection.

### Slice 6: Remove Legacy Completed-Tool Fallback Cache
Status: `completed`
Files:
- `src/features/repl/useReplController.ts`
- `src/features/repl/controller/canonicalTurnMessages.ts`
- `src/features/repl/useReplController.test.tsx`

Changes:
- Remove `completedToolMessageByToolUseIdRef` fallback merge once canonical projection is sufficient.
- Keep final-tail replacement logic purely canonical (legacy rows only for id/timestamp compatibility when unavoidable).

Acceptance:
- Final tool rows are produced from canonical messages without fallback cache dependency.
- No duplicate/lost tool rows across normal turn completion and abort paths.

Result:
- Removed `completedToolMessageByToolUseIdRef` from REPL controller + streaming path.
- Final-tail merge now relies on canonical rows plus tail legacy rows only (no out-of-band cache merge).
- Added timestamp normalization for canonical tool rows when legacy timestamps are unavailable.

### Slice 7: Move Edit Patch Metadata to Semantic Write-Time
Status: `completed`
Files:
- `src/features/repl/controller/streaming.ts`
- `src/features/semantics/adapters/streamCanonicalAdapter.ts`
- `src/features/semantics/projection/transcriptProjection.ts`
- `src/features/repl/controller/canonicalTurnMessages.ts`

Changes:
- Compute `patchStartLineNumber` only once in write-time path (not in render mapping).
- Persist patch metadata in canonical tool events/segments so replay/final render has no sync FS fallback.

Acceptance:
- `canonicalTurnMessages` does not perform expensive patch-line recomputation.
- Edit presenter still receives stable `patchStartLineNumber` for completed edits.

Result:
- `streaming.ts` now enriches canonical `tool_end` events for `Edit` with `patchStartLineNumber`.
- Projection carries patch metadata through to final canonical tool rows.
- `useReplController` no longer computes edit patch metadata during final-tail merge.

### Slice 8: Semantic Fixture Gate for Complex Tool Turns
Status: `completed`
Files:
- `src/features/semantics/__tests__/projectionParity.test.ts`
- `src/features/repl/controller/canonicalTurnMessages.test.ts`
- `src/features/repl/controller/streaming.test.tsx`

Changes:
- Add fixture-level invariants for:
  - Task: background start vs done vs error
  - Edit: patch metadata continuity
  - mixed tool updates with empty/non-empty detail arrays

Acceptance:
- One fixture suite locks semantic order + metadata parity across streaming and final projection.
- Future regressions show up as fixture mismatches, not ad-hoc screenshot bugs.

Result:
- Added complex parity fixture covering Task + Edit + mixed `middleLines` updates in `projectionParity.test.ts`.
- Added canonical bridge regression for empty `middleLines` updates and Edit patch metadata continuity in `streaming.test.tsx`.
- Added canonical tool mapping regression for explicit `resultLines=0` handling in `canonicalTurnMessages.test.ts`.

## Execution Order
1. Slice 1
2. Slice 2
3. Slice 3
4. Slice 4
5. Slice 5
6. Slice 6
7. Slice 7
8. Slice 8

## Done Criteria
- No turn-end patch logic required for normal tool turns.
- Canonical path is the only semantic writer for tool transcript rows.
- Surface tests pass with invariant coverage.
- Legacy completed-tool fallback cache is removable.
- Render path does not perform per-message sync FS computation for semantic fields.

## Phase 3 Slice Plan (9-12)

### Slice 9: Remove Residual Patch Branches
Status: `completed`
Files:
- `src/features/repl/useReplController.ts`
- `src/features/repl/controller/canonicalTurnMessages.ts`
- `src/features/repl/useReplController.test.tsx`

Changes:
- Audit turn-final merge path for legacy-only rescue branches that no longer affect runtime behavior.
- Delete dead/duplicated merge branches where canonical messages are already authoritative.
- Keep only immutable-row protections required by Ink Static append semantics.

Acceptance:
- No behavior change for successful/failed/aborted turns.
- Canonical finalization logic is shorter and has fewer conditional merge paths.

Result:
- Removed legacy per-field toolInfo fallback merge in `useReplController`; canonical tool metadata is now authoritative at turn-finalization time.
- Kept only stable-row preservation (`id/timestamp/content`) for tail legacy tool rows to avoid Ink Static append artifacts.
- Removed redundant tail-tool set bookkeeping in final-tail merge path.

### Slice 10: Enforce Single-Writer Boundaries
Status: `completed`
Files:
- `src/features/repl/controller/streaming.ts`
- `src/features/repl/useReplController.ts`
- `src/features/repl/controller/streaming.test.tsx`

Changes:
- Make direct transcript writes explicitly scoped to non-canonical mode.
- Add invariant assertions/tests that canonical bridge mode never writes semantic tool rows through legacy `setMessages` paths.

Acceptance:
- Tool transcript rows are produced only by canonical projection when bridge is active.
- Regression test fails on any reintroduced dual-write path.

Result:
- Added explicit `canWriteLegacyTranscript` gate in `streaming.ts`; tool lifecycle transcript writes now flow through one guarded legacy-update helper.
- Canonical bridge mode continues to process semantic events while blocking legacy tool row writes, preventing dual-write drift.
- Added canonical Task lifecycle regression test to assert no legacy transcript mutation while canonical tool metadata still updates correctly.

### Slice 11: Unify Tool-Turn Finalize Ordering
Status: `completed`
Files:
- `src/features/repl/controller/canonicalTurnMessages.ts`
- `src/features/repl/useReplController.ts`
- `src/features/repl/controller/canonicalTurnMessages.test.ts`

Changes:
- Consolidate turn-tail replacement ordering rules (normal/failed/aborted) into one helper path.
- Remove duplicated insertion/index logic between controller and canonical message helpers.

Acceptance:
- Canonical final rows keep deterministic order across all outcomes.
- No controller-local tail merge algorithm remains.

Result:
- Extracted turn-tail insertion rules (`completed` / `aborted` / `failed`) into `resolveCanonicalTurnTailInsertIndex` in `canonicalTurnMessages.ts`.
- `useReplController` now reuses the shared helper, removing controller-local outcome-specific insert-position branching.
- Added helper-level regression tests covering completed/aborted/failed insertion indices.

### Slice 12: Add Pre-Review Gate (Reduce Review Loops)
Status: `completed`
Files:
- `scripts/`
- `AGENTS.md`
- `plans/repl/semantic-single-writer-todo.md`

Changes:
- Add a lightweight pre-review check command sequence for semantic REPL changes.
- Require targeted tests + one deterministic surface smoke before `codex review`.

Acceptance:
- Fewer review cycles caused by avoidable local misses.
- Process is documented and reproducible.

Result:
- Added `scripts/repl-semantic-pre-review.mjs` and `package.json` script `test:repl-semantic-gate`.
- Gate sequence now standardizes: partial-stage check -> targeted REPL semantic tests -> deterministic surface smoke -> type-check/boundaries.
- Documented the gate in `AGENTS.md` as a required pre-review step for REPL semantic-flow changes.
