---
name: formax-semantics-parity-workflow
description: Use when implementing or modifying behavior that must stay consistent across TUI and Web (mode/input/tool/replay/order). Require canonical semantics first, then TUI/Web adapters, then renderer-specific UI.
---

# formax-semantics-parity-workflow

## Goal

Ship cross-surface behavior once at the semantics layer, then project it into TUI and Web without semantic drift.

Use this workflow for any feature/change touching:
- mode (`normal` / `acceptEdits` / `plan`)
- input lifecycle (`approval` / `ask_user_question`)
- tool event sequencing/name stickiness
- replay ordering/gap recovery

## Where to change what

### 1) Semantic single source of truth
- `src/features/semantics/*`
  - `canonicalEvents.ts`
  - `transcriptProjection.ts`
  - `modeSemantics.ts`
  - `replModeTransition.ts`
  - `turnInputBuilder.ts`
  - `inputStateMachine.ts`

### 2) App-server contract emit/restore
- `src/app-server/turnRunner.ts`
- `src/app-server/server.ts`
- `src/app-server/threadStore.ts`
- `src/app-server/store/sessionEventReader.ts`
- `src/app-server/turn/inputStore.ts`

### 3) TUI adapter (renderer can differ, semantics cannot)
- `src/features/repl/controller/send.ts`
- `src/features/repl/controller/streaming.ts`
- `src/features/repl/useReplController.ts`

### 4) Web adapter (renderer can differ, semantics cannot)
- `apps/web-reference-react/src/eventAdapters.ts`
- `apps/web-reference-react/src/App.tsx`
- `apps/web-reference-react/src/store.ts`
- `apps/web-reference-react/src/turnEventCursor.ts`

### 5) Canonical docs to keep in sync
- `plans/app-server/INTERACTION-CONTRACT.md`
- `plans/app-server/PARITY-MATRIX.md`
- `plans/app-server/UI-SPEC.md`
- `plans/app-server/TODO.md`

## Patterns

### Pattern A: Semantic-first implementation order (mandatory)
1. Define/adjust contract semantics first (event shape, state transition, ordering key).
2. Implement shared semantics projector/reducer.
3. Update app-server emit/replay state so semantics are recoverable.
4. Update TUI adapter to consume shared semantics.
5. Update Web adapter to consume shared semantics.
6. Update renderer-only UI last.

### Pattern B: Ordering and replay discipline
- Use `replaySeq` as the primary ordering key.
- Treat `traceId/seq` as diagnostics and turn-local hints, not global order.
- On replay gap, rebuild from semantic snapshot/baseline; do not keep stitching stale incremental tails.

### Pattern C: Tool semantics discipline
- Keep `toolUseId -> toolName` sticky cache in semantics path.
- `update/end` without toolName must still render stable tool identity.
- Never depend on UI labels/copy to infer semantic state.

### Pattern D: Mode/Input transition discipline
- Mode changes are transitions, not presentation toggles.
- Input lifecycle must be a finite state machine (`pending -> resolved-*`), not ad-hoc UI flags.

## Tests to update

Minimum gate for cross-surface semantic changes:

1. Root type-check:
- `bun run type-check`

2. Semantics:
- `bun run test -- src/features/semantics/**`
- `bun run test -- src/features/semantics/__tests__/projectionParity.test.ts`

3. App-server contract paths:
- `bun run test -- src/app-server/turnRunner.test.ts src/app-server/server.test.ts src/app-server/turn/inputStore.test.ts`

4. Web semantic adapter paths (run in `apps/web-reference-react`):
- `bun run type-check`
- `bun run test -- src/App.test.tsx src/store.test.ts src/turnEventCursor.test.ts src/toolEventNormalizer.test.ts`

5. If committing:
- `codex review --uncommitted -c model="gpt-5.2" -c model_reasoning_effort="high"`

For fixture selection and required assertions, read:
- `references/fixtures-checklist.md`
- Use it before adding or editing parity fixtures.

## Guardrails

- Do not fix cross-surface bugs by patching only one renderer first.
- Do not add a second semantic state machine inside TUI or Web.
- Do not use UI text/copy as business-state input.
- Do not introduce new ordering rules outside the shared semantics layer.
- Do not ship semantic changes without parity tests and contract/doc updates.
