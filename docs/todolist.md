# Git Review Source Operations Todo

Current status: implementation, docs, targeted tests, type-check, root build, and web build are complete. `codex review` execution items remain intentionally unchecked because the current instruction is to finish the todo work first and not run review yet.

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] Current Web Review UI has evolved from a single diff pane into a right rail workspace with a Review tab, Review toolbar, file cards, lazy patch loading, image preview, unified/split mode, and display options.
- [x] Current Git diff bridge behavior is centralized mostly in `packages/core/src/app-server/devBridge.ts`.
- [x] Current Web diff runtime requests `bridge/reviewGit/readDiffSummary`, `bridge/reviewGit/readDiffFilePatch`, and `bridge/reviewGit/readDiffFilePreview` without a Review source parameter.
- [x] Current “Unstaged” behavior has historically used `git diff HEAD` in core paths, which mixes staged tracked changes into the unstaged view.
- [x] This project does not need long-term compatibility with old Web bridge diff parameter shapes if a clearer source-aware contract is better.
- [x] WebGPT review agreed with the main direction: introduce a Git-backed Review operation layer, keep non-Git capture sources out of the Git source union, and partition Web caches by source.

### 0.2 Goals
- [x] Introduce a source-aware Git Review operation layer inspired by Codex-style `review-summary` / `review-diff` operations.
- [x] Correct `unstaged` semantics to mean worktree-vs-index tracked changes plus untracked files.
- [x] Add a functional `staged` Review source backed by index-vs-HEAD diff semantics.
- [x] Ensure summary, lazy file patch, and image preview requests carry the active source and cannot mix cached results across sources.
- [x] Keep Review display options, such as word wrap and unified/split mode, separate from Review source semantics.
- [x] Keep the implementation incremental enough for targeted tests, review, and commits.

### 0.3 Non-goals
- [x] Do not implement commit submenu diff viewing in this task.
- [x] Do not implement branch diff viewing in this task.
- [x] Do not implement previous conversation / agent-turn diff capture in this task.
- [x] Do not include non-Git capture sources in the Git Review source model.
- [x] Do not implement staged image preview by reading worktree files as a fallback.
- [x] Do not refactor icon mapping, file card visuals, or diff renderer CSS unless directly required by source switching behavior.
- [x] Do not build a full Codex-like Git worker registry in this task; keep the first layer small and local to app-server bridge needs.

### 0.4 Spec lock and review-scope
- [x] Spec lock required: this changes app-server bridge semantics, Web runtime request shape, and Web Review UI cache/state ownership.
- [x] Review findings log required if `codex review` reports findings or if more than one review pass is needed.
- [x] Review findings must be classified before code changes.
- [x] Current-loop review is scoped by each loop's `Loop Contract`.
- [x] Later-loop findings are logged, not chased in the current loop.
- [x] Spec ambiguity stops implementation until this todo, a canonical doc, or user alignment is updated.
- [x] Use the repository review profile as the single source of truth; do not redefine review model, reasoning, or timeout here.

### 0.5 Current worktree hygiene
- [x] Decide whether to commit or otherwise isolate the existing uncommitted Review Toolbar / word-wrap / dropdown UI changes before starting Git source work.
- [x] If keeping those UI changes uncommitted, avoid editing the same files for Git source work until the overlap is intentionally reviewed. Decision: overlap was intentional because source selector/cache state live in the same Review files.
- [x] Do not mix UI polish-only changes with Git Review source semantics in the same commit. Current change remains uncommitted pending user review/commit direction.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Update `docs/design/web-right-rail-workspace-blueprint.md` with accepted Review source terminology and non-goals.
- [x] Decide after implementation whether the bridge-level source-aware Review contract is stable enough to promote into `docs/contracts/app-server-interaction-contract.md` or `docs/references/app-server-api-reference.md`. Decision: keep in design doc for this iteration; do not promote until commit/branch sources stabilize.
- [x] Update `CODEMAP.md` if a new cross-cutting Git Review operation module becomes a long-lived ownership point.

