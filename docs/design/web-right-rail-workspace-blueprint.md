# Web Right Rail Workspace Blueprint

## Purpose

The web right rail is evolving from a single-purpose worktree diff pane into a workspace that can host multiple side features.

This document records the target model before the implementation grows further, so UI structure, terminology, and future feature cuts stay consistent.

## Scope

This blueprint covers the desktop web right rail in `packages/web-reference-react`.

Current implementation focus:

- Review tab shell.
- Worktree diff review toolbar.
- Worktree diff file list and file bodies.

Deferred feature families:

- Terminal tab.
- Browser tab.
- Files tab.
- Side chat tab.
- Commit / push and pull request flows.

## Concept Model

The right rail has two top-level layers.

### 1. Right Rail Workspace Header

This is the top-level rail navigation, similar to a browser tab strip.

Target shape:

- Active tab: Review.
- Add button: opens a menu of possible right-rail feature tabs.
- Future menu entries: Review, Terminal, Browser, Files, Side Chat.

Current implementation rule:

- Only Review is functional.
- Non-review entries may be visible as disabled or omitted until backed by real behavior.
- This layer must not contain worktree diff controls.

### 2. Active Workspace Content

This is the content area owned by the active Workspace Tab.

Current implementation:

- Review Tab renders Review Pane.
- Other workspace tabs are deferred.

Important structural rule:

- Do not model Right Rail as `Workspace Header + Review Toolbar + Review Body`.
- Model it as `Workspace Header + Active Workspace Content`.
- Review Toolbar is part of Review Pane, not a fixed Right Rail row.

#### Review Pane

Review Pane is the active content rendered by Review Tab. It contains Review Toolbar and Review Body.

##### Review Toolbar

This is the header inside the Review tab. It controls the current review source and review display.

Target controls:

- Source dropdown.
- Changed-file count.
- Aggregate diff stats.
- More menu.
- Expand / collapse all file cards.
- Unified / split diff view toggle.

Initial functional subset:

- Source dropdown exposes the target source map, but only `Unstaged` is functional.
- File count and aggregate additions/deletions are derived from the current worktree diff snapshot.
- Expand / collapse all controls the open state of file cards.
- Unified / split toggle uses the existing diff view mode state.
- More menu may be scaffolded with only low-risk actions such as refresh; complex actions stay deferred.

Review source map:

- `Unstaged`: active now. Shows the current unstaged worktree diff.
- `Staged`: disabled placeholder. Future source for `git diff --cached`.
- `Commit`: disabled placeholder. This means inspecting the file diff for an existing commit; it is not the commit/push action.
- `Branch`: disabled placeholder. Future source for comparing against another branch or base.
- `Previous conversation`: disabled placeholder. Future source for reviewing a previous conversation's captured diff.

Review more menu map:

- `Refresh`: active now. Reloads the current worktree diff snapshot.
- `Enable word wrap`: disabled placeholder. Future renderer display option.
- `Do not load full file`: disabled placeholder. Future file-context loading policy.
- `Enable rich text preview`: disabled placeholder. Future preview mode for rich text formats.
- `Enable word diff`: disabled placeholder. Future inline word-level diff option.
- `Hide whitespace`: disabled placeholder. Future whitespace display option.
- `Copy git apply command`: disabled placeholder. Future clipboard helper for applying the current patch.

Deferred Review Toolbar controls:

- Show in folder.
- Commit or push.
- Create pull request.
- Functional staged/commit/branch/previous-conversation sources.
- Functional rich text preview, full-file loading, whitespace, text-diff, and auto-wrap toggles unless the renderer has stable behavior and tests.

##### Review Body

This is the list of reviewed files and their opened content.

Current supported body types:

- Patch diff body.
- Split or unified diff rendering.
- Image preview body for previewable image files when the preview handler exists.
- Unavailable / loading / error states for files that cannot render.

Future body types:

- Full-file view around a diff.
- Binary file summaries.
- PDF preview.
- Other file-specific previewers.

## Terminology

- Right rail: the entire third column.
- Right rail workspace: the right rail as a multi-feature host.
- Rail tab: one top-level right-rail feature such as Review or Terminal.
- Review: the rail tab that owns worktree diff review.
- Review toolbar: the toolbar inside Review for source, stats, and display controls.
- Diff file card: one file row plus its optional opened body.
- File body: the renderable body under a file card header.

Avoid calling the entire right rail "the diff pane" once the top-level workspace shell exists. The diff pane is only the Review tab body.

## Naming Map

Use these names when discussing or implementing the right rail UI.

### App Shell Level

- **Center Pane**: the middle conversation/thread area.
- **Right Rail**: the whole third column, including its workspace header and active content.
- **Top Right Controls**: the stable shell-level buttons near the window's top-right corner.
- **Terminal Toggle**: the Top Right Controls button that opens or closes the bottom terminal panel.
- **Right Rail Toggle**: the Top Right Controls button that opens or closes the Right Rail.
- **Floating Top Right Controls**: the closed-rail version of Top Right Controls. It is not a Right Rail header and must not render a rail separator or workspace tab UI.

### Right Rail Workspace Level

