# Formax Capture (2026-03-05 22:47) vs Claude Code Deferred Tool Exposure

## Scope

This note records what Formax currently sends in capture:

- `proxy/traffic-log-2026-03-05T22-47-37`

and compares it with the already documented current Claude Code behavior:

- `docs/learnings/2026-03-05-cc-current-capture-keypoints-toolsearch-and-prompts.md`

Focus here is tool exposure flow (not TeamCreate/TeamDelete rollout).

## Formax Capture Summary (22:47:37)

`clean-traffic.log` shows 7 requests:

1. seq1 main turn, `toolCount=18`
2. seq2 title/topic meta turn, `toolCount=0`
3. seq3 main turn, `toolCount=18`
4. seq4 title/topic meta turn, `toolCount=0`
5. seq5 main turn (`执行下 pwd`), `toolCount=18`, model emits `tool_use` for `Bash`
6. seq6 follow-up turn with tool call/result in history, `toolCount=18`
7. seq7 title/topic meta turn, `toolCount=0`

Evidence:

- `proxy/traffic-log-2026-03-05T22-47-37/clean-traffic.log`

## Concrete Findings (Formax)

### 1) Full tool list is sent on every main turn

In seq1/3/5/6, Formax sends all tools directly (18 in this capture), including `Bash`, `Skill`, etc.

Evidence:

- `proxy/traffic-log-2026-03-05T22-47-37/0001_2026-03-05T22-47-49,783_REQ__v1_chat_completions.json:38`
- `proxy/traffic-log-2026-03-05T22-47-37/0005_2026-03-05T22-49-53,961_REQ__v1_chat_completions.json:56`
- `proxy/traffic-log-2026-03-05T22-47-37/0006_2026-03-05T22-50-00,198_REQ__v1_chat_completions.json:80`

### 2) Request shape is OpenAI-compatible chat/completions

This capture uses OpenAI-style endpoint and payload shape:

- endpoint: `/v1/chat/completions`
- model: `deepseek-reasoner`
- includes `tool_choice: "auto"` when tools are present

Evidence:

- `proxy/traffic-log-2026-03-05T22-47-37/clean-traffic.log`
- `proxy/traffic-log-2026-03-05T22-47-37/0001_2026-03-05T22-47-49,783_REQ__v1_chat_completions.json:22`
- `proxy/traffic-log-2026-03-05T22-47-37/0005_2026-03-05T22-49-53,961_REQ__v1_chat_completions.json:708`

### 3) `pwd` path is direct `Bash`, no ToolSearch hop

For `执行下 pwd`, model directly issues `Bash` tool call, then tool result is returned, then final assistant text.

Evidence:

- request prompt with `执行下 pwd`:
  - `proxy/traffic-log-2026-03-05T22-47-37/0005_2026-03-05T22-49-53,961_REQ__v1_chat_completions.json:48`
- assistant tool call `Bash`:
  - `proxy/traffic-log-2026-03-05T22-47-37/0005_2026-03-05T22-49-53,961_REQ__v1_chat_completions.json:725`
- tool result and final text:
  - `proxy/traffic-log-2026-03-05T22-47-37/0006_2026-03-05T22-50-00,198_REQ__v1_chat_completions.json:67`
  - `proxy/traffic-log-2026-03-05T22-47-37/0006_2026-03-05T22-50-00,198_REQ__v1_chat_completions.json:740`

### 4) System prompt is centralized in a single system message

Formax puts a large static system instruction block in `messages[0].content` (includes tone/tool policy/subagent list/env block/date).

Evidence:

- `proxy/traffic-log-2026-03-05T22-47-37/0001_2026-03-05T22-47-49,783_REQ__v1_chat_completions.json:26`

### 5) Skill inventory is still exposed via `Skill` tool description

Current Formax generation path injects `<available_skills>` into the `Skill` tool description at spec build time.

Code evidence:

- `src/tools/modules/skill/spec.ts:12`
- `src/tools/modules/skill/index.ts:51`
- `src/tools/modules/skill/index.ts:66`
- `src/tools/modules/skill/index.ts:69`

