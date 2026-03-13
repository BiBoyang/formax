# 2026-03-05: Web LeftRail row-level memoization

## What changed

- Updated `packages/web-reference-react/src/components/LeftRail.tsx`:
  - extracted folder header row into `MemoFolderHeaderRow` and thread row into `MemoThreadRow`.
  - switched key row handlers (`rename/archive/copy/start/remove/open-state`) to `useCallback` to reduce callback identity churn.
  - replaced per-render `nowMs` fan-out with a minute-bucketed `nowMsSnapshot` (`useMemo` keyed by minute bucket) so relative-time props remain stable within the same minute.
  - added guarded folder open-state update (`handleFolderOpenChange`) to avoid no-op state writes.
  - ensured `CollapsibleTrigger asChild` props are forwarded through `MemoFolderHeaderRow` root element (fixes trigger behavior with memoized row component).
  - kept `relativeTime` elapsed-minute calculation based on real timestamp delta (`Math.floor((nowMsSnapshot - ts) / 60_000)`) to avoid early hour/day rollover near minute boundaries.

- Updated tests in `packages/web-reference-react/src/components/LeftRail.test.tsx` remain green without behavior changes.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice G complete and regenerated Slice H/I.

## Why

- LeftRail had a large inline render block where group and thread rows were rebuilt on most parent rerenders.
- Row-level memoization with stable handlers reduces unnecessary subtree rerenders while keeping UI semantics unchanged.
- Forwarding trigger props is required when memoized components are used with `CollapsibleTrigger asChild`.

## Validation

- `npm --prefix packages/web-reference-react run test -- src/components/LeftRail.test.tsx src/App.test.tsx`
- `npm --prefix packages/web-reference-react run type-check`
- `bun run --cwd packages/web-reference-react test:perf:gate`
- `bun run --cwd packages/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
