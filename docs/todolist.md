# Approval Bottom Prompt Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] Current TUI approval prompts are rendered inline from tool presenters or `*ApprovalToolBlock` components inside transcript rows.
- [x] Parallel tool starts can append a later transient tool row after the first tool row's inline approval prompt, producing a visual order like `Search A -> approval A -> Search B`.
- [x] The ordinary `InputBar` is already hidden in prompt mode, but there is no REPL-level replacement slot that owns the active approval UI.
- [x] Commit `b6371ffd` added FIFO pending order and active-only `isPending` projection so only the queue head renders as active.
- [x] WebGPT agreed that active-only pending is useful lifecycle protection but does not fix prompt UI ownership by itself.
- [x] WebGPT recommended a REPL-level active prompt slot backed by a user-input active prompt descriptor, not by reverse-scanning transcript rows.

### 0.2 Goals
- [x] Move approval and ask-user interactive controls out of transcript row ownership into one REPL-level bottom prompt slot.
- [x] Keep transcript rows responsible for tool status, summaries, and non-interactive previews.
- [x] Preserve existing prompt copy, menu choices, Esc behavior, numeric shortcuts, arrows, feedback typing, and submit payloads.
- [x] Preserve FIFO behavior: only the active queue head is rendered as an interactive prompt.
- [x] Keep later running tool rows visible in transcript while guaranteeing they render above the active prompt slot.

### 0.3 Non-goals
- [x] Phase 1 does not implement permission remember recheck/merge for already queued pending approvals.
- [x] Phase 1 does not add new permission actions, new remember scopes, or new policy semantics.
- [x] Phase 1 does not redesign prompt copy or menu styling.
- [x] Phase 1 does not add Web/app-server/Electron prompt-slot parity; this task is the Ink REPL/TUI rendering path.
- [x] Phase 1 does not rewrite transcript projection, compaction, or `Ink <Static>` ownership.

### 0.4 Spec lock and review-scope
- [x] Spec lock required: approval UI ownership crosses tool runtime, REPL layout, prompt mode, and tool presenters.
- [x] Review findings log: use this todo's loop notes unless findings become numerous enough to warrant a dedicated log.
- [x] Review findings must be classified before code changes.
- [x] Current-loop review is scoped by each loop's `Loop Contract`.
- [x] Later-loop findings are logged, not chased in the current loop.
- [x] Spec ambiguity stops implementation until contracts/todo/user alignment are updated.
- [x] Do not run repeated review loops without triaging findings and confirming they are in the current loop scope.

### 0.5 Decision Draft Summary
- [x] Storage/config source: no durable storage or config changes.
- [x] Schema/defaults/rejected fields: extend interactive input request metadata with an active prompt descriptor; reject rendering logic that requires transcript reverse lookup as the primary source.
- [x] Startup/activation timing: no startup behavior changes; prompt descriptors are created only during existing interactive prompt transactions.
- [x] Permission model: existing permission / approval flow remains unchanged; UI relocation must not authorize, deny, remember, or merge permissions differently.
- [x] Capability level: this is a transcript renderer / REPL input surface change, not a new tool, slash command, hook, SDK control, or policy feature.
- [x] Result/IO/cleanup bounds: no new file IO, output caps, cleanup, binary/media, or secret handling.
- [x] Explicit non-goals: permission remember merge, Web/app-server/Electron parity, and prompt redesign are out of Phase 1.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Update `docs/contracts/interactive-input-contract.md` to define one active interactive prompt as REPL bottom input surface state.
- [x] Update `docs/contracts/transcript-surface-contract.md` to state transcript rows must not own active interactive controls in the Ink REPL.
- [x] Update `docs/contracts/permissions-policy-contract.md` with a no-semantics-change note; do not change permission rules.
- [x] Update `CODEMAP.md` only if a new long-lived prompt-slot component or runtime ownership module is added.

