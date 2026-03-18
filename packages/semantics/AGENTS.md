# Semantics Package Guidelines

## Scope
- Applies to `packages/semantics/**`.
- `@formax/semantics` is the canonical shared semantics/type surface consumed by core and web parity paths.
- Inherit repo-wide policy from `../../AGENTS.md`; this file only adds semantics-local guardrails.

## Change Guardrails
- Treat exported shapes in `packages/semantics/src/index.ts` as compatibility-sensitive.
- Prefer explicit, version-safe extension over in-place breaking edits.
- If semantics behavior or schema meaning changes, update canonical docs first, then implementation.

## Primary Commands
- Type check semantics package (from repo root): `tsc -p packages/semantics/tsconfig.json --noEmit`
- Full repo type + boundary checks: `bun run type-check`
- Targeted tests (if present): `bun run test -- <path-to-test-file>`

## Canonical References
- Semantics contract: `docs/contracts/semantics-contract.md`
- Interactive input contract: `docs/contracts/interactive-input-contract.md`
- Web parity adapter contract: `docs/contracts/web-parity-adapter-contract.md`
