# Prompt Profiles

This project supports two system prompt profiles:

- `full`: Claude Code-style, more prescriptive guidance (default)
- `lite`: Minimal prompt for fast/low-noise functional testing

Select via:

- Env: `FORMAX_PROMPT_PROFILE=full|lite`
- Runtime: `/prompt full|lite`

## Porting TODOs (Claude Code parity)

These items are intentionally omitted or simplified in `full` until implemented:

- `/help` exists (local command), but help content parity is still incomplete
- Tool policy sections that reference tools/behaviors we don’t have yet (e.g. `gh` workflows)
- Rich environment snapshot block: ✅ basic parity added (`<env>` + git snapshot + model id); still missing Claude-specific extras (knowledge cutoff, claude_background_info, main branch inference)
