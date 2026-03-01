---
name: formax-permissions-workflow
description: Use when implementing or debugging Formax permissions/policy/approval behavior and UI (allow/ask/deny rules, workspace boundaries, approval prompts, and /permissions overlay parity with Claude Code).
---

# Formax permissions / approvals workflow

## Goal

Make changes to permissions and approvals while keeping:
- allow/ask/deny semantics correct and explainable
- approvals UI parity (copy/spacing/colors/keys) unless explicitly requested
- “UI output” vs “model context injection” orthogonal
- regressions locked by targeted tests

## Where to change what

### 1) Policy preflight (ToolCall → allow/ask/deny decision)
- `src/tools/executor/policyPreflight.ts`: turns ToolCall into a PolicyAction + decides deny/prompt/allow
- `src/tools/executor/policyAction.ts`: ToolCall → PolicyAction mapping
- `src/tools/executor/policyExplain.ts`: explain/debug text for decisions
- `src/tools/modules/bash/policy.ts`: Bash risk classification (some “safe” Bash can bypass approvals)

### 2) Permissions storage + matching (rules & precedence)
- `src/adapters/permissions/permissionsStore.ts`: read/write settings + merge precedence (user/project/projectLocal)
- `src/adapters/permissions/permissionKeys.ts`: stable keys/paths for settings
- `src/adapters/permissions/matcher.ts`: matcher semantics (including `:*` vs `*` rules per docs)

### 3) Approvals (prompt UI + persistence side-effects)
- `src/tools/executor/approvalService.ts`: “ensureApproved” flow, integrates UI prompts + writes allow/ask/deny when applicable
- UI prompts (tool-level approvals):
  - `src/tools/presenters/bashApprovalPrompt.tsx`
  - `src/tools/presenters/fsReadApprovalPrompt.tsx`
  - `src/tools/presenters/fsWriteApprovalPrompt.tsx`
  - `src/tools/presenters/skillApprovalPrompt.tsx`
  - `src/tools/presenters/editApprovalPrompt.tsx`
- Shared pieces:
  - `src/tools/presenters/ApprovalHeader.tsx`: Claude-style divider + permission-colored title
  - `src/components/ui/ConfirmMenu.tsx`: menu input + highlight rules

### 4) /permissions overlay (manage rules & workspace)
- `src/tui/permissions/PermissionsDialog.tsx`: state machine + key handling
- `src/tui/permissions/ui.tsx`: rendering primitives (Tabs, lists, confirm views)
- `src/features/repl/controller/overlays.ts`: overlay open/close + “command_subline” dismissal messages
- Slash command wiring:
  - `src/features/commands/registry.ts` (or `src/screens/repl/createReplCommandRegistry.ts`): `/permissions` opens overlay

## Patterns (parity rules)

### Pattern A: Tool approval prompt (3 options + Esc)
Use when we need “approve + remember + type feedback”:
- Options:
  1) `Yes`
  2) `Yes, ...` (remember/allow in repo/session)
  3) `Type here to tell Claude what to do differently` (inline editor)
- Do **not** add a “Cancel” menu item; cancellation is `Esc to cancel`.
- Title + divider line + active item color should use `theme.permission`.

### Pattern B: Pure confirm prompt (Yes/No)
Use when confirming a destructive UI action (delete rule, remove dir):
- Options: `Yes` / `No`
- Also support `Esc to cancel` as a fast exit.

### Pattern C: Partial emphasis in menu options
When a single substring should be white/bold (e.g. `capture-terminal/`):
- Use `ConfirmMenu`’s emphasis mechanism (don’t build bespoke JSX in each prompt).
- Selected row must override emphasis color to `theme.permission` (no white “holes”).

## Tests (minimum regression set)

Run targeted tests close to your change:
- `bun run test -- src/tools/executor/policyPreflight.test.ts`
- `bun run test -- src/tools/executor/approvalService.test.ts`
- `bun run test -- src/tools/presenters/bashApprovalPrompt.test.tsx`
- `bun run test -- src/tools/presenters/fsReadApprovalPrompt.test.tsx` (if present)
- `bun run test -- src/tools/presenters/fsWriteApprovalPrompt.test.tsx`
- `bun run test -- src/tools/presenters/skillApprovalPrompt.test.tsx`
- `bun run test -- src/tui/permissions/PermissionsDialog.test.tsx`

## Workflow (use every time)

1) **Lock behavior first**: add/extend tests for the exact keypaths (↑↓, Enter, Esc, numeric select).
2) **Implement smallest change**: preserve UI copy/spacing/colors unless explicitly requested.
3) **Run targeted tests** (above).
4) **Run review**: follow `AGENTS.md` -> `Review Profile (Single Source of Truth)` (fix high/medium findings).
5) Commit with Conventional Commit (`fix(permissions): ...` / `refactor(approval): ...`).

## Guardrails

- Do not “simplify” UI as a side-effect of refactor (tests are not the only spec).
- Keep “show in UI” vs “inject into model context” orthogonal.
- Prefer shared components (`ApprovalHeader`, `ConfirmMenu`) over raw ANSI or one-off key handling.
