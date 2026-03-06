# 2026-03-06 - Deferred Prompt Variant + Skills Reminder Alignment

## Context

Formax had already introduced deferred tool exposure semantics (`ToolSearch`-first), but prompt/reminder behavior lagged behind current Claude Code captures:

- deferred exposure was enabled,
- while system prompt family still looked like legacy Formax in some paths.

The goal was to keep `FORMAX_DEFERRED_TOOL_EXPOSURE=0` behavior stable, and align `=1` mode more coherently.

## Change

### 1. Prompt variant model with code-level capabilities

In `src/prompts/system.ts`:

- added `SystemPromptVariant`:
  - `legacy`
  - `deferred_aligned`
- added `resolveSystemPromptVariant({ deferredToolExposureEnabled })`.
- added `SystemPromptCapabilities` and per-variant defaults (code constants, not env toggles) for future sections:
  - agent-sdk identity suffix,
  - auto-memory section,
  - VSCode context section,
  - fast mode info section,
  - model family hint.

This makes deferred prompt evolution explicit and extensible without introducing new runtime env branching.

### 2. Cross-entry wiring (avoid semantic drift)

Variant selection is now wired across all main turn entry points:

- REPL main turn: `src/features/repl/controller/send/sendMainTurn.ts`
- REPL `/compact` path: `src/features/repl/controller/send/send.ts` + pre-main/orchestration forwarding
- app-server: `src/app-server/turnRunner.ts`
- SDK query runner: `src/sdk/query/runner.ts`

Result: deferred exposure no longer means "ToolSearch-only + legacy prompt" in one path but not another.

### 3. Skills reminder style alignment

In `src/tools/modules/skill/index.ts`:

- `buildAvailableSkillsSystemReminderText` switched from XML payload style to CC-like reminder bullets:
  - header: `The following skills are available for use with the Skill tool:`
  - body: `- <skillName>: <description>`
- retained XML `<available_skills>` embedding in the `Skill` tool description itself (tool contract unchanged).
- added reminder text sanitization for `<`, `>`, `&`, and multiline collapse to keep `<system-reminder>` framing stable.

## Validation

Updated tests:

- `src/prompts/system.test.ts`
- `src/features/repl/controller/send/sendMainTurn.test.ts`
- `src/tools/runtime/deferredToolExposureResolver.test.ts`
- `src/tools/modules/skill/index.test.ts`

Confirmed with:

- targeted vitest run on changed suites,
- `bun run type-check`,
- `codex review --uncommitted` (no actionable findings).

## Remaining gap candidates

- `claudeMd/currentDate` reminder block shape still differs from captured CC formatting.
- todo-empty reminder remains a Formax-specific block; treat it as intentional product divergence unless explicitly aligned away.
