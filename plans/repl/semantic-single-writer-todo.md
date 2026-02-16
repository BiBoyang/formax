# REPL Semantic Single-Writer TODO

Status: `active`
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
Status: `pending`
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

### Slice 4: Invariant-Focused Regression Tests
Status: `pending`
Files:
- `src/screens/repl/surfaceSmoke.test.tsx`
- `scripts/surface-screen-model-smoke.tsx` (only if needed)

Changes:
- Replace case-by-case bug tests with invariants:
  - same `toolUseId` appears once in final transcript
  - no `running` tool rows after turn completion

Acceptance:
- Fewer, stronger tests (avoid one-test-per-bug growth).

## Execution Order
1. Slice 1
2. Slice 2
3. Slice 3
4. Slice 4

## Done Criteria
- No turn-end patch logic required for normal tool turns.
- Canonical path is the only semantic writer for tool transcript rows.
- Surface tests pass with invariant coverage.
