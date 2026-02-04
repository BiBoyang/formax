## Tool UI Blocks (C-lite) — migration TODO (delete items when done)

Purpose: migrate simple tool presenters to the **blocks presenter** path so global tool UI changes (⏺ spacing / ⎿ indent) don’t require editing many `src/tools/modules/*/presenter.tsx` files.

Rules:
- Migrate **2–4 tools per commit**
- **No hooks** in blocks presenters (keep React presenters when hooks/interaction are needed)
- Tests-first, then only run tests for touched files
- Commit only after `codex review --uncommitted`
- When a tool is migrated, **delete its line** from this list (no `[x]` noise)

Already migrated:
- `search`, `killShell`, `taskOutput`

### P0 — migrate next (simple + high frequency)
- `read` → blocks presenter + update `src/tools/modules/read/presenter.test.tsx`
- `grep` → blocks presenter + update `src/tools/modules/grep/presenter.test.tsx`
- `glob` → blocks presenter + update `src/tools/modules/glob/presenter.test.tsx`
- `todoWrite` → blocks presenter + update `src/tools/modules/todoWrite/presenter.test.tsx`

### P1 — migrate after P0 is stable (still no hooks, but more “shape”)
- `webSearch` → blocks presenter + update `src/tools/modules/webSearch/presenter.test.tsx`
- `webFetch` → blocks presenter + update `src/tools/modules/webFetch/presenter.test.tsx`
- `bash` → blocks presenter (multi-line output) + update `src/tools/modules/bash/presenter.test.tsx`
- `skill` → blocks presenter + update `src/tools/modules/skill/presenter.test.tsx`
- `askUserQuestion` → blocks presenter + update `src/tools/modules/askUserQuestion/presenter.test.tsx`

### P2 — postpone / keep React presenter for now (complex previews / special UI)
- `edit` (patch preview / line numbers / diff rendering)
- `write` (create/patch preview / approval UX)
- `task` (nested tool summaries + expanded transcript concerns)
- `slashCommand` (command output vs injection rules; already has its own UI concerns)
- `enterPlanMode`, `exitPlanMode` (approval-ish UX / flow coupling)

