# 2026-03-04: Web parity browser-safe adapters

## Context

`packages/web-reference-react` previously imported multiple tool-presentation modules directly from `packages/core/src/features/*`.
Some of those chains eventually pulled `packages/core/src/shared/utils/paths.ts` into browser builds, which depends on `node:os` and `node:path`.

## Decision

Introduce a local browser-safe parity layer under:

- `packages/web-reference-react/src/parity/contracts/*`
- `packages/web-reference-react/src/parity/tools/*`

Then route web app imports to this layer for tool-presentation semantics:

- ask questions/answers parsing
- params text parsing/ordering/stringifying
- tool semantics labels
- interactive prompt model resolution
- tool view-model projection

## Why

- Avoid Node-only runtime dependencies in browser bundles.
- Keep web-facing behavior aligned with root semantics while preserving an explicit adapter boundary.
- Make future web-only performance changes local to `packages/web-reference-react`.

## Validation

- `npm --prefix packages/web-reference-react run type-check`
- `npm --prefix packages/web-reference-react run test -- src/App.test.tsx src/components/tool/toolBlocksRegistry.test.ts src/parity/tools/parityAdapters.test.ts`
- `npm --prefix packages/web-reference-react run build`

Build no longer reports `node:os` / `node:path` externalization warnings.
