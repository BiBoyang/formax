# 2026-05-12 - Task-minimal working-set selector v5

## What changed

- `compact.ts` no longer treats working-set retention as filesystem-only.
- The selector now recognizes a `task_execution_cluster` anchor when recent successful execution tools appear in the same task turn, including combinations such as `Read + Edit + TodoWrite`.
- Auto keep strategy now combines:
  - recent files
  - plan state
  - todo state
  - mode state
  - task-execution anchor presence

## Why

The previous selector solved “recent filesystem exploration should not be dropped too early,” but it still missed the broader task shape:

1. recent planning state
2. recent execution/todo state
3. code-reading and code-editing cluster relatedness

That meant the system could still preserve the wrong tail for long-running tasks even after middle-layer stack convergence.

## Practical outcome

- `Read` remains a narrow one-turn anchor.
- `filesystem_cluster` remains a two-turn anchor.
- `task_execution_cluster` is now a three-turn anchor.
- `/context` can now explain the choice through:
  - `taskStateKinds`
  - `selectionReasons`
  - `anchorKind`
  - `anchorToolNames`
  - `anchorBacktrackTurns`
  - `anchorMaxBacktrackTurns`

## Constraint

This change remains compact-side only:

- it does not change persisted authority
- it does not add a new reducer
- it does not alter middle-layer stage ownership
