# 2026-05-12 - Manual compact task-minimal parity

- `runCompactFlow()` no longer special-cases manual `/compact` into `keep_last_turns`. Manual and auto compact now both materialize their compact boundary through the same task-minimal `keep_combo` selector.
- The selector remains canonical in `packages/core/src/chat/context/compact.ts`. This change only widens who consumes it; it does not introduce a second compact-boundary authority model or change replay/session persistence ownership.
- The practical behavior change is intentional: even when manual compact is invoked with `keepLastTurns=0`, the rebuilt tail may still retain the current task anchor, recent files, and planning state when the working-set selector deems them necessary.
- Tests lock both the metadata shape (`keep_combo` on manual compact boundaries) and the preserved-tail behavior for a current execution cluster so manual `/compact` no longer regresses behind auto compact.
