# Unified Session Rebuild TODO

Goal: unify TUI `/resume` and GUI/Web session rebuild paths with one shared tool-event reconstruction logic.

Scope note: canonical source is `app_tool_event`; legacy `ui_msg(tool)` is retained only as read fallback when a session has zero tool events.

## Mainline Loop

- [completed] Extract one shared `app_tool_event -> persisted tool messages` reconstructor module.
- [completed] Switch TUI `/resume` (`readSessionFile`) to use only reconstructed tool messages (ignore `ui_msg` tool rows).
- [completed] Switch app-server/Web path (`sessionEventReader`/thread reconstruction) to reuse the same reconstructor module.
- [completed] Update tests to lock unified behavior and mixed-session fallback rules (`app_tool_event` is canonical; unmatched legacy `ui_msg` tool rows are retained).
- [completed] Persist canonical TUI tool lifecycle as `app_tool_event` so newly created local sessions rebuild from the same canonical data source.
- [completed] Ensure oversized `app_tool_event` records are truncated (not dropped) so event-only replay does not lose tool rows.