- **Workspace Header**: the first row inside the open Right Rail. It hosts workspace-level navigation and receives Top Right Controls as a trailing slot.
- **Workspace Header Height**: the shared desktop chrome height, currently `46px`, aligned with Center Pane header height.
- **Workspace Header Separator**: no bottom border. The first visible separator belongs to the active Workspace Content, such as Review Toolbar.
- **Workspace Tab Strip**: the left side of the Workspace Header where rail tabs live.
- **Workspace Tab**: one tab in the Workspace Tab Strip, such as Review, Terminal, Browser, Files, or Side Chat.
- **Review Tab**: the active Workspace Tab for worktree review.
- **Workspace Tab Height**: the compact tab control height inside Workspace Header, currently `26px`.
- **Add Tab Button**: the plus button beside Workspace Tabs.
- **Add Tab Menu**: the menu opened by the Add Tab Button.
- **Workspace Empty Launcher**: the centered launcher shown when no Workspace Tab is open. It lists possible workspace features such as Review, Terminal, Browser, Files, and Side Chat.
- **Workspace Content**: the area below the Workspace Header that renders the active Workspace Tab's content.

### Review Tab Level

- **Review Pane**: the active content rendered by the Review Tab.
- **Review Toolbar**: the first row inside the Review Pane. It contains source, stats, display, and refresh controls.
- **Review Toolbar Height**: `40px`, matching the Codex review toolbar row.
- **Review Source Selector**: the `Unstaged` dropdown in the Review Toolbar.
- **Review Source Count Badge**: the count pill inside the Review Source Selector.
- **Review Aggregate Stats**: the total additions/deletions shown beside the Review Source Selector.
- **Review More Menu**: the future three-dot menu for review display options and actions.
- **Review Expand Toggle**: the single button that expands all file cards or collapses all file cards depending on current file-open state.
- **Review View Mode Toggle**: the unified/split segmented control.
- **Review Refresh Button**: the refresh button for reloading the worktree diff snapshot.
- **Review Body**: the scrollable area below the Review Toolbar.
- **Diff File Card**: one file row plus its optional opened content.
- **Diff File Header**: the clickable file row inside a Diff File Card.
- **Diff File Body**: the opened content area inside a Diff File Card.
- **Patch Body**: text diff rendering inside a Diff File Body.
- **Image Preview Body**: image preview rendering inside a Diff File Body.

## State Ownership

Right rail open/closed state:

- Owned by the AppShell panel state.
- Controlled by the right-rail toggle in the stable top-right shell controls.

Active rail tab:

- Future state.
- Should be owned by the right rail workspace shell.
- Initial value is always Review.

Review source:

- Future state.
- Initial value is always Unstaged.
- Must not imply staged/commit/branch behavior until those data sources exist.

Diff view mode:

- Existing unified/split state remains owned by the WorktreeDiffPane/Review feature boundary until extracted deliberately.

File open state:

- Owned by the Review body.
- Expand/collapse all should operate through the same state owner as individual file toggles.
- Do not introduce a parallel "all open" state that can diverge from per-file state.

Image preview state:

- Per file.
- Only enters preview mode when a preview handler is available and the file path is previewable.

Terminal open state:

- Owned by `useTerminalVisibility`.
- Visibility is keyed by active thread id.
- The terminal toggle selected state should reflect `showTerminalPane`.

## Layout Contract

The right rail column should be structured as:

```text
RightRail
  WorkspaceHeader
  WorkspaceContent
    ReviewPane
      ReviewToolbar
      ReviewBody
```

The AppShell-level stable controls are separate from the right rail content:

- Terminal toggle.
- Right rail open/close toggle.

These controls should not move when the rail opens/closes or when the center/right split changes.

The bottom terminal panel belongs to the center-plus-right region, not only the center pane.

## Implementation Notes

Suggested component names:

- `AppShellTopRightControls`
- `RightRailWorkspaceHeader`
- `RightRailAddMenu`
- `ReviewPane`
- `ReviewToolbar`
- `ReviewSourceDropdown`
- `ReviewDisplayControls`

Existing components to preserve:

- `WorktreeDiffPane` can become or delegate to `ReviewPane`.
- `DiffFileCard`, `WorktreeDiffFileBody`, and `ImagePreviewBody` should remain the Review body building blocks.

Extraction guidance:

- First extract structure without changing renderer behavior.
- Keep AppShell-level stable controls separate from the workspace header; the workspace header can receive them through a slot while the closed rail uses the same controls without rendering a workspace header.
- Keep Review Toolbar behavior small and explicit.
- Prefer disabled or omitted controls over fake functional buttons.
- Add behavior only when the underlying state/data source exists.

## Non-goals For The First Implementation Pass

- Implementing staged diff review.
- Implementing commit / push.
- Implementing pull request creation.
- Implementing browser/files/side-chat tabs.
- Moving terminal rendering into the right rail tab system.
- Rewriting diff rendering.
- Adding speculative data sources or RPCs.

## Acceptance Criteria For The First Implementation Pass

- The right rail reads as a workspace with an active Review tab.
- Review has its own toolbar separate from the top-level rail tab header.
- Existing worktree diff rendering still works.
- Existing image preview behavior still works.
- Existing unified/split mode still works.
- Existing file open/close behavior still works.
- Expand/collapse all uses the same file open state as individual file toggles.
- The stable top-right terminal and right-rail toggles do not shift position when the right rail opens/closes.
- The bottom terminal still spans the center-plus-right region.
