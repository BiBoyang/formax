# Claude Code Current Capture Keypoints (2026-03-05): ToolSearch, Deferred Tools, Prompts

## Scope and Intent

This note captures **current Claude Code behavior** observed from two captures on 2026-03-05, to preserve high-fidelity context before doing Formax-side parity analysis.

The two captures are both from the same Claude Code generation (same CLI/package fingerprint), with different environment configuration:

1. `proxy/traffic-log-2026-03-05T20-50-32` (Team-related env enabled)
2. `proxy/traffic-log-2026-03-05T22-03-22` (Team-related env removed)

This document is intentionally detailed and evidence-first to avoid losing context in future long sessions.

## Version Fingerprint (Both Captures)

Both captures show identical client/runtime headers:

- `user-agent = claude-cli/2.1.69 (external, claude-vscode, agent-sdk/0.2.69)`
- `x-stainless-package-version = 0.74.0`
- `request.body.model = claude-sonnet-4-6`

Evidence:

- `proxy/traffic-log-2026-03-05T20-50-32/0001_2026-03-05T20-51-20,433_REQ__v1_messages.simple.json:13`
- `proxy/traffic-log-2026-03-05T20-50-32/0001_2026-03-05T20-51-20,433_REQ__v1_messages.simple.json:17`
- `proxy/traffic-log-2026-03-05T20-50-32/0001_2026-03-05T20-51-20,433_REQ__v1_messages.simple.json:32`
- `proxy/traffic-log-2026-03-05T22-03-22/0001_2026-03-05T22-03-33,438_REQ__v1_messages.simple.json:13`
- `proxy/traffic-log-2026-03-05T22-03-22/0001_2026-03-05T22-03-33,438_REQ__v1_messages.simple.json:17`
- `proxy/traffic-log-2026-03-05T22-03-22/0001_2026-03-05T22-03-33,438_REQ__v1_messages.simple.json:32`

## Request Framing Pattern (Current CC)

Each request follows a stable shape:

1. `messages[0]` is a user text block containing `<available-deferred-tools>...</available-deferred-tools>`.
2. `messages[1]` user content includes `<system-reminder>` blocks, notably:
   - available skills list for Skill tool
   - current date context
3. `system[]` contains a large static policy prompt.
4. `tools[]` starts with only `ToolSearch` in deferred mode flow.

Evidence (new capture 22-03):

- deferred list: `...0001...json:36`
- skills reminder: `...0001...json:43`
- currentDate reminder: `...0001...json:47`
- system prompt block: `...0001...json:69`
- initial `tools[0].name = ToolSearch`: `...0001...json:77`

## Team Env Toggle Effect (Same CC, Different Env)

The `available-deferred-tools` list changes with Team-related env:

- With Team env:
  - includes `SendMessage`, `TeamCreate`, `TeamDelete`
  - evidence: `proxy/traffic-log-2026-03-05T20-50-32/0001_2026-03-05T20-51-20,433_REQ__v1_messages.json:36`
- Without Team env:
  - those three tools disappear
  - evidence: `proxy/traffic-log-2026-03-05T22-03-22/0001_2026-03-05T22-03-33,438_REQ__v1_messages.json:36`

This confirms Team tools are environment-gated feature exposure, not a global prompt-version change.

## ToolSearch/Deferred-Loading Behavior (Confirmed Chain)

In capture `22-03`, the deferred loading sequence is explicit and complete.

### Step A: Model can only call ToolSearch

- `toolCount=1`, `toolNames=["ToolSearch"]`
- `stopReason="tool_use"`, `responseToolUses=["ToolSearch"]`
- evidence:
  - `proxy/traffic-log-2026-03-05T22-03-22/clean-traffic.log:4`
  - `proxy/traffic-log-2026-03-05T22-03-22/0004_2026-03-05T22-06-17,754_REQ__v1_messages.json:171` (`query: "select:Bash"`)

### Step B: ToolSearch result carries a tool reference

