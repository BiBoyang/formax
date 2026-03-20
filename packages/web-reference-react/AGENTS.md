# Web Reference Guidelines

## Scope
- Applies to `packages/web-reference-react/**`.
- This package is the isolated React + Vite reference client for app-server protocol and UI parity verification.
- Inherit repo-wide policy from `../../AGENTS.md`; this file only adds package-local guidance.

## Primary Commands
- Install deps: `npm --prefix packages/web-reference-react install`
- Start dev server: `npm --prefix packages/web-reference-react run dev`
- Unit tests: `npm --prefix packages/web-reference-react run test`
- E2E tests: `npm --prefix packages/web-reference-react run test:e2e`
- Evidence capture:
  - `npm --prefix packages/web-reference-react run evidence:after -- --task=<task-id>`
  - `npm --prefix packages/web-reference-react run evidence:before -- --task=<task-id>`

## Evidence Workflow
- Default acceptance artifact: `evidence:after` (new feature and common bugfix verification).
- Add `evidence:before` only when issue reproduction is stable and meaningful.
- Canonical policy/runbook: `docs/runbooks/web-evidence-workflow.md`.

## Canonical References
- Package deep dive: `packages/web-reference-react/README.md`
- Semantics contract: `docs/contracts/semantics-contract.md`
- App-server interaction contract: `docs/contracts/app-server-interaction-contract.md`
- Web parity adapter contract: `docs/contracts/web-parity-adapter-contract.md`
- App-server UI spec: `docs/frontend/app-server-ui-spec.md`

## UI & Styling Guidelines (Important)
- **Hover & Active States**: For list items, sidebar items, and top header interactive buttons, **ALWAYS** use the translucent color system (`hover:bg-[var(--sidebar-list-hover)]` and `bg-[var(--sidebar-list-active)]`). 
- **Do NOT use solid colors** (like `bg-muted`, `bg-accent`, or the defined but unused `--sidebar-list-hover-solid`) for these interaction states. The translucent variables `color-mix(..., transparent)` are specifically designed so that hover appears deeper than active, seamlessly blending into underneath backgrounds.
