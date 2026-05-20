# 2026-05-21 - Compact boundary tail classification

- A latest compact boundary remains the authority for partial compact scope even when its continuation is empty. Empty continuation should stay empty instead of falling back to stale pre-boundary history.
- Compact summary user messages are not normal user turns. Tail selectors used by full compact and request-collapse must exclude them before applying `keepLastTurns` or working-set anchor logic.
- Manual `keepLastTurns=0` retaining a current execution cluster is intentional Formax behavior through `keep_combo`; it is not a Claude Code parity bug.
- Claude Code's time-based microcompact uses wall-clock gap since the last main-loop assistant message, while Formax currently uses subsequent non-tool user turns. Treat that as a separate semantic decision, not a Batch 4 bug fix.