### 1.2 Data model
- [x] Define an active prompt descriptor based on existing `InteractivePromptDescriptor`.
- [x] Descriptor must include `toolUseId`, `kind`, `requestEvent`, `questions`, and UI metadata for the selected variant: `promptVariant`, title/target labels, and variant-specific fields such as directory path, command, cwd, tool label, or remember label.
- [x] Descriptor must not depend on finding a matching visible transcript row.
- [x] `getActivePrompt()` returns only the FIFO queue head descriptor.
- [x] Descriptor metadata is captured as a stable snapshot when `requestAnswers` enqueues the pending request.
- [x] Descriptor cleanup is atomic with `submitAnswers`, `reject`, `rejectAllPending`, and abort resolution.
- [x] Production `runInteractivePromptTransaction` approval / ask-user paths must pass descriptor metadata.
- [x] Descriptor-less `requestAnswers` callers remain supported for tests and non-rendering legacy callers, but they do not drive `ActivePromptSlot`.
- [x] Preserve `getPendingToolUseIds()` FIFO behavior from `userInputManager`.
- [x] Keep base manager `isPending` as any-pending and `UserInputProvider.isPending` as UI-active-only.

### 1.3 Types / Interfaces
- [x] Extend `UserInputManager.requestAnswers` args with descriptor metadata for interactive prompt transactions; existing non-descriptor callers remain supported.
- [x] Add `getActivePrompt()` to `UserInputManager`.
- [x] Expose `getActivePrompt()` through `UserInputProvider` with subscription-driven rerender.
- [x] Pass descriptors from `interactivePromptTransaction` into `requestAnswers`.
- [x] Add `ui.promptVariant` as a renderer hint; canonical `requestEvent`, `action`, and `toolName` remain the primary semantic source.
- [x] Add a pure `resolvePromptVariant(descriptor)` helper that never inspects transcript rows.
- [x] Add a single REPL-level `ActivePromptSlot` component that maps active descriptors to existing prompt components and submits through `userInput.submitAnswers`.
- [x] Add a transcript-surface guard/helper so inline prompt blocks are suppressed when bottom slot ownership is active.

### 1.4 Semantic decision table
| Decision | Accepted rule | Source | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|---|
| Prompt ownership | Active approval / ask-user controls render in a REPL-level bottom prompt slot, not inside transcript rows | User-aligned; WebGPT-reviewed; Formax Phase 1 safety choice | Keep inline prompts and hide later rows; reorder transcript rows around prompts | `interactive-input`, `transcript-surface` | parallel Search shows two rows above one bottom prompt |
| Active source | `UserInputManager` exposes active prompt descriptor from existing transaction data | WebGPT-reviewed; Formax-existing interactive transaction | REPL reverse-scans transient messages to reconstruct prompt state | `interactive-input` | active prompt can render even when no matching top-level row is visible |
| FIFO | Only queue head is active; queued prompts are pending but non-interactive | Formax-existing from `b6371ffd`; User-aligned | render all pending prompts; last-writer-wins prompt | `interactive-input` | submit A advances active prompt to B |
| Permission semantics | UI relocation does not change allow/deny/ask/remember behavior | User-aligned; Formax-existing permissions | queued approval merge/recheck in Phase 1 | `permissions-policy` | approval payload tests remain stable |
| Transcript rows | Tool rows continue to show running/completed/error status and non-interactive previews | User-aligned; WebGPT-reviewed | hide later running rows while prompt is active | `transcript-surface` | later Search row remains visible above prompt |
| Prompt variant | Bottom slot resolves prompt variant from canonical descriptor data and uses `descriptor.ui.promptVariant` when the descriptor provides it | WebGPT-reviewed; Formax Phase 1 safety choice | prompt variant inferred from transcript row shape | `interactive-input` | active prompt renders without a visible top-level row |
| Preview split | Bottom slot owns decision controls plus minimal title/target context; large previews, diffs, and tool argument previews stay in transcript | WebGPT-reviewed; User-aligned | move entire Write/Edit diff or large argument preview into bottom slot | `transcript-surface` | Write/Edit preview remains visible as non-interactive transcript content |

### 1.5 EntryPoint Matrix
| EntryPoint | Reads config? | Activates runtime? | Exposes capability? | UI/transcript behavior | Tests |
|---|---|---|---|---|---|
| REPL | No change | No change | Yes: owns bottom active prompt slot | Transcript rows above one active bottom prompt; `InputBar` hidden while active prompt exists | REPL smoke / Ink tests |
| SDK | No change | No change | No UI surface | Interactive answers still resolve through manager; no prompt rendering | runtime manager tests only |
| app-server | No change | No change | Out of Phase 1 | Existing behavior unchanged | none in Phase 1 |
| Web | No change | No change | Out of Phase 1 | Existing behavior unchanged | none in Phase 1 |
| Electron | No change | No change | Out of Phase 1 | Existing behavior unchanged | none in Phase 1 |

