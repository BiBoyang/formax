# 2026-05-31 - Tool Result Replacement Boundary

Batch 1 of the post-CCA-181 compression-boundary follow-up locked the line between request-time reducers and durable projection replay.

Key decisions:

- `microcompact` and `tool_result_budget` remain request-time reducers. They may shape the next request projection, but they do not create durable projection state or mutate persisted history.
- Durable tool-result content replacement remains explicit side-state, replayed by `buildContextProjection()` against the model-facing baseline.
- Durable replacement markers are tool-use-id specific. A marker for another tool result must not suppress normal request-time `tool_result_budget`.
- Durable replacement replay must skip missing, duplicate, drifted, malformed, or ambiguous targets. Skipped durable replacement does not make the tool result durable-replaced; it remains eligible for request-time reducers.
- `/context --json` may expose durable replacement diagnostics, but only as bounded metadata. Full `replacementContent` is model-facing projection data and must not be dumped through diagnostics by default.
- App-server and Web must not infer durable replacement facts from transcript/tool rows, budget stubs, durable-looking text, or uncontracted fields.

Implementation notes:

- `buildContextProjection()` may keep internal applied replacement entries for projection/debug ownership.
- `contextDiagnostics` sanitizes durable replacement facts before exposing them as public diagnostics.
- Session readers ignore malformed durable replacement events without clearing the last valid state, and ignore present-but-unknown `sourceProjectionKind`.

Canonical references:

- `docs/contracts/context-strategy-stack-contract.md`
- `docs/contracts/session-persistence-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
