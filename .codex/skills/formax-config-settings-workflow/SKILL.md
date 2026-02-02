---
name: formax-config-settings-workflow
description: Use when implementing or extending /config (storage, prompt injection, request params, UI-only toggles) with tests and strict UI parity.
---

# formax-config-settings-workflow

## Goal

Add or change `/config` settings in Formax while keeping:
- Stable read/write semantics (immediate persistence, sparse writes)
- Clear separation: UI output vs model-context injection
- Predictable runtime “immediate effect” behavior (no restart)
- Strong regression coverage with targeted tests

## Where to change what

- **Config schema + merge semantics**
  - `src/core/config/schema.ts` (add fields + defaults; validate values)
  - `src/core/config/resolve.ts` (merge precedence + `sources` mapping)
  - `src/core/config/persist.ts` (patch read/write + `stripDefaultsFromPatch`)
- **Disk locations**
  - `src/adapters/fs/configPaths.ts` (project/global config dirs)
  - `src/adapters/fs/configFiles.ts` (load `config.json` patches)
  - `src/env/config.ts` (final `RuntimeConfig` shape used by UI/runtime)
- **/config UI overlay**
  - `src/ui/config/ConfigDialog.tsx` (reads effective config + writes patches)
  - `src/ui/config/constants.ts` / `src/ui/config/reducer.ts` / `src/ui/config/ui.tsx`
  - `src/screens/REPL.tsx` (mount overlay + reload runtime config on exit)
- **Runtime wiring (effects)**
  - Prompt injection: `src/features/repl/controller/send.ts` + `src/prompts/reminders/*`
  - Request parameters: `src/chat/engine.ts` → `src/streaming/**`
  - UI-only flags: `src/screens/REPL.tsx` and small helpers under `src/screens/repl/*`
- **Command injection rule (only when prompt semantics changed)**
  - `src/features/repl/useReplController.ts` (e.g. inject only for output-style changes)

## Patterns

- **Classify each setting first (required)**
  - `Prompt injection`: affects how the model should respond (inject into next turn).
  - `Request parameter`: affects the LLM API payload/headers for the next request.
  - `UI-only`: affects only rendering; must not change prompt contents.

- **Storage rule (v0)**
  - Only two scopes: **User** (`$FORMAX_CONFIG_DIR/config.json`) and **Project** (`<repo>/.formax/config.json`).
  - Prefer **sparse writes**: write only non-default overrides.

- **Immediate effect**
  - After saving in `/config`, reload the effective runtime config in-process and update REPL state.
  - Avoid “restart required” behavior for v0.

- **Injection rule (prompt semantics only)**
  - If a `/config` change affects prompt semantics, record a local-command injection for the next turn.
  - If UI-only, do not inject `<command-name>`/`<local-command-stdout>`.

- **Message formatting**
  - Keep `/config` exit subline aligned with Claude Code:
    - No changes → “Status dialog dismissed”
    - One change → “Set <field> to <value>”

## Tests to update

- UI overlay read/write:
  - `src/ui/config/ConfigDialog.test.tsx`
- Prompt injection behavior:
  - `src/features/repl/useReplController.test.tsx` (injection decisions)
  - `src/screens/REPL.test.tsx` / `src/screens/REPL.overlays.test.tsx` (only if you touch REPL wiring)
- Request payload behavior:
  - `src/streaming/anthropic/StreamClient.test.ts`
  - `src/chat/engine.test.ts` (if you change engine args/loop wiring)
- UI-only rendering switches:
  - `src/screens/repl/thinkingBlock.test.tsx` (or the relevant view helper)

**Test command policy**
- Do **not** run `bun run test:coverage` while iterating.
- Run only targeted tests for the files you touched, e.g.:
  - `bun run test -- src/ui/config/ConfigDialog.test.tsx`
  - `bun run test -- src/streaming/anthropic/StreamClient.test.ts`

## Guardrails

- **UI parity**
  - Do not change UI copy/spacing/colors unless explicitly aligning Claude Code.
  - Do not add heavy rendering/highlighting libraries for v0.
- **No scope creep**
  - Don’t introduce extra config layers (`cache.json`/`runtime.json`) without an explicit decision.
  - Don’t implement editor-mode/Vim parity unless asked.
- **Stability-first**
  - Add/extend tests before refactors; tests are not the full spec—manual parity matters.
- **Review + commit discipline**
  - Before committing, run `codex review --uncommitted` and fix high/medium findings.