### 1.2 Data model
- [x] Define Git Review source as a first-class model with initial supported values limited to `unstaged` and `staged`.
- [x] Define `unstaged` as tracked worktree-vs-index changes plus untracked files.
- [x] Define `staged` as index-vs-HEAD changes and never untracked files.
- [x] Define a stable `sourceKey` for cache partitioning, for example `git:unstaged` and `git:staged`.
- [x] Keep future `commit` and `branch` source semantics documented as deferred, not implemented in code unless this todo is updated.
- [x] Keep future previous conversation / agent-turn capture as a non-Git Review source boundary, not part of Git Review operations.

### 1.3 Types / Interfaces
- [x] Add a small Git Review source/type module near the app-server bridge boundary.
- [x] Add a Git Review operation module that owns Git command planning for summary, file patch, and image preview.
- [x] Keep `devBridge.ts` as the RPC router/cwd resolver/thin adapter rather than the owner of Git command semantics.
- [x] Define source-aware request payloads for summary, file patch, and file preview.
- [x] Include `sourceKey` in the Web `DiffSnapshot` or equivalent Review snapshot model.
- [x] Ensure file patch and preview request state includes source identity in request keys and stale-response guards.

### 1.4 Semantic decision table
| Decision | Accepted rule | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|
| Unstaged meaning | `unstaged` means `git diff` tracked changes plus untracked files | Continue using `git diff HEAD` for “Unstaged” | Git Review operation layer | staged tracked changes must not appear in Unstaged |
| Staged meaning | `staged` means `git diff --cached` and excludes untracked | Include untracked in staged | Git Review operation layer | untracked appears only in Unstaged |
| Old all-uncommitted behavior | Do not implement as first-round UI/source | Add `all-uncommitted` in code now | Design doc only | tests should target accepted sources only |
| Non-Git capture source | Keep separate from Git Review source | Put `last-turn` into Git source union | Future Review provider boundary | no current code type for capture source |
| Source cache identity | sourceKey partitions snapshot, patch, preview, and expansion scope | cache only by cwd/path/generatedAt | Web runtime/UI state | source switch cannot reuse stale body |
| Display options | word wrap, unified/split, whitespace, rich preview are display/action options | Treat display options as Review source | Review toolbar model | display toggles do not alter sourceKey |
| Staged image preview | First round does not read worktree as staged preview fallback | Show worktree image for staged source | Preview operation/UI | staged image preview is unavailable unless proper index blob support exists |

### 1.5 Review finding triage policy
- [x] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [x] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, update the review findings log and make sure a future loop owns the acceptance item.
- [x] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test if needed.
- [x] Re-run review only after triage is documented and targeted tests pass.

## 2. Runtime / Platform
- [x] Extract Git Review command planning and parsing out of `devBridge.ts` into a focused operation layer.
- [x] Implement source-aware summary for `unstaged`.
- [x] Implement source-aware file patch for `unstaged`.
- [x] Keep untracked summary and patch building consistent through shared helpers.
- [x] Preserve untracked safety behavior for large files, binary/image/PDF-like files, and symlinks.
- [x] Implement source-aware summary for `staged`.
- [x] Implement source-aware file patch for `staged`.
- [x] Ensure staged source never lists or patches untracked files.
- [x] Make staged image preview explicitly unavailable unless proper index blob preview support is added in a future todo.
- [x] Add or migrate bridge RPC routes for source-aware summary, file patch, and file preview.
- [x] Remove or stop Web usage of legacy source-less diff routes once the new source-aware route is wired.

## 3. Frontend Boundary
- [x] Make Web diff data ops accept an explicit active Review source.
- [x] Send source with summary requests.
- [x] Send source with lazy file patch requests.
- [x] Send source with lazy image preview requests.
- [x] Add `sourceKey` to Web snapshot/request identity.
- [x] Partition patch cache by sourceKey.
- [x] Partition preview cache by sourceKey.
- [x] Reset or source-scope expanded file state when the active source changes.
- [x] Enable the Review source selector to switch between Unstaged and Staged.
- [x] Keep Commit, Branch, and non-Git capture entries disabled or documented as placeholders.
- [x] Keep Review More Menu actions separate from source switching.

