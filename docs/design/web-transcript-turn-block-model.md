# Web Transcript Turn Block Model

Status: design record. This document records the current Web transcript display consensus; it is not yet a canonical runtime contract.

Implementation alignment notes:

- `packages/web-reference-react/src/components/transcript/transcriptTurnBlocks.ts` derives ordered `Turn` render blocks from flat transcript rows.
- The visible inline operation row is `ToolGroup`, not the outer work summary.
- `work` / `worked` is an outer assistant-work phase concept. It must not be rendered as an extra inline row above every tool group.
- `packages/web-reference-react/src/components/tool/ToolUiBlocks.tsx` should keep heavy `ToolItem` detail blocks such as diffs/previews unmounted until the tool item is expanded.

## Purpose

The Web chat transcript should not render every raw transcript item as an isolated visual unit. The useful visual unit is closer to:

- a `Turn`, identified by `turnId`
- the user message inside that turn
- the assistant-side group inside that turn
- assistant blocks such as tool groups, optional outer work details, final answer content, and errors

This model is meant to make later UI work easier: collapsing tools, adding copy actions, and introducing new assistant block types should be handled by adding explicit block branches rather than rediscovering transcript structure in each renderer.

## Naming Decisions

- Use `Turn`, not `run`, for this project. The current project already has `turnId`, and each logical chat turn should be keyed by it.
- Use `operations` for user-facing actions such as copy. Avoid calling these a `footer`, because `turn_footer` already means turn status metadata.
- `operations` belong to `UserMessage` and `AssistantGroup`, not to the whole `Turn`.
- `TurnStatus` belongs to the `Turn` as metadata. It represents states such as completed, failed, or interrupted.
- Do not introduce `UserMessageGroup`. A turn has a `UserMessage`; grouping only matters on the assistant side.

## Conceptual Shape

```text
Transcript
└─ Turn(turnId)
   ├─ UserMessage
   │  ├─ content
   │  └─ operations
   │     └─ copy
   │
   ├─ AssistantGroup
   │  ├─ WorkPhase?              # outer assistant-work layer, for example "Worked for 6s"
   │  ├─ ToolGroup
   │  │  ├─ ToolItem
   │  │  └─ ToolItem
   │  ├─ ReasoningBlock?
   │  ├─ SystemBlock?
   │  ├─ AssistantAnswerBlock?
   │  ├─ ErrorBlock?
   │  └─ operations
   │     └─ copy
   │
   └─ TurnStatus?
      └─ completed / failed / interrupted
```

Type sketch:

```ts
type TurnBlock = {
  turnId: string;
  user?: UserMessage;
  assistant?: AssistantGroup;
  status?: TurnStatus;
};

type UserMessage = {
  content: unknown;
  operations: Operation[];
};

type AssistantGroup = {
  workPhase?: WorkPhase;
  blocks: AssistantBlock[];
  operations: Operation[];
};

type AssistantBlock =
  | ToolGroup
  | { kind: "reasoning"; content: unknown }
  | { kind: "system"; content: unknown }
  | { kind: "answer"; content: unknown }
  | { kind: "error"; scope: ErrorScope; message: string };

type WorkPhase = {
  kind: "work_phase";
  collapsedSummary: string;
  blocks: AssistantWorkBlock[];
};

type AssistantWorkBlock =
  | ToolGroup
  | { kind: "reasoning"; content: unknown }
  | { kind: "system"; content: unknown };

type ToolGroup = {
  kind: "tool_group";
  collapsedSummary: string;
  tools: ToolItem[];
};

type ToolItem = {
  kind: "tool_item";
  summary: string;
  status: "running" | "completed" | "failed";
  detail?: ToolItemDetail;
};

type ToolItemDetail =
  | { kind: "diff"; content: unknown }
  | { kind: "text"; content: unknown }
  | { kind: "json"; content: unknown };
```

The exact payload shapes should be defined when implementation starts. This document only fixes the display-level ownership and names.

