# 2026-03-04 - app-server bounded queues and overload semantics

## Context

`src/app-server/index.ts` previously processed JSONL ingress in a single serial loop (`listen -> parse -> handleMessage -> send`).
Under bursty request traffic, this made throughput depend on request handler latency and offered no explicit queue saturation behavior.

## Decision

Adopt Codex-style app-server backpressure semantics on the server side:

1. Introduce bounded queues between ingress, request processing, and outbound writes.
2. Reject request ingress on saturation with JSON-RPC overload error:
   - `code: -32001`
   - `message: "Server overloaded; retry later."`
3. Keep non-request ingress (`notification`/`response`) on wait-for-capacity path instead of immediate overload rejection.

## Implementation notes

- Queue capacities are configurable via `runAppServer` options:
  - `ingressQueueCapacity`
  - `outboundQueueCapacity`
  - both default to `128`.
- Outbound send failures remain best-effort for server notifications, preserving prior behavior.
- Payload-size enforcement (`PAYLOAD_TOO_LARGE`) remains unchanged and is still applied on request/event directions.

## Contract impact

- New error kind: `OVERLOADED` (`-32001`).
- `NOT_INITIALIZED` now uses code `-32600` with message `Not initialized` to avoid code collision with `OVERLOADED`.
- Contract/reference docs updated:
  - `docs/contracts/app-server-interaction-contract.md`
  - `docs/references/app-server-api-reference.md`

## Regression coverage

- `src/app-server/index.test.ts`
- `src/app-server/index.coverage.test.ts`
