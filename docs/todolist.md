# Git Full-File Diff Expansion Todo

Current status: implementation, docs, targeted tests, and type-check are complete. `codex review` is intentionally skipped per the active user goal: finish the todo first and do not review yet.

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] The existing Review view renders source-aware Git diffs for `unstaged`, `staged`, and selected `commit` sources.
- [x] `@pierre/diffs` supports expandable unchanged-line separators when it receives complete file metadata instead of partial patch-only metadata.
- [x] Codex keeps the first expanded-file view visually close to normal patch rendering, but clickable separators can reveal hidden unchanged context.
- [x] Codex appears to reveal a bounded amount of unchanged context per click, roughly up to 20 lines per side / 40 total depending on available hidden lines.
- [x] The separator DOM and click behavior should come from `@pierre/diffs`; we should not hand-roll separator rows.
- [x] Full-file loading must be lazy and file-scoped, not a source-wide eager load.
- [x] Full-file mode is a Review toolbar option, not a new Review source.
- [x] Binary files, image previews, and unavailable blobs should keep their current fallback behavior.

### 0.2 Goals
- [x] Add a `Load full file` / `Do not load full file` Review option.
- [x] When enabled, expanded text file cards can request full before/after file content for the active Git source.
- [x] Feed full-file metadata into `@pierre/diffs` so unchanged-line separators become expandable.
- [x] Preserve the normal partial-patch path when full-file mode is disabled or full content is unavailable.
- [x] Keep source semantics correct for `unstaged`, `staged`, and `commit`.

### 0.3 Non-goals
- [x] Do not implement our own custom unchanged-line expander UI.
- [x] Do not load full content for all files when a source opens.
- [x] Do not change image preview behavior in this task.
- [x] Do not implement rich Markdown rendering; Markdown remains raw text diff rendering.
- [x] Do not add branch compare or previous-conversation diff semantics.
- [x] Do not make full-file mode the default in the first implementation.

### 0.4 Spec lock and review-scope
- [x] Spec lock required: this crosses Git object access, bridge RPC, Web runtime cache identity, and diff renderer behavior.
- [x] Review findings must be classified before code changes.
- [x] Current-loop review is scoped by each loop's `Loop Contract`.
- [x] Later-loop findings are logged, not chased in the current loop.
- [x] Spec ambiguity stops implementation until this todo or user alignment is updated.
- [x] Use the repository review profile as the single source of truth; do not redefine review model, reasoning, or timeout here.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Update `docs/design/web-right-rail-workspace-blueprint.md` with the full-file option semantics after implementation stabilizes.
- [x] Update `CODEMAP.md` only if a new long-lived Git Review operation or ownership point is introduced.
- [x] Add or update a pitfall note only if implementation confirms a new renderer/server boundary gotcha.

### 1.2 Data model
- [x] Define a source-aware full-file request payload: `source`, `path`, optional old path metadata, `cwd`, and byte/line caps.
- [x] Define a full-file response that can represent: available text sides, unavailable, too large, binary, not in diff, and read error.
- [x] Define per-file full-content cache identity using active source key, snapshot key, cwd, path, and mode flags.
- [x] Define unsupported cases to fail closed instead of reading arbitrary filesystem paths.

### 1.3 Git semantics
| Source | Before side | After side | Notes |
|---|---|---|---|
| `unstaged` tracked | index blob | worktree file | Includes worktree-vs-index changes. |
| `unstaged` untracked | empty | worktree file | Only if the path belongs to the current unstaged diff set. |
| `staged` tracked | `HEAD` blob | index blob | Index-vs-HEAD changes. |
| `staged` root/new | empty | index blob | Root commit / new file support should be explicit. |
| `commit` normal | first parent blob | selected commit blob | First-parent merge behavior remains accepted. |
| `commit` root | empty | selected commit blob | Root commit support remains accepted. |
| deleted file | previous blob | empty | Applies per source. |

### 1.4 Renderer semantics
- [x] Keep partial-patch rendering as the default path.
- [x] When full content is available, construct complete file metadata for the selected file and let `@pierre/diffs` own separator expansion.
- [x] Use `hunkSeparators` mode that exposes line-info expansion controls.
- [x] Use bounded expansion per click rather than expanding all hidden context by default.
- [x] Preserve current safeguards for large diffs and word-diff disabling.

### 1.5 Review finding triage policy
- [x] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [x] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, update the review findings log and make sure a future loop owns the acceptance item.
- [x] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test if needed.

## 2. Runtime / Platform
- [x] Add a Git Review operation for source-aware full-file content reads.
- [x] Validate the requested path belongs to the active source's diff set before reading content.
- [x] Enforce byte caps before returning full content.
- [x] Return structured unavailable states for binary, too-large, missing, or unsupported rename cases.
- [x] Add a `bridge/reviewGit/*` RPC route for full-file content.
- [x] Keep existing summary, patch, image preview, and commit list routes unchanged.

## 3. Frontend Boundary
- [x] Add full-file mode state owned by the Review toolbar/workspace, default off.
- [x] Wire the More menu item label between `Load full file` and `Do not load full file`.
- [x] Request full content lazily only when a text file card is expanded and full-file mode is enabled.
- [x] Scope full-content loading, cache, and stale-response guards by source key and snapshot key.
- [x] Keep normal patch display while full content is loading or unavailable.
- [x] Pass complete metadata/options to `DiffPatchView` only when full content is available.
- [x] Ensure file collapse/expand still works without double-click or stale body states.

