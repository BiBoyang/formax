# 2026-03-04: Web thread action context stabilization

## What changed

- Updated `apps/web-reference-react/src/app/useAppRuntime.ts`:
  - added ref-backed state accessors (`activeTurnIdRef`, `pendingInputsRef`, `sortedThreadsRef`).
  - built `threadActionsState` with getters so thread actions read latest runtime state at call time.
  - reduced `createThreadActions` memo dependencies by removing high-frequency state slices (`logs`, `pendingInputs`, `logsByThreadId`) from closure coupling.

- Updated `apps/web-reference-react/src/app/runtime/threadActions.ts`:
  - `createThreadTransactions` is now initialized with getter-backed fields (`selectedCwd`, `state`, `sortedThreads`, `logsByThreadId`) rather than eager snapshot values.
  - this prevents stale snapshot reads when action functions remain stable across frequent render updates.

- Added regression coverage in `apps/web-reference-react/src/app/runtime/threadActions.test.ts`:
  - new test verifies archive fallback selection uses latest thread ordering even when context snapshots are replaced after action creation.

## Why

- `useAppRuntime` previously rebuilt the thread action bundle on high-frequency updates, including transcript/log churn.
- Frequent action identity churn leaks into memoized UI children through callback props, causing avoidable rerenders.
- Getter + ref access keeps callbacks stable while preserving correctness for asynchronous/late-invocation flows.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/app/runtime/threadActions.test.ts src/app/runtime/integration/threadArchiving.test.ts src/App.test.tsx`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
