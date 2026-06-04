# Codex-Style Worktree Diff Cards Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] `.doms/diff2.txt` shows the collapsed Codex review list: many file cards, each with its own header/toggle/stats, and no internal `<diffs-container>` for collapsed files.
- [x] `.doms/diff3.txt` shows an expanded Codex file card: the card/header/toggle remain outside, and exactly one internal `<diffs-container>` renders that file's diff.
- [x] `.doms/diff4.txt` shows a mixed Codex state: 24 file cards, 24 toggles/sticky headers, 2 expanded files, and 2 internal `<diffs-container>` nodes.
- [x] Codex's observed structure does not look like one multi-file `CodeView` owning the whole list.
- [x] The target structure is: outer React-owned file cards/toggles/sticky headers, inner single-file `@pierre/diffs` renderer only when a file is expanded.
- [x] Current Formax Web diff data contract is patch-first: `path`, `additions`, `deletions`, `patch`, `truncated`, and `untracked`.
- [x] This task is frontend structure work; it does not require changing app-server Git diff semantics.

### 0.2 Goals
- [x] Rebuild `WorktreeDiffPane` to match the Codex-style structure: one file card per file, React-owned toggle state, React-owned sticky file header, and single-file renderer per expanded file.
- [x] Remove `CodeView` as the primary worktree diff rendering path.
- [x] Keep the existing patch-fetching contract and lazy per-file patch request flow.
- [x] Preserve the already-tuned diff code visual style: font family, font size, line height, letter spacing, colors, gutters, and horizontal scrolling behavior.
- [x] Support unified and split view by passing `diffStyle` into each single-file renderer without remounting or rebuilding the whole file list unnecessarily.
- [x] Default to Codex-style collapsed files unless a test or existing UX contract proves a different default must be retained.

### 0.3 Non-goals
- [x] Do not introduce before/after full-file fetching in this task.
- [x] Do not implement opencode-style review annotations, line selection, comments, or accept/reject hunk actions.
- [x] Do not add custom virtual scrolling for this task.
- [x] Do not patch or monkey-patch `@pierre/diffs` internals.
- [x] Do not keep `DiffCodeView` as a parallel long-term implementation path.
- [x] Do not change app-server RPC names or Git command behavior.

### 0.4 Spec lock and review-scope
- [x] Spec lock required: the task changes Web UI state ownership and renderer boundaries.
- [x] Review is intentionally deferred until implementation, targeted tests, build, e2e smoke, screenshots, and manual screenshot inspection are all complete.
- [x] Do not run `codex review` after individual loops.
- [x] Do not treat review as useful before the feature has been verified in the running UI.
- [x] Final review command uses `gpt-5.3-codex` with medium reasoning; if `gpt-5.3-codex` fails to run, fall back to `gpt-5.4` with medium reasoning.
- [x] Create or update a review findings log if final review reports findings or if more than one final review run is needed.
- [x] Classify final review findings before code changes.
- [x] Final review is scoped by the completed todo and the accepted Codex-style structure.
- [x] Spec ambiguity stops implementation until `docs/todolist.md` or user alignment is updated.

### 0.5 Completion acceptance
- [x] This todo is complete only when the Codex-style diff card feature is implemented in the running Web UI, not merely planned or partially scaffolded.
- [x] All worktree diff files render as React-owned file cards with React-owned toggles and sticky headers.
- [x] Collapsed files do not mount a single-file diff renderer and do not create `<diffs-container>`.
- [x] Expanded files mount exactly one single-file diff renderer each.
- [x] Toggling a file open/closed does not remove, reorder, or visually drift other file cards.
- [x] Unified/split switching works and preserves expanded file state.
- [x] The worktree diff path no longer uses `CodeView` or `DiffCodeView`.
- [x] Targeted component tests, Web type-check, Web build, and targeted e2e smoke are complete.
- [x] Capture and inspect UI screenshots for collapsed list, expanded file, and unified/split states before marking the task complete.
- [x] Only after the implementation works and verification passes may all non-review todo items be marked `[x]`.
- [x] Only after all non-review todo items are `[x]` may final `codex review` be run.
- [x] Do not commit code unless final review has been run and all true blockers are fixed, or unless the user explicitly accepts unreviewed code and also accepts that it remains uncommitted.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Confirm no existing canonical contract needs changing because this keeps the bridge/app-server diff contract stable.
- [x] Check whether `packages/web-reference-react/CODEMAP.md` or root `CODEMAP.md` needs an ownership update after removing `DiffCodeView`.
- [x] If the final renderer boundary becomes long-lived, add a short learning note under `docs/learnings/` after implementation.