## 4. Tests
- [x] Add core operation tests proving `unstaged` does not include staged tracked changes.
- [x] Add core operation tests proving `staged` includes staged tracked changes and excludes unstaged/untracked changes.
- [x] Add core operation tests proving untracked summary and single-file patch behavior remain consistent for Unstaged.
- [x] Add core operation tests for large/binary/symlink untracked safety after extraction.
- [x] Add bridge RPC tests for source-aware summary, file patch, and file preview routing.
- [x] Add bridge RPC tests for invalid or missing source parameters.
- [x] Update Web runtime tests so summary, patch, and preview requests include source.
- [x] Add Web runtime stale-response tests for source switches.
- [x] Add WorktreeDiffPane tests for Unstaged/Staged selector behavior.
- [x] Add WorktreeDiffPane tests proving source switches do not reuse patch or preview cache across sources.
- [x] Add WorktreeDiffPane tests proving staged image preview is unavailable rather than reading worktree content.
- [x] Run targeted core tests.
- [x] Run targeted Web runtime/component tests.
- [x] Run `bun run type-check`.
- [x] Run build or package-specific build only after targeted tests pass.

## 5. Recommended Execution Order

### Loop 0: Worktree Hygiene
#### Loop Contract
- Purpose: avoid mixing already-pending UI polish with Git Review source semantics.
- In scope: status inspection, commit/shelve decision, and documentation of current uncommitted overlap.
- Out of scope: Git source implementation.
- Blocking findings: existing uncommitted UI changes touch the same files needed for source work and cannot be cleanly separated.
- Non-blocking / later-loop findings: unrelated UI polish can remain if it will not be edited in source loops.
- Known unresolved semantics: none.
- Required targeted tests: none unless committing current UI work requires re-verification.
- Review prompt scope: no code review required unless a commit is created for the current UI work and the user requests review.
- Exit criteria: source work starts from a clearly understood worktree state.

- [x] inspect current `git status --short`.
- [x] decide whether to commit existing Review Toolbar / word-wrap / dropdown UI changes before source work.
- [x] if committing, run the relevant targeted checks already associated with those UI changes. Not applicable: no commit was created.
- [x] record whether Git source implementation will start from a clean or intentionally dirty worktree.

### Loop 1: Git Review Operation Layer With True Unstaged
#### Loop Contract
- Purpose: create the source-aware core boundary and correct Unstaged semantics without enabling Staged UI yet.
- In scope: operation types, operation helpers, `unstaged` summary/file patch/preview behavior, bridge thin adapter updates as needed.
- Out of scope: staged UI, commit/branch sources, non-Git capture sources, staged image preview.
- Blocking findings: `unstaged` still uses `git diff HEAD`; untracked behavior regresses; devBridge remains the owner of new Git command planning.
- Non-blocking / later-loop findings: route naming polish or future commit/branch type preferences.
- Known unresolved semantics: whether source-aware RPC names replace old routes immediately or in Loop 2.
- Required targeted tests: core operation/helper tests and relevant bridge helper tests.
- Review prompt scope: review only the core Git Review operation extraction and `unstaged` semantic correction.
- Exit criteria: true Unstaged semantics are implemented and targeted core tests pass.

- [x] define initial Git Review source/type model for `unstaged`.
- [x] extract Git diff summary/patch planning into a focused operation module.
- [x] implement `unstaged` tracked diff via worktree-vs-index semantics.
- [x] preserve untracked inclusion for Unstaged.
- [x] preserve untracked large/binary/symlink safety.
- [x] update targeted core/helper tests.
- [x] run targeted core/helper tests.
- [x] triage review findings into the review findings log if review reports findings. Not applicable until review is allowed.
- [ ] run `codex review` for this loop after targeted verification passes.

### Loop 2: Source-Aware Bridge and Web Runtime Cache Keys
#### Loop Contract
- Purpose: make app-server/Web requests source-aware and prevent cross-source cache reuse.
- In scope: source-aware bridge routes or payloads, Web diff data ops source parameter, `sourceKey` snapshot/request/cache identity.
- Out of scope: staged source implementation, commit/branch implementation, image preview blob locator expansion.
- Blocking findings: Web still calls source-less diff routes for Review data; patch/preview caches are keyed only by path/cwd; source switch can show stale body.
- Non-blocking / later-loop findings: exact route names if the source contract is otherwise clear and tests cover it.
- Known unresolved semantics: none after route shape is accepted in code/tests.
- Required targeted tests: bridge RPC tests, `diffDataOps.test.ts`, source-switch UI/cache tests.
- Review prompt scope: review source-aware RPC/Web state ownership only.
- Exit criteria: Web can request current Unstaged via source-aware path and caches include sourceKey.

