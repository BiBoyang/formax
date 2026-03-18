# Core Package Guidelines

## Scope
- Applies to `packages/core/**`.
- `packages/core` is the canonical runtime/app implementation for CLI, TUI, tools, and app-server bridge.
- Inherit repo-wide policy from `../../AGENTS.md`; this file only defines core-local workflow emphasis.

## Main Entry Points
- CLI: `packages/core/src/entrypoints/cli.tsx`
- App-server bridge: `packages/core/src/entrypoints/app-server-bridge.ts`
- Web reference runtime entry: `packages/core/src/entrypoints/app-server-web-reference.ts`

## Primary Commands
- Run CLI dev loop: `bun run dev`
- Run type checks and contract/boundary gates: `bun run type-check`
- Run full tests: `bun run test`
- Run targeted test: `bun run test -- <path-to-test-file>`
- Boundary checks when touching layering/imports:
  - `bun run core:boundaries`
  - `bun run ui:boundaries`
  - `bun run features:boundaries`

## Canonical References
- Code navigation index: `CODEMAP.md`
- Semantics contract: `docs/contracts/semantics-contract.md`
- Interactive input contract: `docs/contracts/interactive-input-contract.md`
- Tool runtime contract: `docs/contracts/tool-runtime-contract.md`
- Hook contract: `docs/contracts/hooks-contract.md`
- Transcript surface contract: `docs/contracts/transcript-surface-contract.md`

## Core Deep Dives
- `packages/core/src/tools/README.md`
- `packages/core/src/core/README.md`
- `packages/core/src/streaming/README.md`
- `packages/core/src/features/subagents/README.md`
- `packages/core/src/hooks/README.md`
