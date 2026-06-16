# Semantics Learning (2026-02-26): Web User Message Persistence

## Context

Web needs to show the submitted user prompt immediately, before the canonical turn stream arrives.
Earlier implementations either inserted an unlinked optimistic `user` transcript row or removed the optimistic row entirely.
The first approach could duplicate the prompt when canonical projection arrived; the second approach left first-send/new-thread cases showing only `Thinking`.

## Root Cause

User transcript ownership was split across two unlinked writers:

1. Web runtime optimistic dispatch (`push_message` + last-row binding)
2. Canonical projection/replay pipeline

This violated single-writer semantics for persisted transcript truth and made live rendering depend on notification/response timing.
Binding "the latest optimistic user row" is also not a stable identity model: draft activation, replay, or nearby local rows can make "latest" ambiguous.

## Canonical Fix

1. Web composer generates a `clientMessageId` for each normal `turn/start` submission.
2. Web renders a local pending user row with that `clientMessageId` before `turn/started` arrives.
3. App-server `turn/started` notification carries `input.text` and echoes `input.clientMessageId` when provided.
4. Semantics adapter maps `turn/started` to canonical `user_message` and preserves `clientMessageId`.
5. Web projection replaces the pending row with the canonical user row by `clientMessageId`; `turnId`/last-row binding is only a compatibility fallback.

Result: live UI has an immediate submitted prompt, while refresh/replay still rebuilds the durable transcript from canonical events.

## Guardrail

For cross-surface parity, treat canonical/replay as the durable owner of user transcript rows.
Renderer-local pending user rows are allowed for server turns only when they have a stable `clientMessageId` handoff to canonical projection.
Renderer-local rows without canonical handoff are allowed only for explicitly local command outputs that never enter the server turn stream.
