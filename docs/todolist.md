# Interactive Prompt Architecture Convergence Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] Formax now renders active REPL interactive prompts through the bottom `ActivePromptSlot` instead of transcript-row-owned inline controls.
- [x] Canonical protocol kinds remain `approval` and `ask_user_question` as defined in `docs/contracts/interactive-input-contract.md`.
- [x] `EnterPlanMode` and `ExitPlanMode` are domain prompts that still map to protocol kind `ask_user_question`.
- [x] `UserInputManager` now owns the pending queue and exposes the FIFO active descriptor consumed by the REPL bottom slot.
- [x] `ExitPlanMode` already moved to prompt-creation-time descriptor snapshot data for its bottom-slot path.
- [x] WebGPT review in `repomix-output/1.md` recommends continuing unification at the protocol/lifecycle/descriptor layer, while explicitly pushing back on a universal prompt component or universal prompt schema.

### 0.2 Goals
- [x] Strengthen `InteractivePromptDescriptor` into a safer, more explicit contract for bottom-slot rendering.
- [x] Make descriptor snapshot data the only source of active prompt rendering data for real REPL interactive flows.
- [x] Reduce architectural drift between protocol semantics, runtime lifecycle ownership, and renderer hints.
- [x] Split `ActivePromptSlot` toward a thinner router model so prompt-family adapters and domain renderers do not accumulate into one large switchboard.
- [x] Preserve current user-visible behavior while making future prompt additions safer and more local.

### 0.3 Non-goals
- [x] Phase 1 does not introduce a third canonical protocol kind for plan-mode prompts.
- [x] Phase 1 does not build a universal prompt component or a universal prompt JSON/schema abstraction.
- [x] Phase 1 does not redesign approval, ask-user, or plan-mode UI copy or flow.
- [x] Phase 1 does not expand this task into Web/app-server/Electron parity work unless a contract gap is discovered first.
- [x] Phase 1 does not broaden into permissions-policy semantic changes, remember-scope redesign, or queue-merging behavior.

### 0.4 Spec lock and review-scope
- [x] Spec lock required: this work crosses runtime ownership, descriptor typing, REPL rendering, and canonical contracts.
- [x] Review findings log: use this todo unless findings volume becomes large enough for a dedicated log.
- [x] Review findings must be classified before code changes.
- [x] Current-loop review is scoped by each loop's `Loop Contract`.
- [x] Later-loop findings are logged, not chased in the current loop.
- [x] Spec ambiguity stops implementation until contracts/todo/user alignment are updated.
- [x] `codex review` runs once after all implementation loops and targeted verification are complete, not after each loop.

### 0.5 Decision Draft Summary
- [x] Storage/config source: no durable config or storage changes.
- [x] Schema/defaults/rejected fields: descriptor contract should become more strongly typed and bind `kind`, `promptVariant`, and `promptData` more tightly.
- [x] Startup/activation timing: descriptors are still created only during existing interactive prompt transactions; no startup side effects change.
- [x] Permission model: approval semantics remain owned by existing permissions/policy contracts; renderer architecture must not alter approval meaning.
- [x] Capability level: this is runtime ownership + renderer-boundary convergence, not a new tool or slash command.
- [x] Result/IO/cleanup bounds: no new persistent output or secret handling; prompt snapshot data remains in-memory transaction data.
- [x] Explicit non-goals: no universal prompt framework, no new canonical prompt kind, no protocol redesign beyond stricter descriptor contracts.
- [x] REPL-rendering invariant: any production Ink REPL interactive path that expects bottom-slot rendering must pass a valid descriptor into `requestAnswers`; descriptor-less calls are only for test, non-rendering, or explicitly legacy-compatibility callers.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Update `docs/contracts/interactive-input-contract.md` to strengthen descriptor ownership rules for real interactive REPL flows.
- [x] Update `docs/contracts/transcript-surface-contract.md` if needed to make legacy inline prompt paths explicitly compatibility-only in bottom-slot mode.
- [x] Add or update a short learning note once the architecture convergence decisions are implemented.
- [x] Do not create a new canonical contract unless this work reveals missing contract surface that cannot fit existing docs.