### 1.6 Review finding triage policy
- [x] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [x] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, update this todo and make sure a future loop owns the acceptance item.
- [x] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test when useful.
- [x] Re-run review only after triage is documented and targeted tests pass.

## 2. Runtime / Platform
- [x] Add descriptor storage to `packages/core/src/tools/runtime/userInputManager.ts`.
- [x] Add descriptor tests to `packages/core/src/tools/runtime/userInputManager.test.ts`.
- [x] Update `packages/core/src/tools/runtime/userInputContext.tsx` to expose active prompt descriptor and rerender on queue changes.
- [x] Update `packages/core/src/tools/runtime/userInputContext.test.tsx`.
- [x] Update `packages/core/src/tools/runtime/interactivePromptTransaction.ts` to pass the descriptor into the manager.
- [x] Update `packages/core/src/tools/runtime/interactivePromptTransaction.test.ts`.
- [x] Keep current `AskUserQuestion`, `EnterPlanMode`, and `ExitPlanMode` protocol kind as `ask_user_question`; do not add a third protocol kind.

## 3. REPL / Tool UI Boundary
- [x] Add `packages/core/src/screens/repl/ActivePromptSlot.tsx`.
- [x] Render the active prompt slot in `packages/core/src/screens/REPL.tsx` after transcript and before ordinary `InputBar`.
- [x] Split prompt mode so ordinary `InputBar` hiding checks overlay prompt state separately from `Boolean(userInput.getActivePrompt())`.
- [x] Keep legacy transient-message prompt scanning only as compatibility for overlay/running interactive hints, not as the active prompt source.
- [x] Reuse existing prompt rendering components for fs read/Search, Bash, Write, Edit, MCP, WebSearch, WebFetch, AskUserQuestion, EnterPlanMode, and ExitPlanMode.
- [x] Suppress transcript-inline interactive prompt controls while preserving status rows and non-interactive previews.
- [x] Phase 1 bottom slot owns decision controls plus minimal title/target context; large Write/Edit previews, diffs, and tool argument previews remain non-interactive transcript content.
- [x] In REPL bottom-slot mode, legacy inline prompt components must not register `useScopedInput` or ConfirmMenu key handlers.
- [x] Preserve `useScopedInput` ownership so only the active bottom prompt registers interactive key handlers.

## 4. Tests
- [x] `userInputManager.test.ts`: FIFO descriptors, submit/reject/abort advance active prompt.
- [x] `userInputContext.test.tsx`: active descriptor projection and subscription rerender.
- [x] `ActivePromptSlot.test.tsx`: fs read/Search approval copy and approve/remember/feedback/cancel payloads.
- [x] `ActivePromptSlot.test.tsx`: Bash, Write, Edit, MCP, WebSearch, WebFetch payload parity.
- [x] `ActivePromptSlot.test.tsx`: AskUserQuestion, EnterPlanMode, ExitPlanMode key paths and payload parity.
- [x] `REPL` smoke/integration: two parallel Search rows render above exactly one bottom approval prompt.
- [x] `REPL` smoke/integration: submitting first approval advances the bottom slot to the second pending approval.
- [x] `REPL` smoke/integration: append a later transient running tool row after active bottom prompt is already visible; assert the later row appears above the prompt and prompt count remains one.
- [x] Static-forced targeted smoke: behavior holds with `FORMAX_FORCE_INK_STATIC=1`.
- [x] `ActivePromptSlot.test.tsx`: active descriptor renders without a visible top-level transcript row.
- [x] Guard test: legacy inline block rendered under bottom-slot surface returns no interactive prompt and registers no key handler.
- [x] Presenter/block tests: running rows do not render inline interactive menus when bottom prompt slot is active.
- [x] Do not run coverage for this task.

## 5. Recommended Execution Order

### Loop 1 — Contracts and Active Prompt Descriptor

