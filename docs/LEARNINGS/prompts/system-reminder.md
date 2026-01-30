# `<system-reminder>` in Formax

This note clarifies where `<system-reminder>` blocks come from, where they go, and what rules we follow so the project doesn’t devolve into “tags everywhere”.

## Key principle

**UI display and model-context injection are orthogonal.**

- Some `<system-reminder>` blocks are **injected for the model only** (not meant for the default transcript UI).
- Separately, we may strip/remove certain `<system-reminder>` blocks from **UI display** to avoid noise and parsing breakage.

## Categories (source → destination → purpose)

### 1) Reminder text (we generate; model-only)

- Source: `src/prompts/reminders/*`
  - Currently: `src/prompts/reminders/todos.ts` (TodoWrite reminders)
- Builder: `src/features/repl/reminders/ReminderService.ts` wraps reminder text into `<system-reminder>...</system-reminder>`.
- Destination: injected into the **next LLM request** as an additional `text` block (not `tool_result`).
- UI: not shown as raw `<system-reminder>` tags in the default transcript.

### 2) Hooks additionalContext (we generate; model-only)

- Source: hook outputs (e.g. `additionalContext`).
- Builder: `src/chat/engine.ts` packages hook output into `<system-reminder>...</system-reminder>`.
  - SessionStart / UserPromptSubmit / Stop / PostToolUse can inject additional context.
  - PostToolUse can also emit a “blocking error” reminder.
- Destination: injected into the **next LLM request** as an additional `text` block.

### 3) Plan Mode prompt (we generate; model-only)

- Source/builder: `src/utils/planMode.ts`
- Destination: injected into the next LLM request as `<system-reminder>...</system-reminder>`.

### 4) `CLAUDE.md` injection (we generate; model-only)

- Source/builder: `src/features/repl/injectedBlocks.ts`
- Destination: injected into the next LLM request as a `<system-reminder>` block (used to convey repo constraints).

### 5) UI de-noise / compatibility (we do NOT generate; UI-only)

We intentionally handle the case where upstream content includes a trailing `<system-reminder>` appended to `tool_result.content` (Claude Code does this in some captures).

Why it matters:
- It’s **not Formax policy**, so showing it in UI is misleading.
- It can break parsing/formatting (e.g. task JSON parsing) by polluting otherwise machine-readable tool output.

Implementation:
- `src/utils/toolFormatting.ts` → `stripTrailingSystemReminderBlock(raw: string)`
- `src/features/repl/controller/streaming.ts` calls it for tool result display.

Example capture (Claude Code style):
- `proxy/traffic-cc-1/0018_2026-01-30T18-10-05,893_REQ__v1_messages.json`
  - The `<system-reminder>` (malware + READ-ONLY) is appended to the **end of** `role:"user" / type:"tool_result" / content:"..."`.

## Explicit non-goals (current product decision)

- We do **not** implement the “Read-malware” / “READ-ONLY” `<system-reminder>` injection in Formax (token cost + unclear value).
- If needed later, add it behind an explicit config gate and keep it **out of `tool_result`** by default.

## Folder boundary: `src/prompts/reminders/`

Keep `src/prompts/reminders/` for **gentle reminder** templates (e.g. TodoWrite, future compact hints, etc.).

Do **not** move these into `reminders/`:
- hooks `additionalContext` (belongs to hooks/runtime/engine wiring)
- plan mode system prompts
- `CLAUDE.md` injection