### 1.2 Data model
- [x] Keep `DiffFileViewModel` patch-first with `path`, `additions`, `deletions`, optional `patch`, and optional `untracked`.
- [x] Keep `DiffFilePatchPayload` patch-first with `found`, `truncated`, `patch`, `additions`, `deletions`, and optional `untracked`.
- [x] Define file expansion state as React-owned `Set<string>` keyed by file path.
- [x] Define default expansion semantics: collapsed by default, expanded state persists across unified/split toggles for the same snapshot.
- [x] Define snapshot refresh semantics: expansion state may reset only when the snapshot identity changes, unless tests establish existing behavior that must be preserved.

### 1.3 Types / Interfaces
- [x] Introduce a local file-card boundary with props for `file`, `expanded`, `loading`, `error`, `onToggle`, and `children`.
- [x] Keep single-file renderer props limited to patch rendering concerns: `path`, `patch`, `additions`, `deletions`, `truncated`, and `diffStyle`.
- [x] Keep `@pierre/diffs` imports and unsafe CSS details inside the single-file adapter boundary.
- [x] Remove `DiffCodeViewFile`, `CodeViewItem`, `CodeView` imports, and CodeView item assembly from worktree diff code.

### 1.4 Semantic decision table
| Decision | Accepted rule | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|
| Multi-file ownership | React/WorktreeDiffPane owns file card list, toggle state, and sticky header | `CodeView` owns all files/items | Web UI structure | tests assert one card/toggle per file |
| Diff renderer ownership | `@pierre/diffs` renders only expanded single-file content | Library owns outer list layout | Diff adapter | collapsed files have no `<diffs-container>` |
| Data contract | Keep patch-first bridge payloads | before/after full content fetching | Web/runtime bridge boundary | runtime tests keep current payload shape |
| Default visibility | Codex-style collapsed by default | all files expanded by default | Worktree diff UX | tests assert collapsed initial state |
| View mode | Unified/split is a renderer option, not a list remount model | separate list implementations per mode | Worktree diff UI state | expanded state survives view-mode toggle |
| Sticky header | CSS sticky belongs to each file card header | sticky handled by CodeView internals | File card layout | manual/e2e checks sticky per card |

### 1.5 Final review finding triage policy
- [x] Classify every final review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [x] Fix code only for true blockers inside the final gate contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, update the review findings log and bind the follow-up to a later todo item.
- [x] For spec ambiguity, stop implementation and update this todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted rule and add a focused regression test if needed.
- [x] Re-run final review only after triage is documented and targeted tests, build, e2e smoke, and screenshots remain passing.

## 2. Runtime / Platform
- [x] Leave `packages/core/src/app-server/devBridge.ts` behavior unchanged.
- [x] Leave Web runtime diff RPC names unchanged: `bridge/readDiffSummary`, `bridge/readDiffFilePatch`, and existing fallback read path.
- [x] Preserve `diffDataOps.ts` and `diffUiHandlers.ts` behavior unless a targeted test proves UI structure needs a small adapter-only adjustment.
- [x] Do not add new runtime state or bridge metadata for this task.

