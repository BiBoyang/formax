# 2026-03-06 - Request Dry-Run Preview (No Network)

## Context

During prompt/tool parity work, repeatedly capturing proxy traffic is slow and noisy when we only need to inspect request framing (system blocks, user blocks, tool list).

## Change

Added a runtime dry-run mode at chat-engine level:

- `FORMAX_REQUEST_DRY_RUN=1`
- optional `FORMAX_REQUEST_DRY_RUN_DIR=<path>`

When enabled:

1. The engine still builds per-iteration request payload (`system`, `messages`, `tools`) exactly as normal.
2. Before calling `client.streamOnce`, payload is serialized to local JSON.
3. No network request is sent.
4. Assistant returns a short local notice with dump path.

Default dump path (when dir env is unset):

- `<cwd>/proxy/request-dry-run`

## Why engine-level

- Covers current REPL flow immediately without touching transport clients.
- Captures post-injection, pre-transport request state (the key parity target for prompt alignment work).
- Keeps behavior behind explicit env flag; default runtime path is unchanged.

## Test coverage

- `packages/core/src/chat/engine.test.ts`
  - verifies dry-run skips `streamOnce`
  - verifies JSON payload is written with expected `system/messages/tools` fields

- `packages/core/src/config/runtimeFlags.test.ts`
  - verifies env parsing for `FORMAX_REQUEST_DRY_RUN` and `FORMAX_REQUEST_DRY_RUN_DIR`
