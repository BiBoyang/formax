# Fixtures Checklist (TUI/Web Semantic Parity)

Use this checklist whenever a change touches mode, input lifecycle, tool sequencing, ordering, replay/gap recovery, or canonical adapters.

## How to use

1. Pick the affected scenarios from this list.
2. Add/update fixtures in semantic tests first.
3. Run parity tests (same fixture through Web adapter and TUI adapter).
4. Run app-server + web gates listed in `SKILL.md`.
5. Only then change renderer details.

## Required scenarios

### S1 Assistant segmentation order
- Fixture: `assistant_delta -> assistant_delta -> tool_start -> tool_end -> assistant_delta` in one turn.
- Assert:
  - Output is `assistant segment #1`, then `tool segment`, then `assistant segment #2`.
  - No assistant delta is appended into an already-closed segment.

### S2 Thinking and assistant boundary
- Fixture: `thinking_delta -> thinking_delta -> assistant_delta -> thinking_end` with mixed order.
- Assert:
  - Thinking and assistant are separate segments.
  - Late thinking updates do not corrupt assistant segment.

### S3 Tool name stickiness
- Fixture: `tool_start(name=Bash,useId=x) -> tool_update(no name,useId=x) -> tool_end(no name,useId=x)`.
- Assert:
  - All tool records for `useId=x` resolve to `Bash`.
  - UI never degrades to generic `Tool (...)` for this sequence.

### S4 Missing toolUseId fallback
- Fixture: historical tool rows without `toolUseId`.
- Assert:
  - Records stay renderable as independent tool rows.
  - No cross-row sticky merge is attempted.

### S5 Mode transition semantics
- Fixture: `turn/started(mode=normal) -> turn/modeChanged(mode=plan) -> next turn/start`.
- Assert:
  - Next request mode follows transition result (`plan`).
  - No stale previous thread mode leakage.

### S6 Input lifecycle closure
- Fixture: `inputRequested(pending) -> inputResolved(submitted|expired|canceled|failed)`.
- Assert:
  - Every pending input reaches one terminal state.
  - Resolved input is not re-accepted as pending.

### S7 Ask-vs-approval separation
- Fixture: one `ask_user_question` and one `approval` in same thread.
- Assert:
  - Ask pagination state and approval state do not leak into each other.
  - Status badges map from semantic status only.

### S8 ReplaySeq ordering dominance
- Fixture: out-of-order notifications with valid `replaySeq` ordering.
- Assert:
  - Final transcript follows `replaySeq`, not arrival order.
  - `traceId/seq` are kept for diagnostics only.

### S9 Duplicate event idempotency
- Fixture: duplicate canonical event (same event identity) replayed twice.
- Assert:
  - Transcript projection is unchanged after second apply.
  - No duplicate rows are emitted.

### S10 Gap recovery semantics
- Fixture: replay response with `hasGap=true` and baseline rebuild path.
- Assert:
  - Client rebuilds from baseline/snapshot instead of stitching stale tail.
  - Rebuilt output equals full contiguous replay output.

### S11 Thread switch isolation
- Fixture: switch from thread A to thread B during hydration.
- Assert:
  - A’s mode/segments/tools do not leak into B.
  - B starts from its own replay state/snapshot.

### S12 Cross-surface parity
- Fixture: one shared canonical fixture set through both adapters.
- Assert:
  - TUI and Web semantic outputs match in segment order and state transitions.
  - Renderer-only differences are excluded from this assertion.

## Optional scenarios (when relevant)

- Binary/untracked/symlink diff metadata behavior.
- Tool input state annotations on timeline rows.
- Commander command output mapping into system/tool transcript rows.

## Recommended test files

- `packages/core/src/features/semantics/__tests__/projectionParity.test.ts`
- `packages/core/src/features/semantics/*.test.ts`
- `packages/core/src/app-server/turnRunner.test.ts`
- `packages/core/src/app-server/server.test.ts`
- `packages/web-reference-react/src/App.test.tsx`
- `packages/web-reference-react/src/store.test.ts`
- `packages/web-reference-react/src/turnEventCursor.test.ts`