#### Loop Contract
- Purpose: Lock semantics and create the runtime source of truth for the active prompt.
- In scope: canonical docs, descriptor type/storage, manager/context/transaction tests.
- Out of scope: REPL layout changes and presenter suppression.
- Blocking findings: descriptor cannot represent an existing prompt kind, FIFO advancement breaks, or permission semantics change.
- Non-blocking / later-loop findings: prompt visual polish, permission remember merge, Web/app-server parity.
- Known unresolved semantics: none; Phase 1 descriptor source is manager-owned.
- Required targeted tests: runtime/context/transaction tests.
- Review prompt scope: verify active prompt source and docs, not bottom-slot UI completion.
- Exit criteria: active descriptor can be observed and advanced without changing visible UI.

- [x] Update canonical docs for active prompt ownership.
- [x] Add active descriptor fields/types to runtime.
- [x] Store descriptor in pending requests and expose `getActivePrompt()`.
- [x] Capture descriptor metadata as a stable snapshot at enqueue time.
- [x] Clear descriptor state atomically with pending request resolution.
- [x] Pass existing `InteractivePromptDescriptor` from transactions into `requestAnswers`.
- [x] Run targeted runtime/context/transaction tests.
- [x] Triage review findings into the review finding triage policy.
- [x] Defer loop-level `codex review`; run one final review after full implementation per user instruction.

### Loop 2 — Bottom Prompt Slot

#### Loop Contract
- Purpose: Render the active prompt in the REPL footer position while preserving existing prompt behavior.
- In scope: `ActivePromptSlot`, `REPL.tsx` insertion, prompt component reuse, input hiding.
- Out of scope: long-term support for dual prompt paths; migration guard code is allowed only when it prevents visible inline prompts and duplicate key handlers during this loop.
- Blocking findings: prompt appears below later tool rows, `InputBar` remains active during prompt, key handlers double-submit, or payload parity breaks.
- Non-blocking / later-loop findings: extracting all prompt components into perfect shared APIs, Write/Edit preview polish, permission merge.
- Known unresolved semantics: none for REPL placement; prompt slot must be below transcript.
- Required targeted tests: `ActivePromptSlot` tests and REPL smoke tests.
- Review prompt scope: verify bottom-slot rendering and interaction parity for active prompt types touched in this loop.
- Exit criteria: parallel Search case has one bottom approval under all tool rows, no ordinary `InputBar`, no transcript inline prompt visible for covered prompt types, and only the bottom slot registers prompt key handlers for covered prompt types.

- [x] Add `ActivePromptSlot`.
- [x] Wire `ActivePromptSlot` into `REPL.tsx` after transcript and before ordinary `InputBar`.
- [x] Reuse existing prompt components and submit payload mapping.
- [x] Add Search/Bash/basic ask-user prompt-slot tests first.
- [x] Add REPL parallel Search smoke test.
- [x] Add late transient append ordering smoke test.
- [x] Run targeted slot/REPL tests.
- [x] Triage review findings into the review finding triage policy.
- [x] Defer loop-level `codex review`; run one final review after full implementation per user instruction.

### Loop 3A — Approval-Like Inline Prompt Suppression

#### Loop Contract
- Purpose: Remove transcript ownership of approval-like interactive controls across tool presenters and blocks.
- In scope: `FsReadApprovalToolBlock`, `BashApprovalToolBlock`, `WriteApprovalToolBlock`, `EditApprovalToolBlock`, `McpApprovalToolBlock`, WebSearch/WebFetch, and affected presenter tests.
- Out of scope: new prompt designs, permission merge, Web/app-server parity.
- Blocking findings: any approval-like active prompt still renders inside transcript in the REPL, any approval key path is lost, any covered prompt double-registers input handlers, or Write/Edit decision context disappears.
- Non-blocking / later-loop findings: cosmetic spacing differences that do not affect ownership or input behavior.
- Known unresolved semantics: none; transcript rows keep non-interactive previews.
- Required targeted tests: affected presenter/block tests plus REPL/surface smoke tests.
- Review prompt scope: verify approval-like inline interactive controls are suppressed or migrated without behavior loss.
- Exit criteria: all approval-like prompt producers render decisions through bottom slot in REPL.

- [x] Add or update transcript-surface guard/helper for inline prompt suppression.
- [x] Update fs read/Search and grep/read presenters or blocks.
- [x] Update Bash, Write, Edit, MCP approval blocks.
- [x] Update WebSearch and WebFetch direct inline presenters.
- [x] Keep large previews/diffs/arguments as non-interactive transcript content.
- [x] Run targeted approval presenter/block/REPL/surface tests.
- [x] Triage review findings into the review finding triage policy.
- [x] Defer loop-level `codex review`; run one final review after full implementation per user instruction.

