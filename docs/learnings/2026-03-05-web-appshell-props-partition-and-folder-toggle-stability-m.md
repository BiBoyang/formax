# 2026-03-05: Web AppShell props partition + folder-toggle session stability (Slice M)

## What changed

- Updated `apps/web-reference-react/src/app/ui/AppShell.tsx`:
  - stabilized resize and drag handlers via `useCallback`.
  - introduced commit helpers for sidebar/right-rail widths with functional no-op guards.
  - switched sidebar toggle to functional state update (`setIsSidebarOpen(prev => !prev)`).
  - partitioned child props by domain (`leftRailProps`, `transcriptPaneProps`, `inputApprovalDockProps`, `worktreeDiffPaneProps`) and reused memoized bundles for child mounts.
  - normalized panel derived values (`sidebarPanelSize`, `centerDefaultSize`, `devLoadAllDisabled`) outside JSX.
  - aligned `setIsSidebarOpen` prop type with `Dispatch<SetStateAction<boolean>>`.

- Fixed session-switch bug when toggling/selecting folder groups:
  - updated `apps/web-reference-react/src/app/runtime/threadActions.ts`:
    - `selectCwd` no longer auto-selects the first thread under target cwd.
    - selecting cwd now keeps current active thread/session unchanged and only updates cwd intent + diff context.
  - updated `apps/web-reference-react/src/app/runtime/useThreadSelection.ts`:
    - preserve explicit `selectedCwd` when it is still valid.
    - only sync from active thread cwd when no valid explicit selection remains.

- Added/updated tests:
  - `apps/web-reference-react/src/App.test.tsx`:
    - added regression: selecting a session folder keeps current session and URL thread id unchanged.
  - `apps/web-reference-react/src/app/runtime/threadActions.test.ts`:
    - added assertion that selecting existing cwd group does not switch active thread.
  - `apps/web-reference-react/src/app/runtime/useThreadSelection.test.tsx`:
    - added assertion that explicit valid cwd selection is preserved.

- Updated rolling plan files:
  - `plans/web-reference-react-refactor/README.md`
  - `plans/web-reference-react-refactor/TODO-INDEX.md`
  - marked Slice M complete and generated Slice N.

## Why

- AppShell is the top-level composition layer; unstable handlers and broad inline prop passing can amplify rerender churn.
- Folder toggle behavior previously coupled cwd selection with thread switching, causing unintended active-session/url changes.
- This slice keeps UI interaction semantics stable while removing unexpected session mutation side effects.

## Validation

- `npm --prefix apps/web-reference-react run test -- src/app/runtime/threadActions.test.ts src/app/runtime/useThreadSelection.test.tsx src/components/LeftRail.test.tsx src/App.test.tsx`
- `npm --prefix apps/web-reference-react run type-check`
- `bun run --cwd apps/web-reference-react test:perf:gate`
- `bun run --cwd apps/web-reference-react test:e2e:queue:guard`
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
