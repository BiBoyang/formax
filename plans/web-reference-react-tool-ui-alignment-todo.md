# Web Reference React Tool UI Alignment TODO

Last updated: 2026-02-21
Scope: /Users/david/Documents/github/formax/apps/web-reference-react tool transcript UI parity

## Alignment Board

| Tool / Semantic | Current Implementation | Status | Gap | Next Action |
|---|---|---|---|---|
| Bash | Header + IN/OUT blocks; running/completed/error states; exit code promoted | aligned_v1 | Minor spacing/typography polish may remain | Keep visual polish in follow-up passes |
| Read | Header-only with file subtitle | aligned_v1 | None identified in current reference pass | Keep as-is unless new reference differs |
| Write | Header + code preview + truncation message + error details | aligned_v1 | None identified in current reference pass | Keep as-is unless new reference differs |
| Edit | Dedicated renderer with file subtitle + diff preview block + truncation fallback | aligned_v1 | Minor wording/summary line parity may remain | Keep visual polish in follow-up passes |
| Thinking (non-tool) | Running-only lightweight row; finalized hidden in main transcript | aligned_v1 | None identified in current reference pass | Keep as-is |
| Grep | Search-like generic renderer | partial | Not validated against target visual reference line-by-line | Collect screenshot + align layout details |
| Search | Search-like generic renderer | partial | Not validated against target visual reference line-by-line | Collect screenshot + align layout details |
| Glob | Pattern summary + details renderer | partial | Not validated against target visual reference line-by-line | Collect screenshot + align layout details |
| WebSearch | Generic semantic renderer | partial | Not validated against target visual reference line-by-line | Collect screenshot + align layout details |
| WebFetch | Generic semantic renderer | partial | Not validated against target visual reference line-by-line | Collect screenshot + align layout details |
| Task | Generic semantic renderer with title synthesis | partial | Not validated against target visual reference line-by-line | Collect screenshot + align layout details |
| AskUserQuestion (semantic) | Semantic title/summary + parsed answers | partial | UX details not fully aligned to target reference | Add reference-driven UI pass |
| TodoWrite (semantic) | Semantic title/summary | partial | UX details not fully aligned to target reference | Add reference-driven UI pass |
| EnterPlanMode / ExitPlanMode (semantic) | Semantic title/summary | partial | UX details not fully aligned to target reference | Add reference-driven UI pass |
| Other fallback tools | defaultRenderer only | todo | No dedicated parity target yet | Add per-tool renderer when target is provided |

## Todo Checklist

### Completed
- [x] Baseline parity for Bash, Read, Write, Thinking layout model.
- [x] Edit moved to dedicated diff renderer (non-running preview + truncation fallback).
- [x] Replay hydration fix for user/system projection segments on refresh.
- [x] Basic performance guard for long preview rendering.

### In Progress
- [ ] Reference-driven parity for partial tools (Grep/Search/Glob/WebSearch/WebFetch/Task).

### Backlog
- [ ] Replace fallback renderers for high-frequency tools with dedicated blocks.
- [ ] Final visual polish pass (spacing, typography, separators) after all tool layouts are aligned.

## Definition of Done
- Every tool shown in transcript has either:
  - dedicated renderer aligned to agreed reference, or
  - explicit sign-off that default renderer is acceptable.
- Screenshot parity checks completed for all high-frequency tools.
- Tests cover status transitions (running/completed/error) and refresh/replay persistence.