## Delta vs Current Claude Code (Tool Exposure)

### Claude Code current (canonical chain from 22:03 capture)

1. First turn only exposes `ToolSearch` in `tools[]`.
2. Deferred tool inventory is listed in message text (`<available-deferred-tools>`), not as full JSON tool specs.
3. Model calls `ToolSearch` (`select:Bash`).
4. Tool result carries `tool_reference` for `Bash`.
5. Next request `tools[]` includes `Bash + ToolSearch` (with `defer_loading: true` on loaded tool).
6. Then model calls `Bash`.

Evidence:

- deferred list and ToolSearch-only tools:
  - `proxy/traffic-log-2026-03-05T22-03-22/0001_2026-03-05T22-03-33,438_REQ__v1_messages.json:36`
  - `proxy/traffic-log-2026-03-05T22-03-22/0001_2026-03-05T22-03-33,438_REQ__v1_messages.json:77`
- ToolSearch call (`select:Bash`):
  - `proxy/traffic-log-2026-03-05T22-03-22/0004_2026-03-05T22-06-17,754_REQ__v1_messages.json:171`
- `tool_reference` and next-turn loaded Bash:
  - `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:120`
  - `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:149`
  - `proxy/traffic-log-2026-03-05T22-03-22/0005_2026-03-05T22-06-25,774_REQ__v1_messages.json:181`

### Formax now

- Sends full tool JSON upfront each main turn.
- No ToolSearch bootstrap stage.
- No deferred tool inventory block in user message.
- No loaded-tools state machine across turns.

## Why This Matters for Implementation

The current Formax architecture assumes tools are precomputed and handed to every turn as a static array (plus minor per-turn patch for `Skill`):

- tool list assembly:
  - `src/runtime/bootstrap/subagents.ts:73`
- REPL wiring passes fixed `runtime.tools`:
  - `src/runtime/bootstrap/runLegacyCli.tsx:43`
- turn execution passes tools directly:
  - `src/features/repl/controller/send/sendMainTurn.ts:208`
  - `src/features/repl/controller/send/sendMainTurn.ts:213`
- app-server has same pattern:
  - `src/app-server/turnRunner.ts:212`
  - `src/app-server/turnRunner.ts:419`

Streaming clients serialize whatever `args.tools` they receive directly into request payload:

- OpenAI path:
  - `src/streaming/openai/StreamClient.ts:469`
  - `src/streaming/openai/StreamClient.ts:470`
- Anthropic path:
  - `src/streaming/anthropic/StreamClient.ts:125`

So deferred exposure is not a small presenter-level tweak; it needs a turn-level tool-state model.

## Change Surface Estimate (Ignoring TeamCreate/TeamDelete)

### If target is only "CC-like exposure style" (deferred ToolSearch flow)

Estimated effort: **medium to large** (cross-cutting), because you must introduce loaded-tool state and replace "always full tools" assumptions.

Likely touched layers:

1. Tool catalog/orchestration
- Add `ToolSearch` module and a deferred catalog (search/select behavior, name matching, gating rules).

2. Turn-state model
- Maintain "loaded tools for this session/turn" state.
- Build `toolsForTurn` from that state (`ToolSearch` always present, others loaded on demand).

3. Request framing
- Inject `<available-deferred-tools>` and related reminder blocks into user-side messages.
- Move (or duplicate during migration) skill inventory exposure from `Skill` description to reminder text to match CC pattern.

4. Multi-surface parity
- REPL path (`sendMainTurn`), app-server path (`TurnRunner`), SDK query path (`runner.ts`) must share same semantics.

### If target is only "prompt wording alignment" without true deferred semantics

Estimated effort: **small to medium**, but this gives only visual prompt similarity and does not reproduce CC behavior.

## Recommended rollout order

1. Add a feature flag for deferred exposure mode.
2. Implement `ToolSearch` + loaded-tools state machine under flag.
3. Route REPL/app-server/SDK through one shared "toolsForTurn resolver".
4. Add capture parity tests (including `pwd` path: ToolSearch then Bash).
5. After parity is stable, shift skills exposure fully to reminder-style blocks.

