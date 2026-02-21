---
name: formax-surface-reset-workflow
description: Use when changing REPL clear/reset/resume/surface behavior (onClearTerminal, transcriptSeq remount, Ink Static paths, Ctrl+O/Ctrl+E transitions). Enforces single-owner reset transaction and prevents black-screen/flicker/duplicate-row regressions.
---

# Formax Surface Reset Workflow

## Goal

When touching REPL transcript surface behavior, keep a single, serialized reset transaction so Ink `Static` stays in sync with terminal state.

This workflow prevents:
- black screen after `/resume`
- stale/duplicated rows after `Ctrl+O`/`Ctrl+E` or compact transitions
- clear/remount race caused by ad-hoc clear calls

## Trigger Conditions (Use This Skill)

Use this skill whenever the change touches any of:
- `onClearTerminal`, `clearTerminal`, `resetInkStaticOutputForStdout`
- `replaceTranscript`, `queueTranscriptSurfaceReplace`, `resetTranscriptSurface`, `queueTranscriptSurfaceReset`, `surfaceOpQueueRef`
- `transcriptSeq` remount behavior in `ReplTranscript` / `ExpandedReplTranscript`
- `/resume`, `/clear`, compact/view transitions touching transcript surface
- files under:
  - `src/features/repl/controller/ui/`
  - `src/features/repl/controller/session/`
  - `src/features/repl/useReplController.ts`
  - `src/screens/repl/`
  - `src/legacy/runLegacyCli.tsx`

## Non-Negotiable Rules

1. Single owner:
   - Transcript replacement/reset must go through shared transaction helpers:
     - content replacement: `replaceTranscript` -> `queueTranscriptSurfaceReplace`
     - pure reset/remount: `resetTranscriptSurface` -> `queueTranscriptSurfaceReset`
   - Do not add a second independent clear/remount path.

2. Transaction semantics:
   - Treat reset as one transaction (`clear + remount + macrotask settle`), not scattered side effects.
   - Avoid fire-and-forget clear on paths where ordering matters.

3. No duplicate clear sources:
   - In legacy runner, avoid stacking `replInstance.clear()` with ANSI clear if it can race with repaint.

4. Static contract awareness:
   - Ink `Static` is append-only; non-append correction requires explicit reset/remount transaction.

## Workflow

1. Scope the change
   - Identify which path is changing (`/resume`, `/clear`, Ctrl+O/Ctrl+E, compact boundary, etc.).
   - Confirm whether it already routes through `resetTranscriptSurface`.

2. Route to canonical reset path
   - If not routed, wire the path to shared reset transaction helpers instead of local sequencing hacks.
   - Keep behavior parity; avoid introducing new UI copy/interaction.

3. Lock with targeted tests
   - Add/extend regression tests for ordering and surface reset usage.
   - Prefer small focused tests over broad rewrites.

4. Validate surface parity
   - Run targeted tests and at least one real-surface smoke path for touched behavior.

## Minimum Test Checklist

- `bun run test -- src/features/repl/controller/ui/surfaceReset.test.ts`
- `bun run test -- src/features/repl/useReplController.test.tsx -t "resume|clear|compact"`
- `bun run test -- src/screens/repl/surfaceSmoke.test.tsx`
- `bun run type-check`

If change touches compact/expanded toggles broadly, also run:
- `bun run test:surface-screen-model`

## Red Flags (Stop and Rework)

- New direct calls to `onClearTerminal` inside feature flows that already have reset queue access.
- `/clear` or `/resume` paths that bypass `replaceTranscript`.
- Per-feature bespoke clear/remount ordering logic.
- Fixes that only patch one path but bypass shared transaction owner.
- “Works in Vitest but fails in real TTY” without running surface smoke.

## References

- `pitfalls.md` (`/clear`, compact+Ctrl+O, resume black screen sections)
- `docs/pitfalls/repl-transcript-surface-handoff-pitfall.md`
- `docs/pitfalls/repl-transcript-static-rootcause.md`
