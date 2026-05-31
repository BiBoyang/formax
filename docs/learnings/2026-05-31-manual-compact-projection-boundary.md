# 2026-05-31 - Manual Compact Projection Boundary

Decision: manual `/compact` must summarize the same durable model-facing projection baseline that the next model request would see, not raw transcript or UI scrollback.

Why:

1. Compact boundary, preserved-segment relink, durable snip, durable collapse, and durable tool-result replacement are projection ownership decisions. Manual `/compact` cannot bypass them just because it is user-triggered.
2. Raw transcript and UI scrollback remain valuable for display and audit, but they are not the summary input once durable projection has intentionally hidden or replaced content.
3. Reusing the projection owner keeps `/compact`, continuation, and request preparation aligned: the compact summary is generated from the latest model-facing baseline, while persisted history remains unchanged until the compact lifecycle materializes its new boundary.

Implementation note:

- `contextCompressionService.runManualCompact()` now feeds compact flow from `buildContextProjection().modelFacingBaseline`, including durable replacement event replay.
- `compactFlow` allows partial compaction for manual runs so an existing latest compact boundary can provide the current continuation input instead of reintroducing pre-boundary history.

Canonical references:

- `docs/contracts/slash-command-contract.md`
- `docs/contracts/context-strategy-stack-contract.md`
- `docs/contracts/session-persistence-contract.md`
