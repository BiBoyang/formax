# Git Commit Review Source Todo

Current status: first-round commit source behavior is implemented and targeted tests/type-check/build pass. Codex review is intentionally skipped per the active user goal; the user will run external AI review.

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] The Review source selector currently supports Git-backed `Unstaged` and `Staged` sources.
- [x] The Review source selector has disabled placeholders for future sources including `Commit`.
- [x] The Git Review operation layer now lives in `packages/core/src/app-server/gitReviewOperations.ts` and should own Git command planning/parsing.
- [x] The Web runtime already sends source-aware summary, lazy patch, and preview requests through `bridge/reviewGit/*` routes.
- [x] The user wants `Commit` to mean inspecting the file diff for an existing Git commit, not creating a new commit and not pushing.
- [x] The commit submenu should list recent commits and use a first-round limit of 10.
- [x] The active toolbar shape for a selected commit should match the reference: source label `Commit`, truncated commit subject, aggregate `+/-` stats, and the existing Review toolbar actions.
- [x] Merge commits should use first-parent semantics in the first implementation.
- [x] Root commits are the first commits in a repository and should be supported as empty-tree-to-commit diffs.
- [x] Commit image previews should be supported by reading Git historical blobs, not by reading the current worktree file.
- [x] Commit submenu is desktop-only and should open from hover in the Review source menu.
- [x] Commit list results may be cached after the first successful load; refreshing the current commit diff does not need to refresh the commit list.
- [x] The selected commit row should show a trailing checkmark, but selection alone should not apply a persistent row background; only hover should show the hover background.

### 0.2 Goals
- [x] Add a functional `Commit` Review source that lists the latest 10 commits and shows a selected commit's file diff.
- [x] Extend Git Review source semantics without adding ad hoc Git commands in Web UI code.
- [x] Preserve existing `Unstaged` and `Staged` behavior while adding source-key isolation for `Commit`.
- [x] Support commit image preview by reading the correct Git blob for added/modified/deleted/root-commit files.
- [x] Keep the first version focused, testable, and aligned with the existing Review toolbar design.

### 0.3 Non-goals
- [x] Do not implement creating commits, pushing commits, or the `Commit or Push` button in this task.
- [x] Do not implement commit search, pagination, or full history browsing in this task.
- [x] Do not implement arbitrary commit ranges.
- [x] Do not implement branch compare in this task.
- [x] Do not implement previous conversation / agent-turn diff capture in this task.
- [x] Do not implement parent selection for merge commits in this task.
- [x] Do not implement rich text, PDF, or generic binary preview for commit sources in this task.
- [x] Do not refactor file icon mapping, general file card visuals, or unrelated right-rail layout.

### 0.4 Spec lock and review-scope
- [x] Spec lock required: this task extends app-server bridge semantics, Git command planning, Web source state, and source selector UI.
- [x] Review findings log required if `codex review` reports findings or if more than one review pass is needed.
- [x] Review findings must be classified before code changes.
- [x] Current-loop review is scoped by each loop's `Loop Contract`.
- [x] Later-loop findings are logged, not chased in the current loop.
- [x] Spec ambiguity stops implementation until this todo, a canonical doc, or user alignment is updated.
- [x] Use the repository review profile as the single source of truth; do not redefine review model, reasoning, or timeout here.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Update `docs/design/web-right-rail-workspace-blueprint.md` to move `Commit` from disabled placeholder to first-round functional Review source.
- [x] Document the first-round commit semantics: latest 10 commits, single commit diff, first-parent merge handling, root commit support, image preview through Git blobs.
- [x] Update `CODEMAP.md` only if new long-lived Git Review operation entrypoints or ownership points are added.
- [x] Decide after implementation whether commit-source bridge semantics should be promoted to a canonical app-server contract. First-round decision: keep in the design doc unless the interface stabilizes enough to promote.

### 1.2 Data model
- [x] Extend Git Review source from `unstaged | staged` to include `commit` with a commit SHA.
- [x] Define commit source key as `git:commit:<sha>`.
- [x] Define a lightweight commit list item with at least `sha`, `shortSha`, `subject`, and relative/display time metadata.
- [x] Define selected commit toolbar display data: source label `Commit`, truncated subject, aggregate additions/deletions.
- [x] Keep untracked files excluded from commit source; commit source is entirely Git object based.
- [x] Define merge commit diff as selected commit vs first parent.
- [x] Define root commit diff as empty tree vs selected commit.
- [x] Define commit image preview blob selection: added/modified reads selected commit blob; deleted reads first parent blob; root added reads selected commit blob.

### 1.3 Types / Interfaces
- [x] Extend app-server `GitReviewSource` and Web `ReviewGitSource` types for commit sources.
- [x] Extend `GitReviewSourceKey` / `ReviewGitSourceKey` to represent commit source keys safely.
- [x] Add a source-aware commit list RPC, for example `bridge/reviewGit/listCommits`.
- [x] Add parser/normalizer coverage for commit source payloads and invalid SHA payloads.
- [x] Extend Web diff data ops to request commit lists and selected commit summaries.
- [x] Ensure source-aware lazy patch and preview requests carry `{ kind: 'commit', sha }`.
- [x] Ensure patch, preview, expansion, and stale-response guards include `git:commit:<sha>`.

