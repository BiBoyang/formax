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
- Work in small steps, run the relevant checks after changes.
- If a check fails, fix and re-run.
- Do not claim completion until checks pass.
- Raise the bar: after checks pass, do a quick quality pass (clarity, duplication, edge cases) and run `codex review --uncommitted`; fix all high/medium findings and any low-risk issues that are clearly correct and low-churn.

TASK:
$TASK
