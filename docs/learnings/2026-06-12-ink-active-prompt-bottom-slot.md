# 2026-06-12 - Ink active prompt bottom slot

Root cause: active approval controls were owned by transcript tool rows, so parallel tool starts could append a later running row after an already-visible prompt. That made the prompt appear in the middle of the transcript instead of near the ordinary input position.

Decision: the Ink REPL active prompt is now owned by a bottom prompt slot driven by `UserInputManager.getActivePrompt()`. Transcript rows remain responsible for status, summaries, and non-interactive previews only.

Boundary: this is a renderer ownership change, not a permissions/policy change. Pending approvals are not rechecked, merged, dropped, auto-resolved, or reordered because the UI moved.

Canonical docs:
- `docs/contracts/interactive-input-contract.md`
- `docs/contracts/transcript-surface-contract.md`
- `docs/contracts/permissions-policy-contract.md`
