# 2026-06-12 - Interactive prompt descriptor family safety

Root cause: after moving active prompts into the REPL bottom slot, the descriptor contract still allowed cross-family drift. In particular, generic `ask_user_question` prompts could carry plan-mode snapshot data, approval descriptors could carry unrelated prompt bags, and `exit_plan_mode` rendering depended on convention rather than a hard descriptor family rule.

Decision: treat protocol family and renderer/domain family as separate axes. The canonical protocol kinds remain only `approval` and `ask_user_question`, while bottom-slot renderer families stay approval-like, generic ask-user form, enter-plan, and exit-plan. Any production Ink REPL path that expects bottom-slot rendering must pass a valid `InteractivePromptDescriptor`, and domain variants that require snapshot data must bind `ui.promptVariant` to `promptData.kind`.

Follow-on clarification: `pending` and `active render owner` are related but not identical concepts. The runtime queue keeps `isPending(...)` as the lifecycle truth, while UI compatibility paths now have an explicit `isActivePrompt(...)` query for “should this row render the active controls right now?”. The provider-wrapped `isPending(...)` remains a temporary compatibility alias for active-render guards during the Phase 1 migration.

Boundary: this is a descriptor-contract and runtime-ownership tightening, not a new prompt framework. We are not adding a third canonical protocol kind, not introducing a universal prompt schema, and not changing approval or plan-mode semantics.

Canonical docs:
- `docs/contracts/interactive-input-contract.md`
- `docs/contracts/transcript-surface-contract.md`