- [x] add source-aware summary request path.
- [x] add source-aware file patch request path.
- [x] add source-aware file preview request path.
- [x] update Web diff data ops to send source.
- [x] add `sourceKey` to snapshot/request identity.
- [x] update patch cache stale guards to include sourceKey.
- [x] update preview cache stale guards to include sourceKey.
- [x] update expansion scope behavior for source changes.
- [x] update targeted bridge/Web tests.
- [x] run targeted bridge/Web tests.
- [x] triage review findings into the review findings log if review reports findings. Not applicable until review is allowed.
- [ ] run `codex review` for this loop after targeted verification passes.

### Loop 3: Enable Staged Source
#### Loop Contract
- Purpose: make the Review source selector switch between true Unstaged and Staged.
- In scope: staged summary/file patch operations, source selector behavior, staged-specific cache isolation, staged image preview unavailable state.
- Out of scope: staged image blob preview support, commit submenu, branch source, all-uncommitted source.
- Blocking findings: staged includes untracked files; unstaged includes staged-only tracked changes; staged image preview reads worktree content; source switch mixes file bodies.
- Non-blocking / later-loop findings: commit/branch menu requests, exact disabled-menu wording, staged image preview enhancement.
- Known unresolved semantics: staged image preview is intentionally unavailable unless this todo is explicitly updated.
- Required targeted tests: core staged tests, Web runtime source tests, WorktreeDiffPane source selector tests.
- Review prompt scope: review staged source implementation and source isolation only.
- Exit criteria: Unstaged/Staged switch works with isolated summary, patch, preview, and expansion behavior.

- [x] implement staged summary via index-vs-HEAD semantics.
- [x] implement staged file patch via index-vs-HEAD semantics.
- [x] ensure staged source excludes untracked files.
- [x] make staged image preview explicitly unavailable.
- [x] enable Staged in the Review source selector.
- [x] keep Commit/Branch/non-Git capture entries disabled or deferred.
- [x] update targeted core/Web/UI tests.
- [x] run targeted core/Web/UI tests.
- [x] run `bun run type-check`.
- [x] run build if the touched package requires it for confidence.
- [x] triage review findings into the review findings log if review reports findings. Not applicable until review is allowed.
- [ ] run `codex review` for this loop after targeted verification passes.

### Loop 4: Documentation and Final Convergence
#### Loop Contract
- Purpose: align docs, remove temporary ambiguity, and make the final patch reviewable.
- In scope: design doc updates, CODEMAP update if needed, cleanup of dead helpers/tests after source-aware path is stable.
- Out of scope: new Review sources or new UI actions.
- Blocking findings: docs claim commit/branch are implemented when they are not; old source-less Web routes remain as active path without a deliberate reason; TODO accepted rules conflict with code.
- Non-blocking / later-loop findings: future source roadmap detail beyond this implementation.
- Known unresolved semantics: none.
- Required targeted tests: repeat targeted tests touched by cleanup, plus type-check.
- Review prompt scope: review final source-aware architecture, docs, and cleanup consistency.
- Exit criteria: todo items are complete, tests pass, docs are aligned, and any review findings are classified.

- [x] update `docs/design/web-right-rail-workspace-blueprint.md` with final source semantics.
- [x] update `CODEMAP.md` if a new long-lived Git Review operation module was added.
- [x] remove dead source-less Web call paths if no longer used.
- [x] run targeted tests affected by cleanup.
- [x] run `bun run type-check`.
- [x] run build if not already run after final touched files.
- [x] triage review findings into the review findings log if review reports findings. Not applicable until review is allowed.
- [ ] run `codex review` for this loop after targeted verification passes.
- [ ] delete `docs/todolist.md` only after the feature is complete, stable facts are promoted to the correct docs, and the user accepts completion.
