# 2026-03-05: Web useAppRuntime composition-root slimming (Slice Q)

## What changed

- Updated `packages/web-reference-react/src/app/useAppRuntime.ts`:
  - reduced composition-root size by extracting large local state, orchestration, and assembly blocks.
  - line count moved from ~793 to ~579 while preserving behavior.
  - retained responsibilities: lifecycle wiring, dependency composition, and AppShell output.

- Added `packages/web-reference-react/src/app/runtime/useRuntimeViewState.ts`:
  - centralizes runtime local view state + no-op guarded stable setters.
  - centralizes thread cache slice updaters (`logs/historyCursor/transcriptSource`).

- Added `packages/web-reference-react/src/app/runtime/useRuntimeEventOrchestrator.ts`:
  - encapsulates notification pipeline (`processNotification`) + replay pipeline (`replayThreadEvents`) + archived-thread notification coordination.

- Added `packages/web-reference-react/src/app/runtime/useRuntimeActionsBundle.ts`:
  - encapsulates thread/composer action assembly (`createThreadActions` + `createComposerActions`), including `selectThreadRef` synchronization.

- Added `packages/web-reference-react/src/app/runtime/buildAppShellProps.ts`:
  - converts sectioned runtime output (`thread/layout/transcript/approval/diff/feedback`) into `AppShellProps`.

- Added `packages/web-reference-react/src/app/runtime/rpcQueueMetrics.ts`:
  - encapsulates bounded-queue metric delta logging strategy.

- Added tests:
  - `packages/web-reference-react/src/app/runtime/buildAppShellProps.test.ts`
  - `packages/web-reference-react/src/app/runtime/rpcQueueMetrics.test.ts`

## Why

- After prior boundary refactors, `useAppRuntime` still held too much assembly noise and cross-domain orchestration detail.
- Splitting these concerns keeps architecture intent explicit:
  - state ownership in dedicated state hook,
  - event pipeline in dedicated orchestrator,
  - action construction in dedicated bundle,
  - output mapping in dedicated adapter.
- This lowers maintenance risk for future runtime changes without changing app semantics.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/App.test.tsx src/app/runtime/threadActions.test.ts src/app/runtime/integration/threadArchiving.test.ts src/app/runtime/orchestrator/runtimeRegressions.integration.test.ts src/app/runtime/useThreadSelection.test.tsx src/app/runtime/threadDataOps.test.ts src/app/runtime/diffDataOps.test.ts src/app/runtime/useDevLoadAllHistory.test.tsx src/app/runtime/rpcQueueMetrics.test.ts src/app/runtime/buildAppShellProps.test.ts`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
