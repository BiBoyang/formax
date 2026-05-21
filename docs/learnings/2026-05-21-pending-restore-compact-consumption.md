# Pending Restore Compact Consumption

Date: 2026-05-21

Session-memory restore reminders are next-turn-only request injections. A manual `/compact` command is a materializing compression turn, so it must clear any pending restore reminder even though the reminder should not be injected into the compact summary prompt.

The runtime rule is:

- `turn/start` injects pending restore blocks into the next model request and consumes them before dispatch.
- `command/dispatch /compact` consumes the same pending restore state before compact execution, but keeps the restore reminder out of the compact prompt.
- App-server replay should show `pendingSessionMemoryRestore` before dispatch and `null` after the compact turn consumes it.

This prevents a restored sidecar reminder from surviving past a materialized compact boundary and being injected into a later unrelated user turn.
