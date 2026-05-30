# Preserved-Segment Relink Validation Parity

Date: 2026-05-30

CCA-181 closed preserved-segment relink parity by treating relink as a validated model-facing repair, not as transcript mutation or a new persisted authority.

Key decisions:

- Relink only fills a wholly missing preserved tail after the latest compact summary when summary, count, fingerprint, and explicit identity metadata all validate.
- Explicit preserved-segment refs must resolve uniquely and contiguously before the compact boundary. Duplicate, out-of-order, non-contiguous, partial, or malformed metadata skips relink.
- Relink runs before durable snip / collapse projection guards, but a skipped relink does not disable those downstream guards.
- `boundaryFingerprint` is a read-only compact-boundary generation fact on projection / app-server / Web surfaces. It is not written back into persisted boundary metadata.
- Web cache merge uses matching `boundaryFingerprint` as the generation key. Preserved-segment core fingerprints are not enough to merge deep compact-boundary facts across payloads.
- Web may retain same-generation deep inspection facts (`keepStrategy`, `rehydrationPlan`, `rehydrationCost`, `preservedSegment`) when later read/messages/replay payloads omit optional details, but it must not infer preservedSegment from transcript rows.

Deferred:

- Durable tool-result replacement summary surface remains a projection-surface follow-up.
- `CCA-182` reactive compact shaping remains a later runtime/provider mainline.
- Collapse different-id overlap policy stays deferred until a concrete failing fixture requires it.
- ParentUuid / transcript UUID storage rewrites and full partial-compact archived spans are not part of Formax CCA-181.

Canonical contracts:

- `docs/contracts/session-persistence-contract.md`
- `docs/contracts/context-strategy-stack-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
- `docs/contracts/web-parity-adapter-contract.md`
