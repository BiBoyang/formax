# 2026-05-11 - Snip boundary + MVP v1

## What changed

- Added a new request-time `snip` reducer under `/Users/david/Documents/github/formax/packages/core/src/chat/context/snip.ts`.
- Wired `snip` into the canonical middle-layer stage order:
  - `microcompact -> tool_result_budget -> snip -> collapse -> prune`
- Exposed `snipImpact` through `/context` diagnostics and the Web strict RPC parser.

## Boundary decision

`snip` v1 is intentionally narrow:

1. It only operates on `request_history_projection`.
2. It does not mutate persisted `history`.
3. It only targets older assistant messages whose content is pure text.
4. It does not touch user instructions, tool-result blocks, or mixed tool/text assistant messages.

This keeps `snip` from turning into another generic send-path mutation and gives it a clear boundary relative to:

- `tool_result_budget`
- `microcompact`
- `collapse`

## Why this shape

The remaining structural gap was no longer “add another compression trick”; it was “add a new reducer without collapsing the stage contract back into ad hoc branching”.

So the first snip version had to prove:

1. it has an independent stage identity,
2. it has request-only scope,
3. diagnostics and parser contracts can consume it directly,
4. it does not weaken the persisted/request envelope separation established in `CCA-144`.

## Follow-up implication

After `CCA-143`, the 14x middle-layer wave is complete. Future work should not keep extending reducers by default; it should start from a fresh post-`CCA-143` re-rank.
