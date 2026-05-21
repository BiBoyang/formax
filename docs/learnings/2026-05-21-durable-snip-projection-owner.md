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

The durable snip snapshot now carries removed message identities when available, removed message fingerprints, the base model-facing projection fingerprint, and `sourceProjectionKind: "model_facing_baseline"`. Replay is intentionally conservative: explicit identities must be unique, range-aligned, and fingerprint-matched before the model-facing baseline drops those messages. Older snapshots without identity can still use the legacy range/count/fingerprint guard, but duplicated or mismatched fingerprints skip deletion. This keeps resume from resurrecting snipped content while avoiding stale-coordinate deletion after history drift.

Compact preserved-segment relink must precede durable snip replay. The compact boundary now records named summary/head/anchor/tail identities plus the ordered identity/fingerprint list. Resume relink only fills a completely missing preserved tail when the summary still matches and the tail can be uniquely found before the boundary; partial matches, drifted prefixes, or duplicate matches are left unchanged so the projection does not duplicate or reorder user-visible continuation.

Collapse-active durable snip stays narrow. When a durable collapse is already active, request-time snip still remains request-only because the removal coordinates are in a collapsed projection and cannot be safely mapped back yet. When request-time snip and request-time collapse are created in the same stack, snip still ran first, so its removals are in the durable snip baseline; the collapse commit can be kept only after subtracting snipped head messages from the committed collapse source range. Boundary-crossing removals or empty rebased heads skip the collapse commit rather than writing partial durable state.
