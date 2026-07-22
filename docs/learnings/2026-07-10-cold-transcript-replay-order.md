# Cold Transcript Replay Must Persist Semantic Order

## Observation

Realtime app-server notifications preserve `assistant -> tool -> assistant` because canonical projection consumes sequenced events and closes the current assistant segment at each tool boundary.

The legacy cold history path cannot guarantee that order. Tool events are persisted when they occur, while the stable assistant UI row is written once at turn completion. Sorting those rows by timestamp therefore produces `tools -> combined assistant`, even though every individual timestamp is correct.

## Decision

Persist a terminal per-turn canonical projection snapshot in session JSONL and use it as the first cold replay baseline. The snapshot owns UI transcript order only; prompt/model history remains independently owned by `history_state` and context projection.

Cold baselines reset `lastReplaySeq` to `0`. A restarted app-server owns a fresh live replay sequence, so retaining an old process cursor would cause valid new events to be rejected.

The reset must cover more than the transcript projector. When a retained client `after` cursor is above the restarted server's `latestCursor`, a returned projection baseline is the authoritative epoch-reset signal: the Web adapter hydrates it, lowers the replay cursor, and resets both replay and live notification gates. Cursor regression without a projection is not sufficient evidence because a stale replay response must not overwrite newer live runtime state.

Connection initialization is the authoritative boundary for threads without snapshots: it performs a staged full replay, allowing the legacy history fallback to establish a fresh cursor without guessing from cursor values alone.

## Compatibility

Sessions without a valid snapshot continue through `thread/messages`. Compatibility data remains readable, but missing semantic boundaries are not reconstructed from UI copy or timestamp guesses.

Canonical rules live in:

- `docs/contracts/semantics-contract.md`
- `docs/contracts/session-persistence-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
- `docs/contracts/web-parity-adapter-contract.md`