### 1.4 Semantic decision table
| Decision | Accepted rule | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|
| Commit menu size | List latest 10 commits | Pagination/full history/search | Web source selector + app-server list API | commit list request uses limit 10 |
| Commit diff scope | Single selected commit | arbitrary ranges | Git Review operation layer | summary/patch match selected commit only |
| Merge commit diff | Compare commit to first parent | combined diff or parent selector | Git Review operation layer | merge test proves first-parent args/behavior |
| Root commit diff | Compare empty tree to selected commit | show unavailable for root commit | Git Review operation layer | root commit summary/patch works |
| Commit image preview | Read Git blobs for supported images | read current worktree file, or disable all commit previews | Git Review preview operation | worktree mutation cannot affect commit preview |
| Commit source key | `git:commit:<sha>` | reuse `git:staged`/`git:unstaged` keys | Web runtime/UI state | switching commits cannot reuse cached file bodies |
| Toolbar display | Source label `Commit`, truncated subject, aggregate stats | replace source label with full subject | Review toolbar UI | component test covers label/subject/stats |
| Commit submenu interaction | Desktop hover opens submenu; selected row uses checkmark only | mobile/touch behavior or persistent selected background | Review source selector UI | component test covers hover submenu and selected checkmark |
| Commit or push button | Out of scope | implement submit/push flow now | Deferred toolbar action | no code path for creating commits |

### 1.5 Review finding triage policy
- [x] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [x] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, update the review findings log and make sure a future loop owns the acceptance item.
- [x] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test if needed.
- [x] Codex review is skipped for this task per the active user goal; external review remains the next review gate.

## 2. Runtime / Platform
- [x] Add commit source support to `gitReviewOperations.ts` command planning.
- [x] Add commit list operation using latest 10 by default or by requested capped limit.
- [x] Add commit source summary support with numstat/name-status parsing.
- [x] Add commit source file patch support.
- [x] Add root commit support through empty-tree or equivalent Git command handling.
- [x] Add first-parent merge semantics for commit source commands.
- [x] Add commit source image preview support through Git blob reads.
- [x] Keep staged and unstaged behavior unchanged.
- [x] Keep old source-less `bridge/readDiff*` routes inactive.
- [x] Add source-aware bridge routing for commit listing.

## 3. Frontend Boundary
- [x] Extend Web `DiffSnapshot` source/sourceKey parsing for commit source.
- [x] Add commit list request support in Web diff data ops.
- [x] Make Review Source Selector `Commit` submenu functional and lazily load recent commits.
- [x] Show loading and error/empty states in the commit submenu.
- [x] Cache successfully loaded commit menu results until a deliberate future refresh-list action exists.
- [x] Render selected commit rows with a trailing checkmark and no persistent selected-row background.
- [x] On commit selection, refresh Review data with `{ kind: 'commit', sha }`.
- [x] Render active commit toolbar state as `Commit`, truncated subject, and aggregate stats.
- [x] Ensure changing between commits resets or source-scopes expansion state.
- [x] Ensure lazy patch and image preview requests use the selected commit source.
- [x] Keep Branch and Previous Conversation disabled placeholders.

## 4. Tests
- [x] Add core operation tests for commit list parsing/limit behavior.
- [x] Add core operation tests for normal commit summary and file patch.
- [x] Add core operation tests for merge commit first-parent behavior.
- [x] Add core operation tests for root commit behavior.
- [x] Add core operation tests for commit image preview blob selection, including deleted images.
- [x] Add bridge RPC tests for `bridge/reviewGit/listCommits`.
- [x] Add Web runtime tests for commit source summary, patch, and preview request payloads.
- [x] Add Web runtime stale-response/cache tests for switching between two commit sources.
- [x] Add WorktreeDiffPane tests for commit submenu loading, hover-open behavior, selection checkmark, toolbar display, and disabled non-implemented sources.
- [x] Run targeted core tests.
- [x] Run targeted Web runtime/component tests.
- [x] Run `bun run type-check`.
- [x] Run build only after targeted tests pass if touched package confidence requires it.

## 5. Recommended Execution Order

### Loop 1: Commit Source Model and Core Git Operations
#### Loop Contract
- Purpose: extend the Git Review operation layer to understand commit sources without touching UI polish.
- In scope: source types, source keys, commit list, commit summary, commit file patch, merge/root semantics.
- Out of scope: Web dropdown UI, commit image preview, branch/range sources.
- Blocking findings: commit source uses current worktree data; merge commit does not use first parent; root commit fails; unstaged/staged regress.
- Non-blocking / later-loop findings: pagination/search UX, commit date formatting preferences, branch-source suggestions.
- Known unresolved semantics: none after this todo is accepted.
- Required targeted tests: core operation/helper tests and bridge routing tests for commit list and commit diff.
- Review prompt scope: review commit source model and core Git operation semantics only.
- Exit criteria: core can list recent commits and return summary/patch for selected commit source with targeted tests passing.

