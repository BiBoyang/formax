---
name: formax-repomix-handoff-workflow
description: "Use when preparing a Formax code handoff: selecting files, generating repomix bundles, and writing a high-quality prompt for WebGPT or another coding agent with clear constraints and validation scope."
---

# formax-repomix-handoff-workflow

## Goal
Create a clean handoff package for another AI with:
- the smallest correct repomix bundle
- a prompt that matches the target environment
- explicit acceptance criteria and non-goals

## Where to change what
- All handoff artifacts live in one folder: `repomix-output/`
- Bundle output: `repomix-output/repomix-<topic>-<suffix>.txt`
- Handoff prompt: `repomix-output/<topic>-handoff-prompt.md`
- Optional file manifest notes: `repomix-output/repomix-<topic>-files.md`
- Template references: `references/prompt-templates.md`

> Required hygiene: each new pack run must clear previous files in `repomix-output/` first, so users can upload that folder as-is without manual file picking.

## Patterns
1. Classify target runtime first
- `Static consumer` (e.g., WebGPT): cannot run local commands or tests.
- `Executable agent` (repo access): can run local commands/tests.

2. Build a minimal include set
- Include changed runtime files + direct dependencies + adjacent tests.
- Include only the docs needed for intent/constraints.
- Avoid unrelated folders to keep context small.

3. Pack with deterministic command (single folder, auto-clean)
```sh
bunx repomix . \
  --style plain \
  --no-git-sort-by-changes \
  -o repomix-output/repomix-<topic>-<suffix>.txt \
  --include "<comma-separated-file-list>"
```
Or use the helper script:
```sh
bash .codex/skills/formax-repomix-handoff-workflow/scripts/build-repomix.sh \
  repomix-<topic>-<suffix>.txt \
  "<comma-separated-file-list>"
```
The helper script will:
- create `repomix-output/` if missing
- delete previous files under `repomix-output/` (except `.gitkeep`)
- write the new bundle into `repomix-output/`

4. Write prompt with explicit boundaries
- State known symptoms.
- State hard constraints (what must not change).
- Define deliverables (root cause model, options, recommended plan, test/validation matrix).
- Include acceptance criteria with observable assertions.

5. Sanity-check before handoff
- `repomix-output/` only contains current-round artifacts.
- Bundle exists and includes the expected files.
- Prompt has no impossible instructions for the target runtime.
- Prompt does not ask static consumers to run commands.

See `references/prompt-templates.md` for copy-ready templates.

## Tests to update
- No repository tests required for creating the handoff itself.
- If target is executable, include a suggested minimal test list in the handoff prompt.

## Guardrails
- Never include `bun run test:coverage` in a static-consumer prompt.
- Never assume the other AI can read files outside the provided bundle unless explicitly attached.
- Keep asks decision-oriented first (root cause/options) before patch implementation.
- Prefer concrete acceptance checks over vague goals.
- Avoid mixing unrelated bugfixes into one handoff package.