### 1.2 Data model
- [x] Define the accepted descriptor families clearly and separate protocol family from renderer/domain family.
- [x] Document protocol families as `approval` and `ask_user_question`.
- [x] Document renderer/domain families under those protocols as approval-like, generic ask-user form, enter-plan prompt, and exit-plan prompt.
- [x] Treat `InteractivePromptDescriptor` as the sole active-rendering data contract for bottom-slot prompts.
- [x] Require `ExitPlanMode` active rendering data to come from descriptor snapshot state only, not view-time file/session reads.
- [x] Make `promptData.kind` mandatory for domain prompt variants that require snapshot data.
- [x] Require `exit_plan_mode` bottom-slot descriptors to include `promptData.kind='exit_plan_mode'` and `planContentState`.
- [x] Preserve descriptor-less `requestAnswers` only for legacy/test/non-rendering use cases.

### 1.3 Types / Interfaces
- [x] Convert `InteractivePromptDescriptor` toward a discriminated union or equivalent invariant-bearing type shape.
- [x] Bind `descriptor.kind`, `ui.promptVariant`, and `promptData.kind` so invalid combinations are impossible or rejected early.
- [x] Ensure renderer-required family fields are either statically required by the descriptor family type or rejected by a single validation boundary before reaching `ActivePromptSlot`.
- [x] Clarify whether `UserInputProvider.isPending` should stay overloaded as “active-only” or split into lifecycle vs UI-active queries.
- [x] Until an API split exists, freeze provider-wrapped `isPending` as an active-render guard only, not lifecycle truth.
- [x] Add a typed builder/helper boundary for domain prompt descriptors where it reduces call-site drift, especially for `ExitPlanMode`.
- [x] Add dev-time/runtime invariants for mismatched descriptor family data when type-level exclusion alone is insufficient.
  2026-06-12 follow-up: introduce explicit `isActivePrompt(...)` for UI render guards and migrate compatibility presenters/tool blocks to it; keep provider-wrapped `isPending(...)` as a Phase 1 compatibility alias so we do not broaden this loop into transcript preview behavior changes.

### 1.4 Semantic decision table
| Decision | Accepted rule | Source | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|---|
| Canonical protocol kinds | Keep only `approval` and `ask_user_question` | `Formax-existing`; `repomix-output/1.md` | Add `enter_plan_mode` or `exit_plan_mode` as new canonical kinds | `interactive-input` | plan prompts remain protocol-compatible |
| Descriptor ownership | Bottom-slot active prompt renders only from descriptor snapshot data | `Formax-existing`; `User-aligned`; `repomix-output/1.md` | View-time reads from session/file state for active prompt content | `interactive-input` | `ExitPlanMode` active path never flashes fallback due to async reads |
| UI unification scope | Unify protocol/lifecycle/ownership/shell primitives, not business UI bodies | `User-aligned`; `repomix-output/1.md` | Universal prompt component/schema | `interactive-input`, `transcript-surface` | per-family renderers stay distinct |
| Active owner | `UserInputManager` remains the only pending queue owner and active-prompt source | `Formax-existing`; `repomix-output/1.md` | transcript reverse scan or component-local pending state | `interactive-input` | active prompt progression remains FIFO |
| REPL descriptor requirement | Any production Ink REPL-rendering interactive path MUST pass a valid descriptor to `requestAnswers` | `repomix-output/2.md`; `Formax Phase-1 safety choice` | descriptor-less REPL-rendering pending requests | `interactive-input` | no renderable pending prompt can exist without descriptor data |
| Prompt-family rendering | `ActivePromptSlot` should act as router/composer, not long-term domain logic hub | `Formax Phase-1 safety choice`; `repomix-output/1.md` | keep growing one large slot switch forever | local README / code structure | new variants require local renderer additions |
| Protocol vs renderer family | `ask_user_question` is a protocol/lifecycle family; generic ask-user form is only one renderer family under it | `repomix-output/2.md`; `Formax-existing` | treat `ask_user_question` as one UI family/component | `interactive-input` | plan prompts keep shared protocol without sharing one UI body |
| Domain snapshot binding | Domain prompt variants that require snapshot data MUST bind `ui.promptVariant` to `promptData.kind` | `repomix-output/2.md`; `Formax Phase-1 safety choice` | generic `promptData` bag with cross-family drift | `interactive-input` | invalid variant/data pairs fail fast |
| Answer normalization | Normalize by prompt family, not via one cross-family mega-normalizer | `Formax-existing`; `repomix-output/1.md` | merge approval, ask, and plan semantics into one answer model | runtime helpers | approval and plan tests stay domain-specific |

