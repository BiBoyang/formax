# Durable Snip Projection Owner

Date: 2026-05-21

Durable snip should enter the context architecture through `buildContextProjection()` before it touches request-only reducers. The projection owner now supports an abstract range-based durable snip state:

- input ranges are relative to the compact-boundary model-facing baseline,
- raw transcript and UI scrollback remain unchanged,
- model-facing baseline and diagnostics projection apply the durable removals,
- projection facts expose applied durable stages and a stable fingerprint.

Keep the schema abstract until the Claude Code `snipCompact` / `snipProjection` internals are mapped more precisely. Future work can replace range identity with stronger persisted IDs/fingerprints, but runtime callers should still consume durable snip through the projection owner rather than reimplementing filtering.

Request-time snip can now emit a durable `durable_snip_applied` snapshot after a successful turn. The important boundary is success-only persistence: the first request may still use the request-time text stub, but future turns replay the durable removal through `buildContextProjection()` and no longer resurrect the original model-facing message. Failed attempts should not write durable snip state.

Durable snip persistence must not store coordinates from an already-collapsed projection unless the removal ranges are first rebased through the active collapse mapping. Until that rebase exists, collapse-active requests can still use request-only snip for the current LLM call, but should skip writing `durable_snip_applied` to avoid deleting the wrong raw continuation messages on replay.
