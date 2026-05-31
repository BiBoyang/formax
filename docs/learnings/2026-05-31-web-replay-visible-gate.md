# 2026-05-31 - Web Replay Visible Gate

Decision: Web replay hydration and live notification sequencing must be separate gates. Replay uses the thread replay cursor; live notifications use the live sequencer. Visible transcript/chrome updates require an active visible thread whose id matches the notification thread.

Why:

1. The live notification sequencer is intentionally global for live de-dupe, but replay can hydrate older per-thread events. Reusing the live gate for replay makes one thread's newer live event reject another thread's older replay page.
2. Draft and no-thread surfaces are not active thread surfaces. They may keep thread-scoped runtime bookkeeping, but they must not receive canonical projection rows, active-turn chrome, or mode changes from a background thread.
3. Keeping replay hydration independent avoids weakening live de-dupe while preserving deterministic replay recovery.

Implementation note:

- `useRuntimeEventOrchestrator()` now routes replay entries through the same runtime notification reducer with a replay-local accept gate, while live `handleNotification()` still uses `shouldProcessSequencedNotification`.
- `isNotificationForActiveThread()` now requires both a notification thread id and a non-null active thread id match before visible side effects are allowed.

Canonical references:

- `docs/contracts/web-parity-adapter-contract.md`
