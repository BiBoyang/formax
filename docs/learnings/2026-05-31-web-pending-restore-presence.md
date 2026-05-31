# 2026-05-31 - Web Pending Restore Presence

Decision: Web must treat `pendingSessionMemoryRestore` as a three-state server fact: omitted means leave the existing cache alone, explicit `null` means clear it, and a valid object means update it.

Why:

1. A malformed optional restore payload is not an authoritative clear. Turning parse failure into `null` makes client cache state more destructive than the app-server contract.
2. `thread/resume` should still be usable when optional restore metadata is malformed; stale inputs and other thread facts should not be discarded because one optional restore field failed validation.
3. Keeping the presence decision in the parser lets runtime cache writers stay simple: they only act on fields that are actually present.

Implementation note:

- `asThreadReplay()` and `parseThreadResumeResponse()` now omit malformed pending restore facts instead of converting them to `null` or rejecting the parent response.
- Web thread cache now carries pending restore facts with the same omitted/null/object update semantics used by other server-owned thread facts.

Canonical references:

- `docs/contracts/web-parity-adapter-contract.md`
- `docs/contracts/session-persistence-contract.md`