### 1.5 EntryPoint Matrix
| EntryPoint | Reads config? | Activates runtime? | Exposes capability? | UI/transcript behavior | Tests |
|---|---|---|---|---|---|
| REPL | No change | No change | Yes | Bottom-slot active prompt continues as canonical REPL surface | Ink/runtime tests |
| SDK | No change | No change | No new UI | Lifecycle behavior only, no prompt rendering | runtime tests |
| app-server | No change in Phase 1 | No change | No Phase 1 surface change | Existing behavior unchanged | none in Phase 1 |
| Web | No change in Phase 1 | No change | No Phase 1 surface change | Existing behavior unchanged | none in Phase 1 |
| Electron | No change in Phase 1 | No change | No Phase 1 surface change | Existing behavior unchanged | none in Phase 1 |

### 1.6 Review finding triage policy
- [ ] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract`.
- [ ] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [ ] For later-loop findings, update this todo and make sure a later loop owns them.
- [ ] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [ ] For reviewer preference, do not adopt unless it is low-risk, local, and does not change behavior or scope.
- [ ] For contract conflicts, cite the accepted contract and add focused regression coverage when needed.

## 2. Runtime / Platform
- [x] Tighten `packages/core/src/tools/runtime/interactivePromptDescriptor.ts` around prompt-family invariants.
- [x] Audit `packages/core/src/tools/runtime/interactivePromptTransaction.ts` and related builder/helper paths so real REPL interactive flows always carry descriptors.
- [x] Audit `packages/core/src/tools/runtime/userInputManager.ts` for descriptor-less interactive deadlock risk and active-vs-pending API clarity.
- [x] Introduce small family-specific descriptor builders/helpers where they reduce duplicated call-site shaping logic.
- [x] Add or tighten a single validation boundary for renderer-family mismatches before `ActivePromptSlot` routing.
  2026-06-12 audit note: production interactive prompt entrypoints now converge through `approvalService`, `skillPreflight`, or `askUserQuestionPrompt`, each of which constructs a descriptor before `runInteractivePromptTransaction`; remaining direct `requestAnswers(...)` callsites under `packages/core/src/**` are tests, app-server harness coverage, or legacy/non-rendering queue exercises.

## 3. REPL / Tool UI Boundary
- [x] Split `ActivePromptSlot.tsx` toward a thinner router and extract prompt-family payload adapters.
- [x] Keep approval-like renderers, generic ask renderers, and plan-mode renderers distinct even if they share shell primitives.
- [x] Decide whether legacy inline prompt presenters need stronger compatibility-only guardrails or can stay as-is for now.
- [x] Ensure any remaining plan-mode fallback path does not reintroduce view-owned active prompt data.
  2026-06-12 audit note: keep legacy inline presenters as compatibility-only for now. `enterPlanMode`, `exitPlanMode`, `webFetch`, `webSearch`, `notebookEdit`, and `skill` are all bottom-slot-guarded by `useInlineInteractivePromptAllowed()`, and focused tests now lock that they do not render inline active prompts on the bottom-slot surface.

## 4. Tests
- [x] Add descriptor invariant tests that reject or fail-fast on impossible `kind` / `promptVariant` / `promptData` combinations.
- [x] Add runtime tests ensuring real interactive paths that should render in REPL always provide descriptors.
- [x] Add or refine `ActivePromptSlot` tests around family routing and payload adapter extraction.
- [x] Add regression coverage ensuring `ExitPlanMode` active rendering never depends on async plan reads in the slot path.
- [x] Add tests if API semantics split between `isPending` and an explicit active-prompt query.

## 5. Recommended Execution Order

### Loop 1
#### Loop Contract
- Purpose: lock the descriptor contract and invariants before UI refactoring.
- In scope: tests-first descriptor contract locking, descriptor typing, builder/helpers, runtime ownership rules, targeted contract updates.
- Out of scope: large renderer extraction or UI cleanup.
- Blocking findings: descriptor families remain mismatched/loose, any production Ink REPL-rendering interactive path can still omit descriptors, variant/data mismatches can still reach `ActivePromptSlot`, or canonical contract drift remains unresolved.
- Non-blocking / later-loop findings: slot router cleanup, shared shell primitive extraction, compatibility presenter cleanup.
- Known unresolved semantics: whether `isPending` API split is worth immediate change or can be phased.
- Required targeted tests: descriptor/runtime/user-input tests must be added or tightened before descriptor-family implementation changes land.
- Review prompt scope: descriptor contract safety and active prompt ownership only.
- Exit criteria: descriptor family invariants are explicit, renderer-required fields are closed or fail-fast before slot routing, and the active prompt data source is fully runtime-owned.

- [x] Update contracts/todo language to reflect accepted descriptor-family rules.
- [x] Write the protocol-family vs renderer-family distinction explicitly into the contract/todo language.
- [x] Add or tighten Loop 1 descriptor/runtime tests before changing descriptor-family implementation.
- [x] Lock tests for descriptor-family mismatch rejection or fail-fast behavior before implementation cleanup.
- [x] Tighten `InteractivePromptDescriptor` typing/invariants.
- [x] Make REPL-rendering descriptor requirements explicit and enforceable.
- [x] Add or refine family-specific descriptor builders where needed.
- [x] Lock `exit_plan_mode` snapshot requirements for bottom-slot rendering.
- [x] Verify all real REPL interactive paths carry descriptors.
- [x] Run targeted runtime/descriptor tests.
- [ ] Triage review findings into this todo.
- [x] Record any review-sensitive risks for the final cross-loop `codex review`.
  Risk note: review should check for any remaining production UI render path still relying on descriptor-less pending requests or row-local state reconstruction instead of descriptor snapshots.

### Loop 2
#### Loop Contract
- Purpose: thin `ActivePromptSlot` into a router plus family adapters without changing behavior.
- In scope: tests-first slot routing parity, payload adapter extraction, renderer routing cleanup, targeted slot tests.
- Out of scope: prompt redesign, shell primitive over-abstraction, app-server/Web parity.
- Blocking findings: payload parity changes, slot routing becomes less safe, or new prompt-family additions still require editing one giant switch in fragile ways.
- Non-blocking / later-loop findings: naming polish, optional primitive extraction, presenter cleanup beyond current family routing needs.
- Known unresolved semantics: exact long-term registry shape can stay local if routing becomes materially safer.
- Required targeted tests: `ActivePromptSlot` plus affected presenter/runtime tests must lock payload parity and family routing behavior before router extraction.
- Review prompt scope: slot router thinness and behavior parity.
- Exit criteria: `ActivePromptSlot` primarily routes; family-specific mapping logic is localized.

- [x] Add or tighten Loop 2 routing/parity tests before extracting router or payload adapters.
- [x] Lock tests for family-local payload mapping and slot routing behavior before implementation changes.
- [x] Extract approval-like payload mapping from `ActivePromptSlot`.
- [x] Extract ask/plan payload adapters from `ActivePromptSlot`.
- [x] Keep renderer families separated while reducing slot-local domain branching.
- [x] Run targeted slot/presenter tests.
- [ ] Triage review findings into this todo.
- [x] Record any review-sensitive risks for the final cross-loop `codex review`.
  Risk note: review should check whether any new prompt variant would still require editing too many slot-local branches instead of staying family-local.

### Loop 3
#### Loop Contract
- Purpose: clean up compatibility edges and remaining view-owned prompt-data fallbacks where still risky.
- In scope: tests-first compatibility regressions, legacy inline guardrails, plan-mode fallback ownership review, and only compatibility presenters that can own active controls or active prompt data.
- Out of scope: broad subsystem cleanup, protocol redesign, parity expansion.
- Blocking findings: legacy compatibility path can still conflict with active-slot ownership, or active content can still be sourced from view-time reads in production paths.
- Non-blocking / later-loop findings: optional primitive extraction, broader prompt UI cleanup, Phase 2 parity work.
- Known unresolved semantics: how far compatibility presenters should be simplified without removing useful previews.
- Required targeted tests: focused regression tests around compatibility-only paths must be added or tightened before compatibility cleanup lands.
- Review prompt scope: double-owner prevention and cleanup safety.
- Exit criteria: no meaningful active prompt ownership ambiguity remains in the REPL path.

- [x] Add or tighten Loop 3 compatibility regression tests before presenter cleanup.
- [x] Lock tests for legacy-inline guardrails and active-prompt-data ownership before implementation cleanup.
- [x] Audit remaining compatibility presenters and mark/limit interactive responsibilities explicitly.
- [x] Keep non-interactive previews and status rows out of cleanup scope unless they can become active prompt owners.
- [x] Remove or isolate any remaining risky view-time active prompt data reads in production REPL paths.
- [x] Run focused regression tests.
- [ ] Triage review findings into this todo.
- [x] Record any review-sensitive risks for the final cross-loop `codex review`.
  Risk note: review should inspect the remaining provider-wrapped `isPending(...)` compatibility alias and confirm no UI code that needs lifecycle truth is accidentally reading the wrapped manager instead of the base manager.

### Final Review Gate

- [ ] Reconcile loop-level review notes and unresolved risks in this todo before final review.
- [ ] Run one final `codex review` after all implementation loops and targeted verification pass.
- [ ] Classify final review findings using the review triage policy before making any follow-up edits.
