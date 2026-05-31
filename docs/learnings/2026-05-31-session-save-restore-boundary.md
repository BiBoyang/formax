# 2026-05-31 - SessionSave / SessionRestore Boundary

## Learning

`sessionSave` should stay a Repo boundary: JSONL scanning, sidecar file IO, event-name constants, and tolerant persisted DTO parsing.

Semantic replay belongs in `packages/core/src/features/repl/sessionRestore/`, where Service code can depend on chat context, prompts, projection state, and mode semantics.

## Why

Keeping semantic reconstruction in `sessionSave` made Repo files import Service modules such as `chat/context`, `prompts`, REPL controller code, and session-memory helpers. That made `check:layer-contracts` fail and blurred whether a file was persisting records or interpreting them.

## Current Split

- Repo DTO/IO readers: `packages/core/src/features/repl/sessionSave/{contextCollapseStoreEvents,durableSnipStoreEvents,durableToolResultContentReplacementEvents,reactiveCompactEvents,sessionMemorySidecar}.ts`
- Service restore rebuilders: `packages/core/src/features/repl/sessionRestore/{contextCollapseStore,durableSnipStore,durableToolResultContentReplacement,sessionMemory}.ts`

Future restore additions should follow this direction: Service imports Repo DTOs, never Repo importing Service semantics.
