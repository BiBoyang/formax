# Config Findings (Claude Code vs Formax)

This folder contains notes gathered from:

- Manual `/config` toggling experiments (`plans/config-settings/compare.txt`)
- Traffic logs (`proxy/traffic-config/*_REQ__v1_messages*.json`)
- Claude Code docs extracts (`plans/config-settings/terminal-config.md`)

This document is intentionally separate from any TODO list so we can delete completed TODOs without losing the evidence trail.

## What we verified (Claude Code)

### Storage / scopes

Claude Code uses multiple scopes and files:

- User scope: `~/.claude/settings.json`
- Local scope (repo + gitignored): `.claude/settings.local.json`
- Additional user-level config: `~/.claude.json` (seems to also contain some `/config` settings in practice)

From `plans/config-settings/compare.txt`, we observed (not exhaustive):

- Local scope (`.claude/settings.local.json`)
  - `spinnerTipsEnabled` → “Show tips”
  - `outputStyle` → “Output style”
- User scope (`~/.claude/settings.json`)
  - `alwaysThinkingEnabled` → “Thinking mode”
  - `model` → “Model” (default selection doesn’t write)
  - `defaultMode` → “Default permission mode”
- User config (`~/.claude.json`)
  - `verbose` → “Verbose output”
  - `autoCompactEnabled` → “Auto-compact”
  - `respectGitignore` → “Respect .gitignore in file picker”
  - `theme` → “Theme”
  - `preferredNotifChannel` → “Notifications” (Auto doesn’t write)
  - `autoConnectIde` → “Auto-connect to IDE”

### “Sparse write” behavior

We saw multiple cases where the UI shows an effective value, but the corresponding file is not updated when the user keeps it at “Default/Auto”. This suggests a “write only overrides (non-defaults)” strategy, plus some values being auto-detected at runtime.

### Output style is implemented as prompt injection (verified by traffic logs)

In the main conversation request (Sonnet), when `Output style` changes, Claude Code injects a `system-reminder` + local command transcript into the *user* message. Example extracted from `proxy/traffic-config/0011_*_REQ__v1_messages.json` (shape, not verbatim):

- `<system-reminder> Explanatory/Learning output style is active... </system-reminder>`
- `Caveat: local commands...`
- `<command-name>/config</command-name> ... <local-command-stdout>Set output style to ...</local-command-stdout>`
- The user’s actual message text

### Thinking mode is an API parameter (verified by traffic logs)

When “Thinking mode” is toggled, the request body’s `thinking` field appears/disappears (Anthropic official-style request parameter).

### Verbose output appears UI-only (best-effort conclusion)

From our traffic logs, we did not find any prompt/system/request-field change attributable to “Verbose output”.

Claude Code doc-aligned interpretation: Verbose controls whether the CLI **shows the extended thinking process**, not whether the model produces it.

### `/config` exit subline messages (observed via terminal copy)

When exiting `/config`, Claude Code prints a command subline. We observed at least:

- No persisted changes: `Status dialog dismissed`
- With changes: `Set <field> to <value>`
  - Example: `Set output style to Explanatory` / `Set output style to Learning`
  - Example: `Set model to opus (claude-opus-4-5-20251101)`
  - Example: `Set editor mode to normal` (we are not planning to implement editor mode parity)

## Not yet verified

The following were not tested by us (so we should treat their storage/effect as unknown until confirmed or until we define Formax behavior independently):

- “Rewind code (checkpoints)”
- “Editor mode”
