# Context Window Source, Binding, and Runtime Profile

Date: 2026-05-24

Context window bugs here were not mainly about a single provider field. The real failure mode was letting three different concepts masquerade as one number: detected capability, persisted snapshot, and effective runtime budget.

The stable convergence rule is:

- Capability detection may come from `provider_list`, `provider_detail`, `catalog`, `heuristic`, or `known_model_map`.
- Persisted snapshots need a bound model identity, not just a token count.
- Runtime execution must consume a frozen `RuntimeModelProfile` so model, provider/baseUrl, budget, and diagnostics all agree within the same turn.

Two guardrails mattered most:

- `binding_mismatch` is a first-class runtime state. A tier snapshot whose binding no longer matches the resolved model must stop being authoritative immediately.
- `FORMAX_CONTEXT_WINDOW_TOKENS` is a runtime override only. It must never be written back as if it were model capability.

This change deliberately avoided a full capability subsystem in the first pass. The immediate stability win came from provenance, binding, and runtime ownership being explicit in the existing flow, not from introducing a new cache/registry layer first.
