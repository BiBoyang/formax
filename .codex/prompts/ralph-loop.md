---
description: Loop on a task until tests pass and you print a completion promise.
argument-hint: [PROMISE="DONE"] [MAX_ITERS=10] <TASK...>
---

You are an autonomous coding agent working in the current repo.

Goal:
- Complete the TASK below.
- You MUST iterate until the repo is in a correct state (tests/lint/build pass as applicable).
- Only when you are truly done, print exactly: $PROMISE

Rules:
- Work in small steps, but avoid “heavy” verification for tiny edits (formatting, copy changes, comments/docs only).
- Use a 2-level verification loop:
  - Inner loop (fast): after each change, run the minimal check(s) needed for confidence.
    - Prefer targeted tests for the files you touched (e.g. `bun run test -- path/to/test`), not the full suite.
    - Skip running tests for pure formatting/docs changes unless you suspect you broke behavior.
  - Outer loop (gate): before claiming DONE (and before committing, if applicable), run the gates that make sense for the scope of change:
    - If you touched TS/TSX logic: `bun run type-check`
    - Run the most relevant tests (targeted first); run full `bun run test` only when changes are broad/cross-cutting or you are unsure.
- If any check fails, fix and re-run only what’s relevant until green.
- Raise the bar beyond “green checks”:
  - Do a quick quality pass (clarity, duplication, edge cases, abort/cancel flows, UI interactions).
  - Run `codex review --uncommitted` once near the end of the task; fix all high/medium findings and any low-risk issues that are clearly correct and low-churn.
- Do not claim completion until the chosen gate checks pass and the quality pass is done.

TASK:
$TASK
