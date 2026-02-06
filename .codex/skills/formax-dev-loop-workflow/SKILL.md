---
name: formax-dev-loop-workflow
description: "Use when working on Formax code changes and you need a disciplined dev loop: keep a single mainline task, avoid scope drift, run only targeted tests (no coverage), avoid partial staging (MM), run `codex review --uncommitted` before commit, and keep commits small and reviewable."
---

# Formax Dev Loop (Mainline Discipline)

## Default loop (repeat per TODO item)

1) **Pick one mainline item** and finish it end-to-end before starting another.
   - If a new idea appears mid-flight, write it down in a backlog note and continue the mainline.

2) **Write/adjust tests first** to lock behavior (when feasible).

3) **Implement** the smallest change that satisfies the item.

4) **Run only targeted tests** (never `bun run test:coverage` unless explicitly asked).
   - Preferred: `bun run test -- <changed-test-files...>`
   - Helper (repo): `bun run test:changed`
     - Use default (staged only) for the commit you are about to make.
     - Use `bun run test:changed -- --all` only when you intentionally want staged + unstaged + untracked.

5) **Pre-commit hygiene**
   - Avoid partial staging (“MM” state). If needed, check with:
     - `bun run check:partial-stage`
   - Run review before every commit:
     - `codex review --uncommitted`

6) **Commit**
   - Keep it small (2–4 files ideally, unless refactor forces more).
   - Prefer one concern per commit (tests + implementation together for that concern).

## Guardrails (Formax-specific)

- Do not fix unrelated failures mid-loop unless they block the mainline.
- If a command would usually be run with pipes/redirections for convenience, prefer running it plain and rely on Formax’s own output truncation/Expand UI.
- Don’t “clean up” formatting/copy/colors/spacing unless explicitly requested or required for parity.

## Quick commands

```bash
# Detect partial staging (“MM”)
bun run check:partial-stage

# Run related tests for staged changes
bun run test:changed -- --dry-run
bun run test:changed

# Include unstaged + untracked (when explicitly intended)
bun run test:changed -- --all

# Required before commit
codex review --uncommitted
```
