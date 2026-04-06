# 2026-04-06: Collapse recap contributors should not masquerade as normal user messages

## Context

After request-time `context collapse` landed, `/context` contributor drill-down still surfaced the synthetic recap row as a normal `user` message contributor because the recap is encoded as a user text block wrapped in `<system-reminder>`.

## Decision

- Keep the runtime recap message shape unchanged.
- In diagnostics, detect the recap by `CONTEXT_COLLAPSE_PREFIX` and expose it as `ContextContributor.kind = 'collapse_recap'`.
- Preserve stable contributor identity with a dedicated `collapse_recap:*` key.
- Keep `role` and `ordinal` so downstream drill-down still understands where the recap sits in the assembled request view.

## Why

- Clients should not need to reverse-engineer contributor labels to know whether a large assembled contributor is a synthetic request-time recap or an actual user-authored message.
- A dedicated contributor kind makes collapse diagnostics explainable first, before we introduce heavier collapse metadata/state.
- This keeps the current MVP lightweight: request-time projection stays request-only, while diagnostics gain explicit semantics.

## Follow-up

- If we later add richer collapse metadata/state, reuse `collapse_recap` as the contributor-level identity bridge instead of inventing a second client-facing label convention.
