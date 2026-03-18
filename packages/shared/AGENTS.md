# Shared Package Guidelines

## Scope
- Applies to `packages/shared/**`.
- `@formax/shared` is the cross-package utility/types boundary used by both runtime and semantics layers.
- Inherit repo-wide policy from `../../AGENTS.md`; this file only adds shared-local guardrails.

## Change Guardrails
- Prefer additive, backward-compatible exports from `packages/shared/src/index.ts`.
- Avoid introducing runtime-only dependencies here; keep this package lightweight and portable.
- Any exported contract shape change should be coordinated with dependents in:
  - `packages/core`
  - `packages/semantics`
  - `packages/web-reference-react` (via workspace imports)

## Primary Commands
- Type check shared package (from repo root): `tsc -p packages/shared/tsconfig.json --noEmit`
- Full repo type gate (recommended before merge): `bun run type-check`
- Targeted tests (if present): `bun run test -- <path-to-test-file>`

## Canonical References
- Semantics contract: `docs/contracts/semantics-contract.md`
- Prompt/tool exposure contract: `docs/contracts/prompt-tool-exposure-contract.md`
