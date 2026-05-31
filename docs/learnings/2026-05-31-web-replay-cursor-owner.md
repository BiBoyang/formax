# Web Replay Cursor Owner

## Context

Web replay hydration and live stream notifications both carry sequenced metadata, but they do not share the same ordering owner. A global `lastReplaySeq` lets a high sequence observed in one stream reject valid lower sequence replay entries from another thread.

## Decision

`turnEventCursor` now requires an explicit notification owner. Live stream notifications keep global live `eventId` dedupe, global live `replaySeq` ordering, and per-trace `seq` ordering. Thread replay notifications use the requested `thread/replay` thread id as their ordering scope and do not consult the live `seenEventIds` window.

## Guardrail

Sequenced notification acceptance must run before runtime state, replay cursor, projection, cache, or refresh side effects. Rejected notifications should not advance unrelated owner state or consume an event id. Incremental replay can use a thread replay owner; from-start replay should either bypass that cursor or stage visible UI state and compression caches as one transaction.
