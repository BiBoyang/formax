# CCA-180 Deferred-Task Restore Utility v7 TODO

日期：2026-05-21

目标：在 `CCA-171` 已有 `recentSkills` / `recentSubagentTypes` 的基础上，把 session-memory restore utility 扩展到 deferred-task continuity，但保持 next-turn-only / best-effort / no-new-authority 语义。

## Contract

- [x] Update `docs/contracts/session-persistence-contract.md`: restore summary may include bounded deferred-task hints.
- [x] Update `docs/contracts/app-server-interaction-contract.md`: app-server `pendingSessionMemoryRestore` stable fields include the new optional arrays.
- [x] Update `docs/contracts/prompt-tool-exposure-contract.md`: restore hints do not restore deferred runtime state; they only remind the next turn.

## Batch 1: Canonical Restore Artifact Shape

- [x] Add tests for collecting successful `ToolSearch` loaded tool names from prior history.
- [x] Add tests for collecting successful `Task` descriptions / background hints from prior history.
- [x] Extend `SessionMemoryDraft.activeTask` and `SessionMemoryRestoreSummary` with bounded arrays.
- [x] Include the new hints in restore reminder text and structured summary.
- [x] Preserve schema-v1 backward compatibility when older sidecars do not contain the fields.

## Batch 2: App/Web Surface Compatibility

- [x] Extend Web RPC types/parsers to accept the new optional arrays.
- [x] Add Web parser tests for both present and absent new arrays.
- [x] Run targeted app-server restore tests if server mock payloads need fixture updates.

## Validation

- [x] `bun run test -- packages/core/src/chat/context/sessionMemory.test.ts`
- [x] `npm run test -- src/app/core/rpcParsers.test.ts src/app/core/rpcContracts.test.ts`
- [x] `bun run type-check`
- [x] `npm run type-check` in `packages/web-reference-react`
- [x] Mandatory `codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high"`

## Non-Goals

- Do not persist or rehydrate `DeferredToolExposureStore.loadedNames`.
- Do not resume background tasks automatically.
- Do not add a new compact/replay authority or rewrite persisted history.
