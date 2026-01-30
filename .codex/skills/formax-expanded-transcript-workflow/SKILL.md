---
name: formax-expanded-transcript-workflow
description: Use when implementing/debugging Ctrl+O Expanded Transcript (second view) and thinking persistence in the REPL.
---

# formax-expanded-transcript-workflow

## Goal

Align Formax’s `ctrl+o` behavior with Claude Code’s “Expanded Transcript” second view:
- Default transcript stays low-noise (no thinking text).
- Expanded Transcript shows richer details (thinking blocks + expanded tool/task output).
- Thinking is **never fabricated**; it only appears when the model emits `thinking_delta`.
- Expanded Transcript is read-only (no input prompt); `ctrl+o` toggles back.

## Where to change what

- Key handling: `src/screens/repl/hotkeys.ts` (toggle rules, prompt/overlay guards)
- View wiring + footer: `src/screens/REPL.tsx` (expanded view selection, global footer, toolInfo.expanded)
- Transcript rendering: `src/screens/repl/transcript.tsx` (must be toggle-friendly; avoid Ink `<Static>` for content that must disappear)
- Persist thinking blocks: `src/features/repl/controller/streaming.ts` (consume `thinking_delta` → `ui.kind: 'thinking_block'`)
- Expanded Transcript details: `src/screens/repl/panels.tsx` (panel composition; avoid duplicated footers)

## Patterns

- **No fake thinking**: treat `thinking_delta` as the only source of truth; store it as message(s) that can be rendered later.
- **Avoid Ink `<Static>` for toggles**: Static is append-only; it cannot “unrender” old content when switching views.
- **Expanded tool/task output**: pass `toolInfo.expanded = true` when rendering tool messages inside Expanded Transcript.
- **One footer**: avoid per-panel footers that can duplicate; prefer a single global footer in `src/screens/REPL.tsx`.

## Tests to update

- `src/screens/repl/expandedTranscript.test.tsx`
  - Default transcript hides thinking text
  - After `ctrl+o`, thinking appears and ordering is chronological
  - Footer text appears
- `src/screens/repl/hotkeys.test.tsx`
  - `ctrl+o` toggles expanded transcript
  - `ctrl+o` is ignored during prompt mode and while overlays are open

Quick commands:

```sh
bun run test -- src/screens/repl/expandedTranscript.test.tsx src/screens/repl/hotkeys.test.tsx
bun run type-check
```

## Guardrails

- Do not introduce synthetic “thinking timers” or show thinking when the model did not emit `thinking_delta`.
- Expanded Transcript must be read-only (no input row); it should not accept user typing.
- `ctrl+o` must not steal input when prompt mode/overlays are active.
- UI copy/spacing should not change unless explicitly requested for parity.
