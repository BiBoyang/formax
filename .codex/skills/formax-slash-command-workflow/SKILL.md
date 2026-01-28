---
name: formax-slash-command-workflow
description: Use when adding/modifying Formax slash commands (/permissions /agents /hooks /todos etc), especially output rendering (command sublines), overlay dismiss messages, and whether outputs are injected into the next LLM turn.
---

# Formax slash command workflow

## Goal

Make changes to slash commands while keeping:
- UI output parity (spacing/copy/colors stay the same unless explicitly requested)
- “Show in UI” vs “inject into model context” **orthogonal**
- tests updated to lock the behavior

## Where to change what (common paths)

### 1) Command discovery + dispatch
- `src/features/commands/registry.ts`: command list/suggest/dispatch wiring
- `src/commands/CommandStore.ts`: disk scanning + precedence (project overrides user)

### 2) Command result contract (UI vs model)
- `src/features/commands/contracts.ts`: `UiEffect` / `UiMessage` / `ModelEffect` shapes
- `src/features/commands/adapter.ts`: maps command execution output → `CommandResult`
  - If you want Claude-style “subline output”, emit messages with `ui: { kind: 'command_subline' }`
  - If you want next-turn injection, keep using the existing `recordForNextTurn` / injected-blocks path

### 3) Overlay dismissal “subline output”
- `src/features/repl/controller/overlays.ts`: overlay open/close + append “dismissed” sublines

### 4) REPL message plumbing + rendering
- `src/features/repl/controller/send.ts`: applies `UiEffect.appendMessages` to `Msg` (make sure `Msg.ui` passes through)
- `src/screens/REPL.tsx`: render `msg.ui.kind === 'command_subline'` as `⎿  ...` (no `⏺`)

## Patterns

### Pattern A: one-line overlay dismissal
When a dialog closes, append a single assistant `Msg` with `ui.kind='command_subline'`, e.g.:
- `Permissions dialog dismissed`

### Pattern B: multi-line local output (still not a tool_result)
Split output into lines and append *multiple* `command_subline` messages.
This is the UI side only; model injection is controlled separately.

### Pattern C: inject-but-don’t-spam UI
If a command needs to inform the model (e.g. `/todos` producing `<local-command-stdout>`), keep injection, but keep the UI output minimal via sublines.

## Tests to update (minimum)

- `src/features/repl/controller/overlays.test.tsx`: overlay open/close adds the right sublines
- `src/features/commands/adapter.test.ts`: contract mapping for `/todos` vs other commands

## Guardrails (do not regress)

- Do not add “2D-like” bespoke structures (e.g. `commandSubLines`)—use `Msg.ui.kind='command_subline'`.
- Do not change UI copy/spacing/colors as a side-effect.
- If behavior is unclear, add/extend an Ink test first (tests are *not* the only spec, but are required for refactors).