- [x] extend Git Review source/type model for commit sources.
- [x] implement commit list operation capped to 10 for first-round UI use.
- [x] implement commit summary command planning/parsing.
- [x] implement commit file patch command planning/parsing.
- [x] implement merge first-parent and root commit handling.
- [x] add/update core and bridge tests.
- [x] run targeted core/bridge tests.
- [x] No review findings to triage because Codex review is intentionally skipped per the active user goal.
- [x] Skip `codex review` for this loop per the active user goal; targeted verification passed.

### Loop 2: Web Runtime and Commit Source Selector
#### Loop Contract
- Purpose: wire commit source into Web runtime requests and source selector UI.
- In scope: Web source types, commit list request, lazy submenu loading, commit selection, toolbar display, source-key cache isolation.
- Out of scope: image preview blob support, commit search/pagination, commit-or-push actions.
- Blocking findings: selecting a commit requests unstaged/staged data; sourceKey does not include SHA; commit submenu eagerly blocks normal Review rendering; toolbar display conflicts with accepted screenshot shape.
- Non-blocking / later-loop findings: menu animation/spacing polish beyond current Codex parity, richer commit metadata.
- Known unresolved semantics: none.
- Required targeted tests: Web runtime tests and `WorktreeDiffPane.test.tsx` source selector tests.
- Review prompt scope: review Web runtime/source selector state ownership only.
- Exit criteria: user can select one of the latest 10 commits and see its diff with isolated caches.

- [x] extend Web source/sourceKey types and parsers.
- [x] add Web diff data op for listing commits.
- [x] make `Commit` submenu load and show latest 10 commits.
- [x] implement commit selection refresh.
- [x] show active commit subject and aggregate stats in Review toolbar.
- [x] ensure patch/preview/expansion cache identity includes commit SHA.
- [x] update Web runtime and component tests.
- [x] run targeted Web runtime/component tests.
- [x] No review findings to triage because Codex review is intentionally skipped per the active user goal.
- [x] Skip `codex review` for this loop per the active user goal; targeted verification passed.

### Loop 3: Commit Image Preview
#### Loop Contract
- Purpose: extend existing image preview behavior to selected commit sources using Git blobs.
- In scope: added/modified/deleted/root commit image preview, size caps, error states, Web preview payload handling.
- Out of scope: PDF/rich-text previews, generic binary preview, current worktree fallbacks.
- Blocking findings: commit preview reads the worktree file; deleted image preview cannot read parent blob; preview bypasses size cap; staged/unstaged preview regresses.
- Non-blocking / later-loop findings: richer metadata labels or preview dimensions.
- Known unresolved semantics: rename behavior should use parsed diff path metadata where available; if exact rename preview is ambiguous, prefer unavailable over wrong file content.
- Required targeted tests: core preview tests plus Web preview request tests.
- Review prompt scope: review commit image preview blob selection and safety only.
- Exit criteria: supported commit image previews load from Git objects and targeted tests pass.

- [x] implement commit image preview blob selection for added/modified/deleted files.
- [x] implement root commit added-image preview behavior.
- [x] preserve size caps and image mime checks.
- [x] return unavailable/error states instead of reading worktree fallback when blob resolution fails.
- [x] update core/Web tests.
- [x] run targeted preview tests.
- [x] No review findings to triage because Codex review is intentionally skipped per the active user goal.
- [x] Skip `codex review` for this loop per the active user goal; targeted verification passed.

### Loop 4: Documentation and Final Convergence
#### Loop Contract
- Purpose: align docs and clean up the final patch for review/commit.
- In scope: design doc updates, CODEMAP update if needed, dead helper cleanup, final targeted tests/type-check.
- Out of scope: new Git sources, commit search/pagination, push/PR actions.
- Blocking findings: docs still call Commit disabled; todo accepted rules conflict with code; old placeholders become accidentally clickable without data; type-check fails.
- Non-blocking / later-loop findings: future source roadmap detail beyond this implementation.
- Known unresolved semantics: none.
- Required targeted tests: repeat affected targeted tests and `bun run type-check`.
- Review prompt scope: review final commit-source architecture, docs, and cleanup consistency.
- Exit criteria: todo items are complete, tests pass, docs are aligned, and review findings are classified.

- [x] update `docs/design/web-right-rail-workspace-blueprint.md` with final commit source behavior.
- [x] update `CODEMAP.md` if new ownership points were introduced.
- [x] remove dead placeholders or helpers introduced during implementation.
- [x] run targeted tests affected by final cleanup.
- [x] run `bun run type-check`.
- [x] run build if not already run after final touched files.
- [x] No review findings to triage because Codex review is intentionally skipped per the active user goal.
- [x] Skip `codex review` for this loop per the active user goal; targeted verification passed.
- [x] Keep `docs/todolist.md` as the external-review handoff until the user accepts deletion.