## 3. Frontend Boundary
- [x] Replace `DiffCodeView` usage in `WorktreeDiffPane.tsx` with Codex-style per-file card rendering.
- [x] Implement or extract a `DiffFileCard` component that owns header layout, toggle button, stats, sticky behavior, and collapsed body behavior.
- [x] Render `DiffPatchView` only inside expanded file cards.
- [x] Ensure collapsed file cards do not mount `DiffPatchView` and therefore do not create `<diffs-container>`.
- [x] Ensure expanded added-only/deleted-only/modified patches render through the same single-file renderer boundary.
- [x] Preserve loading/error/unavailable/truncated states inside the card body without changing the file count or card order.
- [x] Preserve horizontal scroll inside the single-file diff body while keeping line numbers/gutter behavior aligned with the tuned renderer CSS.
- [x] Remove the `DiffCodeView.tsx` file if no remaining caller needs it.
- [x] Remove stale tests/e2e expectations that assert `pierre-code-view` or CodeView-specific virtual layout.

## 4. Tests
- [x] Update `WorktreeDiffPane.test.tsx` to assert one file card/toggle per diff file.
- [x] Add tests that initial Codex-style state is collapsed by default.
- [x] Add tests that expanding one file mounts exactly one single-file renderer for that file.
- [x] Add tests that collapsing the file unmounts the single-file renderer and keeps the card visible.
- [x] Add tests that toggling a file does not remove or reorder other file cards.
- [x] Add tests that unified/split mode changes preserve expanded file state.
- [x] Add tests that patch loading/error/unavailable states appear inside the correct file card.
- [x] Update `DiffPatchView.test.tsx` only if the single-file adapter props or rendering contract need adjustment.
- [x] Update e2e smoke to assert Codex-style DOM: N cards/toggles, expanded count equals `<diffs-container>` count, and no CodeView virtual placeholder structure.
- [x] Run targeted Web component tests.
- [x] Run Web type-check.
- [x] Run Web build.
- [x] Run targeted e2e smoke on an isolated port if component tests and build pass.
- [x] Capture screenshots for collapsed list, one expanded file, multiple expanded files, and unified/split view after implementation.
- [x] Inspect screenshots for obvious spacing, sticky-header, toggle, horizontal-scroll, and renderer-mount regressions.

## 5. Recommended Execution Order

### Loop 1: Lock Structure With Tests
#### Loop Contract
- Purpose: lock the Codex-style file-card structure before replacing implementation.
- In scope: component tests and e2e expectation updates for card/toggle/single-renderer semantics.
- Out of scope: implementation rewrite beyond minimal test scaffolding.
- Blocking findings: tests that encode a structure contradicting `.doms/diff2.txt`, `.doms/diff3.txt`, or `.doms/diff4.txt`; tests that require backend contract changes.
- Non-blocking / later-loop findings: visual polish not affecting ownership boundaries.
- Known unresolved semantics: whether snapshot refresh preserves expansion state if existing tests prove current behavior differs.
- Required targeted tests: `WorktreeDiffPane.test.tsx` plus any necessary e2e expectation updates.
- Exit criteria: failing tests clearly describe the target structure.

- [x] update `WorktreeDiffPane.test.tsx` for Codex-style card/toggle/expanded renderer behavior.
- [x] update e2e assertions away from CodeView-specific selectors.
- [x] run targeted tests and confirm failures are expected before implementation.

### Loop 2: Replace CodeView With Codex-Style Cards
#### Loop Contract
- Purpose: remove the multi-file CodeView path and implement React-owned file cards with single-file diff bodies.
- In scope: `WorktreeDiffPane.tsx`, card extraction if useful, `DiffCodeView` removal, and direct `DiffPatchView` composition.
- Out of scope: before/after fetching, annotation review UI, custom virtualization, backend changes.
- Blocking findings: CodeView still owns the file list; collapsed files still mount diff renderers; file count/order changes on toggle; expanded state resets on view-mode change.
- Non-blocking / later-loop findings: minor spacing differences that do not affect structure or performance.
- Known unresolved semantics: none after Loop 1 unless tests expose a conflicting current contract.
- Required targeted tests: updated `WorktreeDiffPane.test.tsx`, relevant `DiffPatchView.test.tsx`, Web type-check.
- Exit criteria: component tests pass and CodeView is gone from the worktree diff path.

