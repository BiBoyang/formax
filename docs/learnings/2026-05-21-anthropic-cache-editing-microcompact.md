# Anthropic Cache Editing Microcompact Boundary

Date: 2026-05-21

When aligning Formax microcompact with Claude Code cache editing, keep the boundary explicit:

- The persisted transcript remains authoritative; cache editing must not rewrite historical `tool_result` content.
- `microcompact` may produce an Anthropic request-only `cacheEditPlan`.
- The Anthropic stream client applies that plan only when a first-party Anthropic cache editing beta header is configured via `CACHE_EDITING_BETA_HEADER`, matching Claude Code's constant name.
- Beta fallback requests must remove both the `anthropic-beta` header and beta-only `cache_reference` / `cache_edits` payload blocks.
- `cache_deleted_input_tokens` is usage metadata from Anthropic cache editing, not a persisted-history mutation signal.
- Claude Code's time-based microcompact is a cold-cache path: when the assistant wall-clock gap exceeds the prompt-cache TTL threshold, clear older tool results in the request projection and skip cache edits for that turn. Persist assistant timestamp metadata only so the next turn can evaluate the gap; do not persist the cleared tool-result content.
- When cache editing is unavailable and the cold-cache assistant-gap trigger has not fired, `microcompact` should no-op. Do not fall back to Formax's older content-stub or user-turn stale-result heuristics on a potentially warm prompt prefix; later reducers and auto-compact own that pressure.

This keeps the Claude Code-style optimization isolated to request projection while preserving session replay, resume, and compact-boundary authority.