### Loop 3B — Ask And Plan Prompt Suppression

#### Loop Contract
- Purpose: Move ask-user and plan-mode interactive controls to the bottom slot without losing their richer input state.
- In scope: AskUserQuestion, EnterPlanMode, ExitPlanMode, nested Task prompt coverage, and affected tests.
- Out of scope: new prompt designs, permission merge, Web/app-server parity.
- Blocking findings: ask/plan prompt still renders inside transcript in the REPL, a required key path is lost, feedback typing breaks, review/choice state breaks, or scoped input double-registers.
- Non-blocking / later-loop findings: cosmetic spacing differences that do not affect ownership or input behavior.
- Known unresolved semantics: none; `ask_user_question` remains the protocol kind for these prompts.
- Required targeted tests: ask/plan prompt-slot tests, presenter/block tests, nested Task coverage, and REPL smoke tests.
- Review prompt scope: verify ask/plan inline interactive controls are suppressed or migrated without behavior loss.
- Exit criteria: AskUserQuestion, EnterPlanMode, and ExitPlanMode render active controls through bottom slot in REPL.

- [x] Update AskUserQuestion, EnterPlanMode, and ExitPlanMode prompt rendering.
- [x] Preserve multi-step question, typing, review submit, plan preview, feedback, Esc, and scoped input behavior.
- [x] Add active-prompt coverage where the active prompt has no visible top-level transcript row.
- [x] Keep non-interactive summaries/previews in transcript rows.
- [x] Run targeted ask/plan presenter/block/REPL/surface tests.
- [x] Triage review findings into the review finding triage policy.
- [x] Defer loop-level `codex review`; run one final review after full implementation per user instruction.

### Loop 4 — Final Regression and Cleanup

#### Loop Contract
- Purpose: Confirm the full migration behaves correctly and remove migration leftovers.
- In scope: focused cleanup, contract alignment, targeted final tests.
- Out of scope: permission remember merge and Web/app-server parity.
- Blocking findings: duplicate active prompts, prompt below tool rows, lost key path, stale inline prompt path, or contract mismatch.
- Non-blocking / later-loop findings: Phase 2 permission merge, visual refinements, Web parity.
- Known unresolved semantics: permission remember merge is explicitly Phase 2.
- Required targeted tests: runtime, prompt slot, presenter/block, REPL smoke, surface static test.
- Review prompt scope: verify migration completeness and regressions only.
- Exit criteria: acceptance criteria pass and todo can be closed or converted to final notes.

- [x] Remove dead migration helpers if they are no longer needed.
- [x] Re-run focused test matrix.
- [x] Manually smoke REPL startup in `bun run dev` and use deterministic Ink tests for parallel Search prompt ordering.
- [x] Update `CODEMAP.md` if new long-lived ownership entrypoints were added.
- [x] Triage review findings into the review finding triage policy.
- [x] Run one final `codex review` after targeted verification passed; fixed the valid Read-directory P2 finding without running another review loop.

## 6. Acceptance Criteria

- [x] Parallel Search approval renders at most one `Approve this Search call?`.
- [x] Both Search running rows remain visible in transcript.
- [x] Active approval renders after transcript rows and near the ordinary input position.
- [x] No new tool row appears below the active approval prompt.
- [x] Submitting the first approval advances to the next pending prompt.
- [x] Ordinary `InputBar` is hidden while an active prompt exists.
- [x] Legacy inline prompt components do not register prompt key handlers in bottom-slot mode.
- [x] Phase 1 does not drop, auto-resolve, reorder, or re-evaluate queued approvals because a broader permission was remembered.
- [x] Existing prompt copy, key paths, and submit payloads are preserved.
- [x] Permission remember merge remains out of Phase 1 and is not silently implemented.

## 7. Phase 2 Backlog

- [ ] Permission remember recheck/merge for queued approvals after a broader allow rule is written.
- [ ] Web/app-server/Electron active prompt parity if those surfaces need the same ownership model.
- [ ] Visual polish for bottom-slot decision context after behavior is stable.
