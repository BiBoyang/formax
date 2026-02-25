# Semantics Learning (2026-02-26): Web User Message Persistence

## Context

Web previously inserted a local optimistic `user` transcript row before the canonical turn stream arrived.
After refresh/replay, that row could disappear when canonical/replay state did not project the same user segment.

## Root Cause

User transcript ownership was split across two writers:

1. Web runtime optimistic dispatch (`push_message` + `bind_last_user_message_turn`)
2. Canonical projection/replay pipeline

This violated single-writer semantics for transcript state and made refresh behavior depend on timing.

## Canonical Fix

1. App-server `turn/started` notification now carries `input.text`.
2. Semantics adapter maps `turn/started` to canonical `user_message`.
3. Web projection no longer drops canonical `user` segments.
4. Web composer removes optimistic user insertion for normal turns.

Result: refresh/replay rebuilds the same user row from canonical events, so transcript state is stable.

## Guardrail

For cross-surface parity, treat user transcript rows as canonical/replay-owned data.
Renderer-local optimistic user rows are allowed only for explicitly local command outputs that never enter server turn stream.
