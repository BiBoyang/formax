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

## Phase 0 — Lock the new Ctrl+O behavior with tests

- [x] Add/extend tests around Ctrl+O/Ctrl+E routing:
  - [x] Ctrl+O ignored when overlays are open (agents/permissions/hooks) and during prompt mode.
  - [x] Ctrl+O toggles Expanded Transcript open/close.
  - [x] Add placeholder skipped test for Ctrl+E folding to guide a later phase.

Where:
- `src/screens/repl/hotkeys.test.tsx`
- If needed, a higher-level `src/screens/REPL.test.tsx` snapshot/assertions for “second view” output.

## Phase 1 — Introduce Expanded Transcript (minimal, functional)

- [x] Add a single boolean state: `expandedTranscriptOpen` in REPL UI state.
- [x] Change Ctrl+O to toggle *only* Expanded Transcript (no special-casing per panel).
- [ ] Implement a full Expanded Transcript renderer (Claude Code-style “expanded transcript” list):
  - [ ] Show the same transcript list as Primary Transcript, but with extra “detail blocks” (think + task subagent details).
  - [ ] Keep existing “detail panels” as a first-cut implementation:
    - [x] Show Task transcript lines when present (reuse `DetailedTranscriptPanel`).
    - [x] Show Explore agents summaries/details (reuse `ExploreAgentsPanel`).
    - [x] Show thinking content for the *current turn* when available (when expanded is open).

## Phase 2 — Persist thinking per-turn for recall (align with CC intent)

- [ ] Stop treating thinking as “loading-only UI”. Store thinking per assistant turn so it can be displayed in Expanded Transcript after the request ends.
- [ ] Ensure thinking is scoped to each turn (no global concatenation across turns).

## Phase 3 — Ctrl+E history folding (post-MVP)

- [ ] Add Ctrl+E support inside Expanded Transcript:
  - [ ] Toggle “hide N previous messages” while staying in Expanded Transcript.
  - [ ] Define what “previous messages” means (by count? by turns?).

## Phase 4 — Cleanup

- [ ] Remove old Ctrl+O code paths (`showThinking`, `showDetailedTranscript`, `showExploreAgentsPanel`) once Expanded Transcript fully supersedes them.
- [ ] Update `CODEMAP.md` if any user-facing wiring moves.