## Turn Status And Live Activity

The UI may expose a richer turn status model without changing app-server, but these states must be treated as a Web-derived view model, not a new canonical event contract. The current app-server already provides enough signals for this derivation:

- `turn/start` response and `turn/started` notification identify the active `turnId`
- `turn/event` carries `assistant_delta`, `thinking_delta`, `thinking_stop`, and tool events
- canonical projection tracks open assistant and thinking segments with `openAssistantSegmentIdByTurn` and `openThinkingSegmentIdByTurn`
- tool projection tracks `ToolSegment.status`
- `turn/completed` and `turn/failed` map to `turn_footer` with `completed`, `failed`, or `interrupted`

Suggested Web-only derived status:

```ts
type DerivedTurnStatus =
  | "submitting"
  | "queued"
  | "waiting_for_assistant"
  | "streaming_text"
  | "streaming_reasoning"
  | "running_tool"
  | "completed"
  | "failed"
  | "interrupted";
```

Support without app-server changes:

- `submitting`: client-local request state before a usable turn id is known, currently represented by send/request in-flight state such as `isSendingTurn`.
- `queued`: a turn id is known and the turn is active, but no assistant-side content/tool/reasoning event has been projected yet.
- `waiting_for_assistant`: the turn is active, no assistant text segment is open, no thinking segment is open, and no tool is currently running. This covers gaps such as "tools just finished; next assistant text has not arrived yet".
- `streaming_text`: `openAssistantSegmentIdByTurn[turnId]` exists.
- `streaming_reasoning`: `openThinkingSegmentIdByTurn[turnId]` exists. This is real model reasoning content, not the loading placeholder. The current canonical/projection field is still named `thinking` for protocol compatibility, but the UI concept should be called reasoning.
- `running_tool`: any tool segment in the turn has `status: "running"`.
- `completed`, `failed`, `interrupted`: derived from the turn footer segment. Use `interrupted`, not `cancelled`, because that is the current canonical footer status.

`Thinking` as visible loading text should be modeled separately from real reasoning content:

```ts
type TurnLiveActivity =
  | { kind: "none" }
  | { kind: "waiting"; label: "Thinking" }
  | { kind: "streaming_text" }
  | { kind: "streaming_reasoning"; segmentId: string }
  | { kind: "running_tool"; label: string; toolUseId: string };
```

Rendering rules:

- The transcript should show at most one live status at a time. Streaming text, streaming reasoning, and running tool rows already prove the turn is active, so they should suppress extra `Thinking` placeholders.
- During `submitting`, the UI may create a local pending user row so the submitted prompt is visible before `turn/started` arrives. For normal server turns, that row must carry `clientMessageId`; app-server echoes it on `turn/started.input.clientMessageId`, and the canonical `user_message` projection replaces the pending row. Local rows without a canonical handoff remain reserved for local command outputs that do not enter the server turn stream.
- `submitting`, `queued`, and `waiting_for_assistant` may render the same `Thinking` loading row, but they are different diagnostic states.
- `streaming_text` should not render an extra `Thinking` row because visible text streaming is already the loading feedback.
- `streaming_reasoning` should render as a `ReasoningBlock`; it must not be confused with the `Thinking` loading placeholder.
- `ReasoningBlock` should follow assistant text rendering semantics, but with subdued visual tone and an explicit collapsible header.
- `running_tool` should prefer showing the current running tool item display text in the current `ToolGroup` header when the group is collapsed; this text should match the visible running `ToolItem` text when expanded.
- if the active turn is waiting and the last assistant block is a `ToolGroup`, the `ToolGroup` header may temporarily show `Thinking`; when the turn completes, the header returns to the stable group summary.
- if the active turn is waiting and there is no `ToolGroup` header to host the activity, render a standalone activity row with the same visual treatment.