- [x] implement Codex-style file cards in `WorktreeDiffPane.tsx`.
- [x] render `DiffPatchView` only for expanded files.
- [x] remove `DiffCodeView` imports and CodeView item construction.
- [x] delete `DiffCodeView.tsx` if unused.
- [x] run targeted Web component tests.
- [x] run Web type-check.

### Loop 3: Visual/Interaction Polish and Smoke
#### Loop Contract
- Purpose: align the implemented structure with Codex-like interaction and the previously tuned renderer visuals.
- In scope: sticky header behavior, row height/header spacing, horizontal scroll, collapsed spacing, unified/split persistence, and e2e smoke.
- Out of scope: new product features, backend changes, line-level review actions.
- Blocking findings: sticky header fails within file card; horizontal scroll is broken; toggle causes cards to disappear/reorder; collapsed and expanded DOM counts mismatch the accepted structure.
- Non-blocking / later-loop findings: exact icon shape, optional open-in action, or future review annotation affordances.
- Known unresolved semantics: none.
- Required targeted tests: Web build, targeted e2e smoke, manual DOM count check if needed.
- Exit criteria: tests/build/smoke/screenshots pass and all non-review todo items are `[x]`.

- [x] verify sticky header behavior in the Codex-style card layout.
- [x] verify horizontal scrolling and fixed gutter/line-number behavior in expanded diff bodies.
- [x] verify unified/split switching with expanded files.
- [x] run Web build.
- [x] run targeted e2e smoke on an isolated port.
- [x] capture UI screenshots for collapsed list, expanded file, multiple expanded files, unified mode, and split mode.
- [x] inspect screenshots and record whether spacing, sticky headers, toggle state, and diff body alignment match the accepted Codex-style structure.
- [x] add/update a short learning note if the renderer boundary is now stable.
- [x] mark all non-review todo items `[x]` after implementation, tests, smoke, screenshot capture, and screenshot inspection close.

### Final Review and Commit Gate
#### Gate Contract
- Purpose: run review only after the feature is actually implemented and verified.
- In scope: final regression review of the completed Codex-style diff card implementation.
- Out of scope: using review to compensate for missing smoke, missing screenshots, or incomplete implementation.
- Blocking findings: any true blocker that breaks accepted structure, tests, smoke, screenshot evidence, or the patch-first data contract.
- Non-blocking / later-loop findings: optional polish or future features outside this todo's accepted scope.
- Required preconditions: every non-review todo item is `[x]`, targeted tests pass, type-check passes, build passes, targeted e2e smoke passes, screenshots are captured, and screenshots have been inspected.
- Exit criteria: final review is clean or all true blockers are fixed and re-verified.

- [x] confirm every non-review todo item is `[x]` before running final review.
- [x] run final `codex review` with `gpt-5.3-codex` and medium reasoning only after all implementation and verification items are `[x]`.
- [x] if `gpt-5.3-codex` review fails to run, retry final review with `gpt-5.4` and medium reasoning.
- [x] triage final review findings into the review findings log if any findings are reported.
- [x] fix true blockers from final review and re-run targeted tests/build/smoke/screenshots as needed.
- [x] re-run final `codex review` only after true blockers are fixed and verification remains passing.
- [x] if final review is skipped, do not commit code.
- [x] commit only after final review is clean or accepted true blockers are fixed and re-reviewed.
- [x] mark final review and commit-gate items `[x]` only after the gate is actually satisfied.
