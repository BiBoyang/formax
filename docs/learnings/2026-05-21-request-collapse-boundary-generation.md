# Request Collapse Boundary Generation

Date: 2026-05-21

`latestRequestCollapse` is a request-projection diagnostic fact, not a durable compact-boundary fact. When app-server, replay, Web, or diagnostics surfaces expose it beside `latestCompactBoundary`, they must scope it to the current compact-boundary generation.

The safe rule is:

- If the latest `request_collapse_applied` event happened before the current compact boundary was first introduced in session history, surface `latestRequestCollapse: null`.
- If the collapse happened after that boundary, keep exposing it even if later `history_state` snapshots repeat the same compact boundary.
- Do not infer this from the last history snapshot alone; post-turn snapshots may contain the same boundary and would otherwise make a valid post-compact collapse look stale.

This keeps Web/header diagnostics from showing pre-compact request-collapse savings after a materializing compact has replaced the model-facing baseline.