## 4. Tests
- [x] Add core Git operation tests for unstaged tracked, unstaged untracked, staged, commit, root commit, and deleted file full-content reads.
- [x] Add bridge tests for the new full-content route and path-in-diff validation.
- [x] Add Web runtime tests for request payload, source key scoping, and stale response handling.
- [x] Add component tests for toggling full-file mode and requesting full content only for expanded text files.
- [x] Add renderer-facing tests that prove full metadata enables expandable separators without custom separator DOM.
- [x] Run targeted core tests.
- [x] Run targeted Web runtime/component tests.
- [x] Run `bun run type-check`.

## 5. Recommended Execution Order

### Loop 1: Full-Content Contract and Core Git Reads
#### Loop Contract
- Purpose: create the safe source-aware backend capability without changing UI behavior.
- In scope: operation type, Git read planning, path-in-diff validation, byte caps, bridge route, core/bridge tests.
- Out of scope: toolbar menu UI, renderer expansion, visual polish.
- Blocking findings: arbitrary filesystem reads, wrong source side selection, no path-in-diff validation, uncapped large reads.
- Non-blocking / later-loop findings: rename UX polish, richer error copy.
- Known unresolved semantics: exact rename full-content handling may be unavailable in first pass if existing metadata is insufficient.
- Required targeted tests: core Git Review operation tests and devBridge route tests.
- Review prompt scope: backend/RPC safety and source semantics only.
- Exit criteria: full-content route safely returns before/after text or structured unavailable states.

- [x] define full-content request/response types.
- [x] implement source-aware Git full-content operation.
- [x] add bridge route.
- [x] add core/bridge tests.
- [x] run targeted core/bridge tests.
- [x] no review findings to triage because `codex review` is intentionally skipped per the active user goal.
- [x] skip `codex review` for this loop per the active user goal; targeted verification passed.

### Loop 2: Web State and Lazy Full-Content Loading
#### Loop Contract
- Purpose: wire the option and lazy file-scoped loading without changing renderer internals.
- In scope: toolbar option, runtime request, file-card state, cache identity, stale guards, fallback behavior.
- Out of scope: custom separator implementation, image preview changes, default-on behavior.
- Blocking findings: eager loading all files, source cache leaks, double-click expansion regressions, broken partial fallback.
- Non-blocking / later-loop findings: final icon/copy polish.
- Known unresolved semantics: none after Loop 1.
- Required targeted tests: Web runtime and `WorktreeDiffPane` tests.
- Review prompt scope: Web state ownership and lazy loading only.
- Exit criteria: enabling full-file mode triggers safe lazy requests for expanded text files and preserves existing patch rendering fallback.

- [x] add full-file mode state and More menu label/action.
- [x] add Web data op for the new route.
- [x] add per-file loading/loaded/unavailable states.
- [x] scope cache and stale guards by source/snapshot/path.
- [x] add/update Web tests.
- [x] run targeted Web tests.
- [x] no review findings to triage because `codex review` is intentionally skipped per the active user goal.
- [x] skip `codex review` for this loop per the active user goal; targeted verification passed.

### Loop 3: Renderer Integration and Expansion Behavior
#### Loop Contract
- Purpose: use full content to unlock `@pierre/diffs` native unchanged-context expansion.
- In scope: full metadata construction, `DiffPatchView` options, bounded separator expansion, renderer tests.
- Out of scope: hand-written separator DOM, rich Markdown rendering, image/PDF preview.
- Blocking findings: custom expander duplicates library behavior, full metadata mismatches patch context, renderer crash regression, massive context expansion by default.
- Non-blocking / later-loop findings: exact Codex pixel parity for separator hover state.
- Known unresolved semantics: none.
- Required targeted tests: `DiffPatchView` tests plus relevant `WorktreeDiffPane` tests.
- Review prompt scope: renderer integration and expansion behavior only.
- Exit criteria: clickable unchanged separators work through `@pierre/diffs` and partial rendering remains stable.

- [x] build complete diff metadata from full before/after content.
- [x] configure `@pierre/diffs` separator expansion options.
- [x] preserve large-diff/word-diff safeguards.
- [x] add renderer-facing tests.
- [x] run targeted renderer/component tests.
- [x] run `bun run type-check`.
- [x] no review findings to triage because `codex review` is intentionally skipped per the active user goal.
- [x] skip `codex review` for this loop per the active user goal; targeted verification passed.

### Loop 4: Documentation and Convergence
#### Loop Contract
- Purpose: align docs, remove temporary code, and prepare for commit.
- In scope: design doc, CODEMAP if needed, pitfall note if confirmed, cleanup, final targeted verification.
- Out of scope: new Git sources or additional preview types.
- Blocking findings: docs contradict behavior, dead debug code remains, type-check fails, targeted regressions fail.
- Non-blocking / later-loop findings: future branch/previous-conversation source design.
- Known unresolved semantics: none.
- Required targeted tests: repeat affected targeted tests and `bun run type-check`.
- Review prompt scope: final architecture and cleanup consistency.
- Exit criteria: todo complete, tests pass, docs align, review findings classified.

- [x] update `docs/design/web-right-rail-workspace-blueprint.md`.
- [x] update `CODEMAP.md` if ownership points changed.
- [x] add/update pitfall note only if a new reproducible gotcha was confirmed.
- [x] remove temporary instrumentation or scaffolding.
- [x] run final targeted tests.
- [x] run `bun run type-check`.
- [x] no review findings to triage because `codex review` is intentionally skipped per the active user goal.
- [x] skip `codex review` for this loop per the active user goal; targeted verification passed.
