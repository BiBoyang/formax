# Anthropic Cache Editing Microcompact Boundary

Date: 2026-05-21

When aligning Formax microcompact with Claude Code cache editing, keep the boundary explicit:

- The persisted transcript remains authoritative; cache editing must not rewrite historical `tool_result` content.
- `microcompact` may produce an Anthropic request-only `cacheEditPlan`.
- The Anthropic stream client applies that plan only when a first-party Anthropic cache editing beta header is configured via `CACHE_EDITING_BETA_HEADER`, matching Claude Code's constant name.
- Beta fallback requests must remove both the `anthropic-beta` header and beta-only `cache_reference` / `cache_edits` payload blocks.
- `cache_deleted_input_tokens` is usage metadata from Anthropic cache editing, not a persisted-history mutation signal.

This keeps the Claude Code-style optimization isolated to request projection while preserving session replay, resume, and compact-boundary authority.
