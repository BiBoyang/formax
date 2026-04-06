## Context Diagnostics Prefer Latest Request Collapse Facts

Date: 2026-04-07

### What changed

- `/context` diagnostics can now surface a stable `latestRequestCollapse` summary when the latest request-time collapse fact is already known from runtime or persisted session events.
- The diagnostics contract keeps this summary intentionally small:
  - `phase`
  - `collapsedHeadMessageCount`
  - `estimatedTokensSaved`
  - `recapFingerprint` (optional)

### Why

- Before this change, diagnostics knew how to re-derive collapse impact, but they did not have a stable place to show the *actual latest collapse fact* already recorded by the runtime/session layer.
- That created avoidable drift risk:
  - runtime knew what happened
  - session persistence recorded what happened
  - diagnostics still looked mostly inferred

### Design choice

- We did **not** expose raw session-event rows in diagnostics.
- We normalized the data into a small summary shape so diagnostics stay a contract surface, not a replay dump.

### Result

- `/context` is now better aligned with the real runtime/session collapse path.
- This gives later app-server/Web surfaces a smaller and more stable bridge than re-scanning or re-deriving everything independently.