In the next request history, ToolSearch result is not plain text; it is:

- `tool_result.content = [{ "type": "tool_reference", "tool_name": "Bash" }]`

Evidence:

- `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:116`
- `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:120`

### Step C: Bash is now loaded into request.tools

Next request `tools` becomes `["Bash", "ToolSearch"]`, then model calls `Bash`.

Evidence:

- `proxy/traffic-log-2026-03-05T22-03-22/clean-traffic.log:5`
- `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:149` (Bash tool spec present)
- `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:235` (assistant tool_use Bash)

### Step D: Deferred marker is present on loaded tool spec

- `Bash` tool spec includes `"defer_loading": true`
- evidence: `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:181`

### Step E: Final response after tool_result

- request has both ToolSearch and Bash tool calls/results in history
- model ends turn with final text response
- evidence:
  - `proxy/traffic-log-2026-03-05T22-03-22/clean-traffic.log:6`

## Important Anomaly in 20-50 Capture (Gateway/Model Path)

In `20-50`, there is a mismatch pattern that should be treated as transport/provider behavior, not canonical deferred semantics:

1. Request still shows only `ToolSearch` in tools list.
2. Response directly uses `Bash` (`[tool_use:Bash]`) without visible prior ToolSearch call in that turn.
3. `sseSummary.model` appears as `glm-4.7` (not `claude-sonnet-4-6`), despite request model being `claude-sonnet-4-6`.

Evidence:

- tools only ToolSearch: `proxy/traffic-log-2026-03-05T20-50-32/0002_2026-03-05T20-54-43,997_REQ__v1_messages.simple.json:99`
- response tool_use Bash: `proxy/traffic-log-2026-03-05T20-50-32/0002_2026-03-05T20-54-43,997_REQ__v1_messages.simple.json:155`
- response model glm-4.7:
  - `...0001...simple.json:129`
  - `...0002...simple.json:162`

For parity design, prefer `22-03` chain as canonical modern behavior.

## Skills Exposure Placement (Current CC)

In both captures, skill list is carried in user-side `<system-reminder>` rather than in top-level `tools` payload (initially only ToolSearch is exposed).

Evidence:

- skills reminder in both captures:
  - `proxy/traffic-log-2026-03-05T20-50-32/0001_2026-03-05T20-51-20,433_REQ__v1_messages.json:43`
  - `proxy/traffic-log-2026-03-05T22-03-22/0001_2026-03-05T22-03-33,438_REQ__v1_messages.json:43`
- initial tools only ToolSearch:
  - `...20-50...0002...simple.json:99`
  - `...22-03...0001...json:77`

This is a key prompt-layer observation for Formax alignment work.

## System Prompt Stability Between These Two Captures

The large `system` text block is effectively the same between 20-50 and 22-03 captures.

The major observed delta is in deferred tool inventory (Team env-gated exposure), not in system-prompt body.

## What to Watch in Future Captures

When capturing future CC behavior changes, always track these fields first:

1. `request.body.messages[0]` deferred-tool list
2. `request.body.messages[*].content[*]` system-reminder blocks (skills/date/extra contexts)
3. `request.body.tools` names and per-tool flags (`defer_loading`)
4. `assistant tool_use` order vs `request tool_result` shape (`tool_reference` vs plain text)
5. `sseSummary.model` vs `request.body.model` mismatches
6. `clean-traffic.log` sequence summary (`toolCount`, `requestToolCallCount`, `responseToolUses`, `stopReason`)

## Immediate Parity Implications for Formax (Planning Input)

These are observations to carry into Formax parity planning; this file does not prescribe implementation:

1. Tool exposure is no longer “all tools upfront”; deferred-tool inventory + ToolSearch orchestration is first-class.
2. Prompt-layer auxiliary contexts (skills/date) are injected as message-level reminders.
3. ToolSearch results can be structured (`tool_reference`) and influence next-turn `tools` composition.

