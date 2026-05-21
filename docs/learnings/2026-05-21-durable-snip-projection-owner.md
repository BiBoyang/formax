# Durable Snip Projection Owner

Date: 2026-05-21

Durable snip should enter the context architecture through `buildContextProjection()` before it touches request-only reducers. The projection owner now supports an abstract range-based durable snip state:

- input ranges are relative to the compact-boundary model-facing baseline,
- raw transcript and UI scrollback remain unchanged,
- model-facing baseline and diagnostics projection apply the durable removals,
- projection facts expose applied durable stages and a stable fingerprint.

Keep the schema abstract until the Claude Code `snipCompact` / `snipProjection` internals are mapped more precisely. Future work can replace range identity with stronger persisted IDs/fingerprints, but runtime callers should still consume durable snip through the projection owner rather than reimplementing filtering.
