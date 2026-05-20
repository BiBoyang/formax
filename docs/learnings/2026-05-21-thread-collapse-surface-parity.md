# 2026-05-21 - Thread collapse surface parity

- `thread/read` and `thread/messages` already exposed `latestRequestCollapse`, and `/context` could report the same request-time collapse fact.
- `thread/resume` and `thread/replay` now expose the same optional `latestRequestCollapse` summary so restore, replay, history, and diagnostics surfaces do not require different inspection paths.
- The field remains a read-only request-time fact sourced from persisted request-collapse events. It does not rewrite replay `data[]`, timeline rows, or canonical persisted history.
- Web runtime caches the summary from `thread/resume`, `thread/messages`, and `thread/replay`; clients should not infer collapse state from transcript rows.
