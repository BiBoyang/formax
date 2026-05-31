# Tool Reference Canonical Writer

## Context

`docs/contracts/tool-runtime-contract.md` defines `tool_reference.tool_name` as the canonical name field. Legacy `name` remains read-compatible, but new ToolSearch/tool-reference writes should not keep reinforcing the old alias.

## Learning

Keep compatibility asymmetric for `tool_reference` blocks:

- writers emit `tool_name` only;
- readers accept legacy `name` only when `tool_name` is absent or empty;
- when both fields exist and conflict, `tool_name` wins.

This keeps old session/history payloads readable without making the legacy alias part of the current model-facing shape.

## Verification

- `bun run test -- packages/core/src/shared/utils/toolResultContent.test.ts packages/core/src/tools/runtime/deferredToolExposure.test.ts packages/core/src/tools/modules/toolSearch/handler.test.ts packages/core/src/chat/context/sessionMemory.test.ts packages/core/src/chat/engine.test.ts`
