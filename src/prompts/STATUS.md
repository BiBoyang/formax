# System Prompt Status

This project uses a single system prompt path in runtime.

- Runtime always builds the full prompt.
- Prompt shape differences now come from `SystemPromptVariant` (for example `legacy` vs `deferred_aligned`) rather than a user-switchable profile.

## Porting TODOs (Claude Code parity)

These items are intentionally omitted or simplified until implemented:

- Per-turn `CLAUDE.md` injection: ✅ project `CLAUDE.md` is injected as a `<system-reminder>#claudeMd` block; ✅ optional user-level global `~/.formax/CLAUDE.md` (or `${FORMAX_CONFIG_DIR}/CLAUDE.md`); TODO: add discoverability entrypoints (README / `formax setup` / `/doctor`) and consider env-gating if needed
- TodoWrite reminders: ✅ empty-list reminder; ✅ stale reminder text + current todo contents; ✅ tool-loop injection by appending the reminder to the last `tool_result` content (Claude Code style); ✅ per-session todo store file under `~/.formax/todos/<sessionId>-agent-<sessionId>.json`; TODO: tune threshold/TTL against more captures
- `/help` exists (local command), but help content parity is still incomplete
- Tool policy sections that reference tools/behaviors we don’t have yet (e.g. `gh` workflows)
- Rich environment snapshot block: ✅ basic parity added (`<env>` + git snapshot + model id); still missing Claude-specific extras (knowledge cutoff, claude_background_info, main branch inference)

## Reference prompt inventory

- `system-prompts/PORTING-STATUS.md` tracks which files under `system-prompts/` are actually integrated into runtime (`src/`) vs kept as reference only.