This status model is enough for the current UI discussion without app-server changes. A future app-server-owned lifecycle status would require a canonical contract change, but that is not necessary for the collapse/loading behavior described here.

## Pending Turn Runtime

Web pending sends are a runtime/display concern, not durable transcript truth. A submitted user prompt that has not yet been handed off to canonical projection should live in `AppState.pendingTurns`, then be composed into the rendered transcript by the Web selector. It must not be inserted into `logs` as an ordinary optimistic transcript item on the normal server-turn path.

The pending turn runtime has three separate identities:

- `requestId`: ownership guard for rollback. A failed request may only roll back the pending turn it created.
- `clientMessageId`: stable handoff key between Web submit, `turn/start`, `turn/started.input.clientMessageId`, and canonical `user_message`.
- `turnId`: canonical server identity, known only after `turn/start` or `turn/started`.

Rendering rules:

- The first visible frame after send should be one `TurnBlock` containing the pending user message and the derived `Thinking` activity row.
- The visual block key should prefer `clientMessageId` so pending-to-canonical handoff does not remount the whole block when `turnId` becomes known.
- On draft first send, `thread/start` materializes the owner thread for the existing pending turn; it should not pass pending user rows through thread activation `fallbackLogs`.
- HTTP `turn/start` responses and live `turn/started` notifications both commit the same pending turn. The commit path must be idempotent.
- Canonical `user_message` with the same `clientMessageId` removes the pending display row. Until that canonical event arrives, the pending row is only a visual placeholder.
- Rollback must match `requestId + clientMessageId` and may clear `activeTurnId` only if it still points at that pending or committed turn.
- Terminal notifications should clear active turn state only when the terminal `turnId` matches the current active turn. They must not clear the active turn for another thread or a newer in-flight send.

## Reasoning Block

Use `reasoning` for real model reasoning content in product/UI language. The current lower-level protocol and projection names still use `thinking` (`thinking_delta`, `thinking_stop`, `kind: "thinking"`) for compatibility; the Web display model should map those items to `ReasoningBlock`.

Locked display decisions:

- running reasoning should be expanded by default because the user needs to see the active reasoning stream when it is the current output.
- finalized reasoning should be collapsed by default so historical reasoning does not inflate long transcripts.
- reasoning should use the same content-rendering foundation as ordinary assistant text, but with a visually weaker treatment.
- reasoning must stay ordered with assistant text and tool groups exactly as events arrive; do not collect all reasoning into a separate bucket.
- reasoning is transcript content, but it is not final assistant answer content.
- reasoning must not be confused with `Thinking` loading. `Thinking` loading is a derived live activity placeholder for waiting states; reasoning is real streamed content.

## Tool Grouping

Consecutive tool calls within the same `turnId` should be grouped into a `ToolGroup`. The `ToolGroup` row is the visible inline collapsible row, for example:

- `Loaded 3 tools`
- `Read a file`
- `Read 4 files and ran 4 commands`

Even a single tool call should render through the same one-item `ToolGroup` path. This keeps collapsed/expanded behavior consistent and avoids a separate `ToolItemBlock` branch.

Correct inline shape:

```text
ToolGroup(collapsed: "Read a file")
└─ ToolItem(summary: "Read TranscriptPane.tsx")
```

Incorrect inline shape:

```text
WorkPhase(collapsed: "Worked with 1 tool")
└─ ToolGroup(collapsed: "Read a file")
   └─ ToolItem(summary: "Read TranscriptPane.tsx")
```

The `WorkPhase` / `worked` concept belongs to an outer assistant-work layer. It is not the row that summarizes a local group of tool calls.

If a UI mode renders `WorkPhase`, it should wrap or replace the work-phase details for that mode. It must not create a duplicate stack where `Worked with N tools` appears as an extra inline row directly above a `ToolGroup` summary for the same tools.

There are three collapse levels:

- `WorkPhase.collapsedSummary` summarizes the whole assistant work phase, for example "Worked for 6s". This is the outer layer and may be implemented separately.
- `ToolGroup.collapsedSummary` summarizes one consecutive tool group in the transcript, for example "Read 4 files and searched code".
- `ToolItem.detail` is the per-tool expandable detail, for example an edit tool can expand to show a diff.
- `ToolItem` collapsibility is policy-driven, not hard-coded in the group renderer. The Web implementation keeps this policy centralized in `packages/web-reference-react/src/components/tool/toolItemExpansionPolicy.ts`.

Expanded `ToolGroup` shape:

```text
AssistantGroup
├─ ToolGroup(collapsed: "Read 4 files and searched code")
│  ├─ ToolItem(summary: "Read file")
│  └─ ToolItem(summary: "Edited file")
│     └─ detail(collapsed/expanded: diff)
├─ ReasoningBlock?
└─ AssistantAnswerBlock
```

Grouping boundaries:

- an assistant answer/text item breaks the current tool group
- a reasoning/thinking item breaks the current tool group
- a system item breaks the current tool group
- a new `turnId` always starts a new turn and therefore a new grouping context

The collapsed tool group summary can describe the operations at a higher level, for example "Read 4 files and searched code". The expanded tool group state can show individual `ToolItem` rows. Each `ToolItem` may also expose its own collapsed detail. For example, an edit/write tool item can show a short row by default and expand into a diff; a read/search tool item may expand into matched paths or preview text.

Tool group live header policy:

```ts
type ToolGroupHeader =
  | { kind: "live_tool_item_text"; text: string; shimmer: true }
  | { kind: "waiting"; text: "Thinking"; shimmer: true }
  | { kind: "stable_group_summary"; text: string; shimmer: false };
```

- If the group contains a running tool, the header text should be the current running `ToolItem` display text, not the completed group summary. Example flow: `Running whoami` -> `Running date`.
- If all tools in the latest group have completed but the turn is still active and no next reasoning/text/tool block has arrived, the header temporarily shows `Thinking` with shimmer.
- Once the next reasoning/text/tool block arrives, or once the turn reaches a terminal footer, that tool group is no longer the live status carrier and its header returns to the stable group summary, for example `Ran 2 commands`.
- The `ToolGroup` header owns an icon slot before the label and an optional chevron after the label. Keep the icon slot present across collapsed, expanded, running, waiting, and completed states so the label does not shift horizontally.
- `ToolItem` rows do not use the `ToolGroup` icon slot. They may show their own running shimmer/status, but completed and failed tool items should not shimmer.
- Assistant text, reasoning headers, `ToolGroup` headers, and `ToolItem` rows should share one left edge inside an assistant group. Avoid row-level left padding on one of these rows unless the same offset is applied deliberately to the whole assistant content column.
- Reasoning headers should not use a hover background fill; keep the row visually quiet and rely on the chevron/focus ring for interaction affordance.
- When the group is collapsed, the live status belongs on the `ToolGroup` header because child `ToolItem` rows are hidden.
- When the group is expanded, a running tool may show shimmer on the running `ToolItem`; completed sibling tool items must remain stable. During the waiting gap after tools finish, `Thinking` shimmer belongs on the `ToolGroup` header because no `ToolItem` is currently running.

Tool item expansion policy:

