# TODO: Expanded Transcript (Ctrl+O “second view”)

Goal: align Formax’s Ctrl+O “second view” with Claude Code using `plans/ui/demo.txt`, `plans/ui/demo-expand.txt`, `plans/ui/demo-expand-detail.txt`, and `plans/ui/cladue-code-ctrlo-think.md` as the reference behavior.

## Terminology

- **Primary Transcript**: default REPL transcript (`plans/ui/demo.txt`).
- **Expanded Transcript**: Ctrl+O toggled “second view” (same transcript area, not an overlay).
- **History Fold Toggle**: Ctrl+E inside Expanded Transcript to hide/show previous messages (still within Expanded Transcript).
- **Overlay**: modal dialogs like `/agents`, `/permissions`, `/hooks`.

## Non-goals (Phase 1)

- No attempt to perfectly match Claude Code’s visual styling (spacing/colors) beyond what’s necessary to keep Formax UI consistent.
- No “tool_result `<system-reminder>` injection” work here.
- No new syntax-highlighting dependency.

## Current Formax state (for mapping)

- Ctrl+O routing: `src/screens/repl/hotkeys.ts`
  - Ctrl+O toggles `expandedTranscriptOpen` (single “second view” switch)
- Panels: `src/screens/repl/panels.tsx`
  - `ExploreAgentsPanel`
  - `DetailedTranscriptPanel`
- REPL state wiring: `src/screens/REPL.tsx`
- Task/subagent details live in tool messages: `src/components/tool/ToolMessage.tsx` (`toolInfo.transcriptLines`, `nestedTools`, etc.)
- Explore summary message hint: `src/features/repl/controller/streaming.ts` (“Explore agents finished (ctrl+o to expand)”)

## Phase 3 — Ctrl+E history folding (post-MVP)

- [ ] Add Ctrl+E support inside Expanded Transcript:
  - [ ] Toggle “hide N previous messages” while staying in Expanded Transcript.
  - [ ] Define what “previous messages” means (by count? by turns?).
