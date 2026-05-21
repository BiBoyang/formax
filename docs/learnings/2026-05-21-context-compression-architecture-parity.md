# 2026-05-21 - Context Compression Architecture Parity

## Context

After aligning Anthropic cache-editing microcompact, the remaining Claude Code gap is no longer just a missing helper or a different threshold. The larger difference is architectural: Claude Code separates append-only transcript, durable compression state replay, model-facing projection, request-only reducers, provider cache side effects, materializing compact, and surface adapters.

Formax already has a canonical middle-layer order and request/persisted split, but several stages still behave as request-only functions:

- `snip` trims old assistant text for the current request only.
- `context collapse` creates a request-only recap and optional diagnostics event.
- `microcompact` is now correctly request/API-only, with cache editing side effects kept out of persisted history.

## Decision

The active context-compression mainline should first align architecture, then refine individual heuristics.

Specifically:

1. Treat `snip` as a future durable projection subsystem, not just a helper to tune.
2. Treat `context collapse` as a future committed store / snapshot / replay subsystem, not just a request recap.
3. Keep provider cache edits out of durable projection state.
4. Add a projection-owner seam before migrating `snip` or collapse internals.
5. Use golden projection fixtures to lock raw transcript, model-facing projection, UI scrollback, app-server replay, and Web replay expectations.

## Implication

Do not start by changing `snip` thresholds, excerpts, or stub text. Those are implementation details. The first deliverables are:

- an architecture parity TODO,
- contract language for durable projection versus request reducers,
- baseline projection tests,
- then a shared projection owner.

Only after that should durable snip metadata/replay and durable context-collapse store migration begin.

Canonical contract: `docs/contracts/context-strategy-stack-contract.md`.