- Ordinary `ToolItem` collapsed/header rows should be low-emphasis transcript metadata: muted text, no completed status dot, no bold title, and no hover background fill.
- The text after the tool name should identify the concrete operation target or parameter, not a natural-language description/summary. For `Bash`, show the command text rather than the optional command description.
- A running ordinary `ToolItem` may use the same shimmer treatment as the `ToolGroup` live header. Completed and failed items must not shimmer; failed rows may use a subtle red text treatment.
- `inputState` should not add a separate dot or `approval:*` / `question:*` badge to ordinary `ToolItem` rows. Pending interaction is represented by the active dock and the normal running/loading treatment.
- `TodoWrite` is intentionally excluded from the ordinary low-emphasis rule for now and may keep its existing structured/todo-specific presentation until that tool is redesigned separately.
- Plain tool items do not expose their own chevron/details. Current examples: `Read`, `Skill`, `ToolSearch`, `Glob`, `Grep`, and `LS`.
- `Glob` is a locked one-row plain item for now: do not render derived result rows such as `Found N files`, and do not list matched paths in the collapsed or expanded group view.
- Expandable tool items show only their header row by default and mount details after expansion. Current examples: `Bash`, `Edit`, `MultiEdit`, `Write`, `Task`, `WebFetch`, and `WebSearch`.
- Unknown tools and MCP tools default to expandable when they have details, so large or unfamiliar payloads do not inflate the transcript by default.
- Tool item details should stay left-aligned with the tool row and should not add an extra left rail/vertical rule. Detail content may still use its own internal framing, for example command output boxes or diff panels.
- Changing whether a tool item is plain or expandable should normally be a policy-table edit, not a renderer rewrite.

## Work And Final Answer

Codex-style chat UI separates assistant work details from the final visible assistant answer:

```text
AssistantGroup
├─ WorkPhase(collapsed: "Worked for 6s")
└─ AssistantAnswerBlock
```

Formax should support the same display model at the UI projection layer:

- `WorkPhase` is the outer assistant-work concept. It can summarize elapsed work or a full work phase, but it is not the inline `ToolGroup` summary row.
- `ToolGroup` owns the visible inline tool operation group, including the single-tool case.
- `ToolItem` owns per-tool details such as command output, previews, or diffs.
- `AssistantAnswerBlock` owns the user-visible final assistant text for the turn.
- Collapsing a future outer `WorkPhase` must not hide `AssistantAnswerBlock`.
- Turns without tools or reasoning may have only `AssistantAnswerBlock`.
- Turns that fail before producing an answer may show `ErrorBlock` in the answer position.
- Closing an `AskUserQuestion` dock is a cancel action, not a visual-only collapse. In the current Web implementation this maps to interrupting the input's owning turn so the pending input resolves as `canceled`.
- `AssistantGroup.blocks` must remain ordered. If assistant text and work items are interleaved, the UI projection should preserve that order instead of collecting all work into one bucket and all assistant text into another bucket. This can produce more than one `ToolGroup` in one assistant group.

This is a UI projection rule, not a prompt requirement. Formax does not currently plan to change the system prompt to force a Codex-style final summary. The renderer must therefore not infer `AssistantAnswerBlock` by checking whether the text "looks like a summary"; it should use transcript event order and event kinds. The final assistant text emitted after the work loop is the answer block, even if it is short or not summary-like.

## Rendering Performance

Collapse state is also a performance boundary, not only a visual preference. Long conversations can contain many tool calls, large command outputs, file previews, and diffs. Collapsed content should avoid rendering heavy DOM until it is expanded.

Implementation guidance:

- A collapsed `ToolGroup` should render only its group summary and avoid mounting child `ToolItem` rows/details.
- A collapsed `ToolItem` should render only its short row and avoid mounting large detail DOM such as diffs, command output, JSON, or file previews.
- If a future outer `WorkPhase` collapse is implemented, it should also be a lazy-mount boundary for the work-phase contents.
- Do not implement collapse as CSS-only hiding for heavy content; hidden-but-mounted DOM still pays render, layout, memory, and search costs.
- Expansion can mount details lazily, and closing can unmount them unless preserving local state is explicitly required.
- The selector should keep enough lightweight summary data available so collapsed rows do not need to build their summaries by rendering hidden children.

## Operations

`operations` are action controls attached to a visible message unit.

Current expected operations:

- `UserMessage.operations`: copy the user message
- `AssistantGroup.operations`: copy the assistant response group

The operation row/control is independent from `TurnStatus`. This matters because both the user side and assistant side can have copy actions, while a turn only has one status.

Copy payload guidance:

