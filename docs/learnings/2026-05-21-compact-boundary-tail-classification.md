# 2026-05-21 - Compact boundary tail classification

- A latest compact boundary remains the authority for partial compact scope even when its continuation is empty. Empty continuation should stay empty instead of falling back to stale pre-boundary history.
- Compact summary user messages are not normal user turns. Tail selectors used by full compact and request-collapse must exclude them before applying `keepLastTurns` or working-set anchor logic.
- Manual `keepLastTurns=0` retaining a current execution cluster is intentional Formax behavior through `keep_combo`; it is not a Claude Code parity bug.
- Superseded on 2026-05-21: the separate semantic decision has now been made. Formax microcompact follows Claude Code-style cache-editing / cold-cache wall-clock assistant-gap semantics; the older deterministic user-turn-based microcompact path is no longer the active contract.
- `toolResultBudget` skips zero-savings replacement candidates with `continue`; it must still evaluate later candidates before deciding whether the budget reducer applied.
