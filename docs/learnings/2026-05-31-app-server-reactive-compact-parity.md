# 2026-05-31 - App-server reactive compact parity

Decision: interactive app-server turns should match the TUI reactive compact fallback. SDK query remains fail-fast by default until an explicit SDK option is designed.

Why:

1. GUI and TUI are both interactive product surfaces. If one can recover from provider context overflow by compacting and retrying once, the other should not fail immediately for the same conversation state.
2. SDK callers are programmatic. Hidden compact + retry can change latency, cost, retry accounting, and structured-output failure handling. Keeping SDK fail-fast is the conservative default.
3. Reactive compact remains a send-path retry policy, not a middle-layer reducer. The retry must use reactive-prepared `history`, `requestHistory`, `requestUser`, and `cacheEditPlan`.
4. The fallback still preserves the existing boundaries: abort/interrupted wins before overflow classification, auth/rate-limit errors do not trigger compact, and a failed retry does not start a second compact loop.

Implementation note:

- app-server `TurnRunner` now attempts reactive compact on eligible provider overflow and retries at most once.
- app-server persists the small `reactive_compact_applied` fact when fallback preparation is applied; this fact means "retry attempted", not "retry succeeded".
- SDK query characterization tests intentionally continue to assert one `runTurn()` call and `error_during_execution` for context-overflow provider failures.
