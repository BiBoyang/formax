# 2026-03-06 - Deferred Tool Exposure Shared Resolver (REPL/App-Server/SDK)

## Context

We needed closer parity with current Claude Code deferred tool semantics:

- initial exposure prefers `ToolSearch`
- `ToolSearch` success returns structured `tool_reference` blocks
- loaded tools carry `defer_loading` metadata
- semantics must stay aligned across REPL, app-server, and SDK.

## Change

Added shared orchestration in:

- `packages/core/src/tools/runtime/deferredToolExposureResolver.ts`

The resolver now owns:

1. per-turn Skill spec refresh (`includeAvailableSkillsInDescription` toggle),
2. deferred catalog registration/session key plumbing,
3. injected prompt blocks (`<available-deferred-tools>` + skills reminder),
4. initial `toolsForTurn`,
5. dynamic `resolveToolsForCall`.

All three entry paths now consume the same resolver:

- REPL: `packages/core/src/features/repl/controller/send/sendMainTurn.ts`
- app-server: `packages/core/src/app-server/turnRunner.ts`
- SDK: `packages/core/src/sdk/query/runner.ts`

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

## Follow-up alignment (A path): regex/BM25 search engines + tool reference key

To get closer to Claude ToolSearch behavior without switching to Anthropic server-side tool types:

- Added configurable plain-query engine modes:
  - `bm25` (default),
  - `regex`,
  - `keyword` (legacy lexical),
  - `hybrid` (BM25-first with lexical fill).
- Added per-query overrides:
  - `regex:<pattern>`,
  - `bm25:<query>`,
  - `keyword:<query>`,
  - `hybrid:<query>`,
  - existing `select:<tool_name>` retained.
- Wired engine selection through runtime flag:
  - `FORMAX_TOOLSEARCH_ENGINE`
  - propagated across REPL/app-server/SDK via shared resolver.

Also aligned `tool_reference` payload keying with captures/docs:

- primary key now emits `tool_name`,
- backward-compatible alias `name` is still emitted/read during transition.

This keeps current consumers stable while matching observed Claude payload shape more closely.
