# TODO (Later) — Session Save

This file tracks follow-up work beyond the Phase 1 baseline in `plans/session-save/DESIGN.md`.

## Phase 2 — Make settings affect behavior

- [ ] Persist `/config` changes (real settings) and apply them to:
  - request params (thinking, output style)
  - UI behavior (verbose output display)
- [ ] Decide which settings are per-user vs per-project, and where each is stored (`~/.formax/` vs `.formax/`)
- [ ] Add `/config` → disk persistence + reload-on-start
- [ ] Add regression tests for persistence + restart behavior

## Phase 3 — Session UX polish

- [ ] `/resume` picker UI (list + filtering by cwd + search)
- [ ] `/resume <id>` and `/resume` default behavior parity with CC
- [ ] Export sessions (redacted bundle vs raw)
- [ ] Delete sessions / retention management commands
- [ ] More robust failure modes (disk full, permission errors) + user-facing errors