- user copy should copy the raw user message text
- assistant group copy should copy assistant answer text, preserving ordered assistant answer segments with blank lines between segments
- reasoning should not be included in assistant group copy payloads
- work/tool summaries should not be silently mixed into the answer copy payload unless the UI later exposes a distinct "copy work details" operation

## Errors

Request or network failures that happen around a user send should render as an assistant-side error block, not as ordinary assistant markdown. In the current Web implementation, the app-server request failure enters the renderer as `lastRpcError` and is presented with the shared `TranscriptErrorBlock`.

Expected behavior:

- show a short, high-legibility error summary inline with the transcript surface
- expose details behind a collapsed control
- keep serialized error payload/details unmounted until expanded
- preserve regular turn status rendering for `turn_footer` states such as failed or interrupted
- do not infer an answer block from error text

## Relation To Current Transcript Items

Current Web transcript projection still works with item kinds such as `message`, `tool_call`, `thinking`, and `turn_footer`. The proposed model should be derived by a pure selector/projection layer before rendering.

Suggested mapping:

- user `message` items become `Turn.user`
- pending send runtime in `AppState.pendingTurns` is composed as a temporary user message before canonical handoff; it is not a raw transcript item source
- assistant text emitted as the final user-visible response becomes `AssistantBlock(kind: "answer")`
- consecutive `tool_call` items become `AssistantBlock(kind: "tool_group")`
- a single `tool_call` item still becomes a one-item `ToolGroup`
- `thinking` transcript items become `AssistantBlock(kind: "reasoning")` at the UI model layer. The source item name remains `thinking` until the canonical protocol is renamed.
- work/system progress items become `AssistantBlock(kind: "system")`
- outer `work` / `worked` summaries, if available in the event stream, become `AssistantGroup.workPhase`; they should not be synthesized only to display a tool count above a `ToolGroup`
- request-level failures before a final answer become `AssistantBlock(kind: "error")`
- `turn_footer` items become `Turn.status`, not a rendered message action footer

This keeps the raw transcript protocol separate from the Web display plan.

If the current raw projection only exposes assistant text as generic message items, the selector should use stable event ordering rather than text content to decide whether that message is the final answer.

## Reference Project Takeaways

The external chat-shell reference is useful mainly for the separation of concerns:

- build normalized transcript blocks first
- render message units from those blocks
- attach actions to user and assistant message units separately

Formax should not copy the reference model exactly. The main difference is that Formax already has explicit `turnId`, so the Web model can use an explicit `TurnBlock` instead of relying only on a flat `user-message` / `assistant-turn` list.

## Non-Goals

- This document does not decide final visual styling, spacing, colors, or icons.
- This document does not change canonical runtime semantics.
- This document does not require changing the system prompt to force final summaries.
- This document does not define the final copy payload for assistant groups.
- This document does not require all tools to have custom renderers before grouping exists.

## Open Decisions

- Exact copy semantics for `AssistantGroup`: visible answer text only, visible assistant content plus work summaries, or full raw block content.
- Running and failed work/tool groups: whether they use a distinct summary format or only an icon/status treatment.
- Fallback behavior for legacy or partial transcript items with missing `turnId`.
- Exact behavior and trigger for a future outer `WorkPhase` collapse.
- Exact `ErrorBlock` shape and retry operations for request/network failures.

## Suggested Implementation Direction

When this moves from design to implementation:

1. Add a pure selector that converts `TranscriptItem[]` into `TurnBlock[]`.
2. Add focused tests for turn boundaries, interrupted turns, consecutive tools, and tool grouping breaks.
3. Add tests proving `ToolGroup` collapse does not hide `AssistantAnswerBlock`.
4. Update the Web renderer to render `TurnBlock` units.
5. Add `operations` controls to `UserMessage` and `AssistantGroup`.
6. Treat the future outer `WorkPhase` collapse, visual polish, and collapse animation as later passes.
