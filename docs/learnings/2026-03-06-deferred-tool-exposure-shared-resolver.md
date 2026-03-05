# 2026-03-06 - Deferred Tool Exposure Shared Resolver (REPL/App-Server/SDK)

## Context

We needed closer parity with current Claude Code deferred tool semantics:

- initial exposure prefers `ToolSearch`
- `ToolSearch` success returns structured `tool_reference` blocks
- loaded tools carry `defer_loading` metadata
- semantics must stay aligned across REPL, app-server, and SDK.

## Change

Added shared orchestration in:

- `src/tools/runtime/deferredToolExposureResolver.ts`

The resolver now owns:

1. per-turn Skill spec refresh (`includeAvailableSkillsInDescription` toggle),
2. deferred catalog registration/session key plumbing,
3. injected prompt blocks (`<available-deferred-tools>` + skills reminder),
4. initial `toolsForTurn`,
5. dynamic `resolveToolsForCall`.

All three entry paths now consume the same resolver:

- REPL: `src/features/repl/controller/send/sendMainTurn.ts`
- app-server: `src/app-server/turnRunner.ts`
- SDK: `src/sdk/query/runner.ts`

SDK/app-server strip injected blocks before persisting history snapshots, keeping user-visible history clean.

Deferred exposure session storage now uses bounded eviction (oldest sessions trimmed after a fixed cap) to avoid unbounded memory growth in long-lived SDK/app-server processes.

## ToolSearch payload alignment

- `ToolSearch` now returns structured `tool_result.content` on success:
  - leading `text` block (summary)
  - one or more `tool_reference` blocks
- deferred catalog tools are tagged with `defer_loading: true`.

## Compatibility hardening

Because `tool_result.content` is no longer string-only:

- contracts/types now allow structured content,
- stream/event validators accept non-string `tool_end.result.content`,
- text-only consumers use `toolResultContentToText(...)` fallback.

This prevents regressions in OpenAI mapping, tool end summaries, REPL tool completion rendering, and prompt pruning.
