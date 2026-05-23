# Web Reference React CODEMAP

This file is the "where to change what" index for `packages/web-reference-react`.

## Fast Start

- App entry: `src/main.tsx`
- App composition root: `src/App.tsx`
- Runtime assembly hook: `src/app/useAppRuntime.ts`
- Main shell/layout + shell owner gates: `src/app/ui/AppShell.tsx`, `src/app/ui/AppShellHeader.tsx`
- Transcript/composer surface: `src/components/TranscriptPane.tsx`
- Draft new-thread surface: `src/components/transcript/NewThreadDraftSurface.tsx`
- Left rail/thread list: `src/components/LeftRail.tsx`
- Terminal pane: `src/components/TerminalPane.tsx`
- Diff pane: `src/components/WorktreeDiffPane.tsx`
- Shared top-level styles: `src/styles.css`
- Theme variables: `src/css/theme.css`

## Data Flow (High-Level)

1. `rpcClient.ts` opens bridge RPC transport.
2. `app/runtime/*` receives events, replays history, and derives UI state.
3. `store.ts` + runtime reducers normalize turn/tool/projection data.
4. `useAppRuntime.ts` packages state + handlers for UI.
5. `AppShell.tsx` composes panes and passes scoped props to components.

## Where To Change

### Thread / Left Rail

- Grouping and folder display logic: `src/components/left-rail/utils.ts`
- Folder row interactions: `src/components/left-rail/FolderHeaderRow.tsx`
- Thread row interactions/menu: `src/components/left-rail/ThreadRow.tsx`
- Rail container + settings rail: `src/components/LeftRail.tsx`

### Transcript / Composer

- Transcript rendering + scroll + composer interaction: `src/components/TranscriptPane.tsx`
- Draft surface shell + project selector: `src/components/transcript/NewThreadDraftSurface.tsx`
- Composer submit gating / centered-vs-bottom layout: `src/components/composer/ComposerDock.tsx`
- Tool transcript rendering: `src/components/tool/*`
- Scroll boundary helper: `src/components/scrollBoundary.ts`
- Markdown rendering worker + runtime:
  - UI renderer: `src/components/MarkdownRenderer.tsx`
  - Worker: `src/workers/markdownRender.worker.ts`
  - Runtime utilities: `src/app/core/markdown*`

### Terminal

- Xterm lifecycle, theme sync, visibility/focus/fit behavior: `src/components/TerminalPane.tsx`
- Panel open/close and height persistence: `src/app/ui/AppShell.tsx`

### Diff

- Pane shell + refresh + file selection: `src/components/WorktreeDiffPane.tsx`
- Patch rendering primitives: `src/components/diff/*`
- Runtime fetch handlers: `src/app/runtime/diffDataOps.ts`, `src/app/runtime/diffUiHandlers.ts`
- Thread-only right-rail gating: `src/app/ui/AppShell.tsx`

### App Runtime / RPC Orchestration

- Runtime bootstrap: `src/app/runtime/initializeRuntime.ts`
- Notification pipeline: `src/app/runtime/processNotification.ts`
- Replay and cursor logic: `src/app/runtime/replayThreadEvents.ts`, `src/turnEventCursor.ts`
- Draft surface state + derived visible surface: `src/app/runtime/newThreadDraft.ts`, `src/app/runtime/useRuntimeViewState.ts`
- Thread-only cleanup + shell prop assembly: `src/app/useAppRuntime.ts`, `src/app/runtime/buildAppShellProps.ts`
- Workspace-selection-only sync: `src/app/runtime/useThreadSelection.ts`
- Thread actions: `src/app/runtime/threadActions.ts`, `src/app/runtime/threadUiHandlers.ts`
- First-send draft creation flow: `src/app/runtime/composerActions.ts`, `src/app/runtime/useRuntimeActionsBundle.ts`
- Connection/handshake: `src/app/runtime/connectRpcClient.ts`, `src/app/runtime/useInitializeHandshake.ts`
- URL-thread sync: `src/app/runtime/useThreadUrlSync.ts`
- Thread-scoped compact/collapse summary comparators: `src/app/core/compactBoundarySummary.ts`, `src/app/core/requestCollapseSummary.ts`

### Semantics / Parity Adapters

- Browser-side tool parity adapters: `src/parity/tools/*`
- Semantics barrel: `src/parity/semantics/index.ts`
- Event normalization adapter: `src/toolEventNormalizer.ts`

### Settings / i18n

- Settings model + defaults: `src/app/core/userSettings.ts`
- Settings UI: `src/components/SettingsPane.tsx`
- i18n provider/messages: `src/app/i18n/I18nProvider.tsx`, `src/app/i18n/messages.ts`

## Test Map

- App-level integration tests: `src/App.test.tsx`
- Left rail behavior: `src/components/LeftRail.test.tsx`
- Transcript behavior: `src/components/TranscriptPane.test.tsx`
- Runtime unit/integration: `src/app/runtime/**/*.test.ts?(x)`
- Core state machine/selector tests: `src/app/core/**/*.test.ts?(x)`
- Parity adapter tests: `src/parity/tools/parityAdapters.test.ts`

## Common Tasks

- Add/adjust header behavior: `src/app/ui/AppShell.tsx`
- Fix thread grouping label/order: `src/components/left-rail/utils.ts`
- Change slash/menu behavior: `src/components/TranscriptPane.tsx`
- Fix terminal open/close/fit regressions:
  - `src/components/TerminalPane.tsx`
  - `src/app/ui/AppShell.tsx`
- Adjust translucent desktop shell styling:
  - `src/styles.css`
  - `src/css/theme.css`

## Guardrails

- Preserve semantics contract behavior when changing runtime event ordering.
- For UI refactors, keep key interactions and copy stable unless explicitly requested.
- For style changes, use existing translucent tokens (`--sidebar-list-hover`, etc.) for list/header interactions.
