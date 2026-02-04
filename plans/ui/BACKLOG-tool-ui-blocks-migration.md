# Backlog: Tool UI Blocks (C-lite) migration

Context: We migrated the initial **P0** set to the blocks presenter path so global tool UI changes do not require editing every `src/tools/modules/*/presenter.tsx`.

Status:

- ✅ P0 done: `read`, `grep`, `glob`, `todoWrite`
- ⏸ P1/P2 postponed (keep here as backlog)

## P1 — migrate after P0 is stable

- `webSearch` → blocks presenter + update `src/tools/modules/webSearch/presenter.test.tsx`
- `webFetch` → blocks presenter + update `src/tools/modules/webFetch/presenter.test.tsx`
- `bash` → blocks presenter (multi-line output) + update `src/tools/modules/bash/presenter.test.tsx`
- `skill` → blocks presenter + update `src/tools/modules/skill/presenter.test.tsx`
- `askUserQuestion` → blocks presenter + update `src/tools/modules/askUserQuestion/presenter.test.tsx`

## P2 — postpone / keep React presenter for now

- `edit` (patch preview / line numbers / diff rendering)
- `write` (create/patch preview / approval UX)
- `task` (nested tool summaries + expanded transcript concerns)
- `slashCommand` (command output vs injection rules; already has its own UI concerns)
- `enterPlanMode`, `exitPlanMode` (approval-ish UX / flow coupling)

