# Tier Context Window Tokens (Model Switch Safety)

Date: 2026-03-13

## What changed
- Added `llm.tierContextWindowTokens.{haiku,sonnet,opus}` to config schema.
- Runtime resolves effective `llm.contextWindowTokens` with precedence:
  - valid `FORMAX_CONTEXT_WINDOW_TOKENS` env override first
  - then active-tier value from `llm.tierContextWindowTokens`
  - then legacy single-value `llm.contextWindowTokens`
- `/model` tier switching now updates both:
  - `llm.tierContextWindowTokens` for the selected tier
  - `llm.contextWindowTokens` (legacy compatibility path)
- `/model` tier switching no longer probes provider APIs for model-window detection; it now uses local tier values and known-model metadata only.
- Setup write path now supports persisting tier-level context windows.

## Why
- Single-value `llm.contextWindowTokens` drifts when users switch across heterogeneous models.
- Drift causes misleading context meter output (e.g., very low free percent after short turns).

## Guardrail
- Keep env override highest-precedence for runtime debugging/ops, while tier mapping is the persisted source-of-truth when env override is absent.
- Keep `/model` as a local config operation (no network/API dependency) to avoid latency/cost regressions.
