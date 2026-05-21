# Claude Code Cache Editing Microcompact TODO

日期：2026-05-21

目标：在明确 Formax 当前对接 Anthropic / Claude Code first-party 语义的前提下，引入 Claude Code 风格的 cached microcompact：本地 persisted transcript 不改写旧 `tool_result`，而是在 Anthropic request API 层通过 `cache_reference` / `cache_edits` 删除已缓存 prefix 中的低价值 tool result，并保留当前 stub microcompact 作为非 cache-editing fallback。

## Decision Snapshot

- [x] 采用 Claude Code 的核心语义：cached microcompact 不修改本地 messages，只在 request/API layer 生效。
- [x] `cache_control` 仍然是公开 prompt caching 主路径。
- [x] `cache_reference` / `cache_edits` 视为 Anthropic cache editing beta 能力，不作为通用 provider 协议。
- [x] 第一阶段目标限定为 Anthropic first-party / main-thread turn；SDK、subagent、第三方兼容 base URL 先走现有 stub fallback，除非显式扩展。
- [x] 保持 `microcompact` request-time 语义；不得把 cache editing delete 结果写回 persisted history。

## Batch 0: Contract And Tests First

目的：先把边界写进合同和测试，避免实现时把 request-only side-channel 误做成 persisted history mutation。

### Tests First

- [x] Add context test: cache-editing mode returns unchanged message content plus a cache edit plan.
- [x] Add context test: fallback/stub mode preserves current microcompact replacement behavior.
- [x] Add middle-layer test: cache edit plan is request-only and `persistedHistoryCandidate` remains original history.
- [x] Add Anthropic payload test fixture shape before implementation: `cache_reference` appears on eligible cached-prefix `tool_result` blocks.
- [x] Add Anthropic payload test fixture shape before implementation: `cache_edits` block is inserted into a user message content array.

### Implementation

- [x] Update `docs/contracts/context-strategy-stack-contract.md` to document request-envelope side-effect plans for cache editing.
- [x] Add minimal type surface for a cache-editing plan without changing runtime behavior yet.
- [x] Keep current `microcompact` facts stable; add cache-editing-specific impact fields only if tests need them.

### Validation

- [x] `bun run test -- packages/core/src/chat/context/microCompact.test.ts packages/core/src/chat/context/middleLayerStrategyStack.test.ts`
- [x] `bun run test -- packages/core/src/streaming/anthropic/StreamClient.test.ts`

## Batch 1: Context Cache Edit Plan

目的：让 context layer 能在 cache-editing mode 下产出 Claude Code 风格 delete plan，同时不改写 message content。

### Tests First

- [x] Add tool-result collection test: only compactable tool results receive delete candidates.
- [x] Add recency test: recent tool results are kept and older candidates enter delete plan.
- [ ] Add duplicate test: same `tool_use_id` is not deleted twice in the context planner.
- [x] Add time-aware test: current user-turn stale logic remains covered; Claude Code wall-clock assistant-gap is explicitly deferred.

### Implementation

- [x] Introduce cache-editing policy gate in context layer.
- [x] Return `cacheEditPlan` alongside unchanged messages when cache editing is enabled.
- [x] Preserve existing stub path when cache editing is disabled.
- [x] Keep tool eligibility conservative: start from current `Read` / `Grep` / `Glob` / safe `WebFetch` coverage unless Claude Code parity requires a narrower set.
- [x] Add structured diagnostics/facts only for fields needed to debug whether cache editing was planned, skipped, or fallbacked.

### Validation

- [x] `bun run test -- packages/core/src/chat/context/microCompact.test.ts packages/core/src/chat/context/middleLayerStrategyStack.test.ts packages/core/src/chat/context/contextDiagnostics.test.ts`

## Batch 2: Anthropic Request Projection

目的：把 context 层的 cache edit plan 应用到 Anthropic `/messages` request payload，而不是写回 local history。

### Tests First

- [x] Add payload test: `cache_reference` is cloned onto tool_result blocks without mutating original messages.
- [x] Add payload test: `cache_edits` block is inserted after existing tool_result blocks in the selected user message.
- [x] Add payload test: placement stays before the last `cache_control` boundary required by Anthropic prompt caching layout.
- [x] Add payload test: duplicated delete refs are deduped across request blocks.
- [x] Add payload test: when cache editing is disabled, request payload contains no `cache_reference` / `cache_edits`.
- [x] Add fallback test: retry without beta headers must not resend beta-only cache editing blocks.

### Implementation

- [x] Add Anthropic-only payload transform for `cache_reference` / `cache_edits`.
- [x] Extend local Anthropic request block typings to allow `cache_edits` and `cache_reference`.
- [x] Add Anthropic cache editing beta header behind an explicit capability/config gate using the Claude Code-aligned `CACHE_EDITING_BETA_HEADER` name.
- [x] Ensure prompt caching normalization and cache editing transform have a deterministic order.
- [x] Ensure retry/fallback paths strip cache editing payload when beta support is removed.

### Validation

- [x] `bun run test -- packages/core/src/streaming/anthropic/StreamClient.test.ts`
- [x] `bun run test -- packages/core/src/streaming/anthropic/sseParser.test.ts`

## Batch 3: Session-Scoped State And Reset Boundaries

目的：防止 pending/pinned cache edits 在 session、resume、clear、compact、subagent、SDK query 之间泄漏。

### Tests First

- [x] Add main-thread test: pending cache edit plan is consumed only by the matching request.
- [x] Add reset test: `/clear` clears cache editing state. Not applicable after review: no session/global pending state is stored.
- [x] Add compact test: manual `/compact` clears or rebases cache editing state. Not applicable after review: no session/global pending state is stored.
- [x] Add resume test: resumed sessions do not reuse stale in-memory cache edit refs unless a persisted design is explicitly added. Not applicable after review: plans are request-local only.
- [x] Add subagent/SDK test: non-main-thread query does not send cache editing body by default.

### Implementation

- [x] Decide and implement owner for session-scoped cache editing state; avoid storing it as process-global Anthropic client state. Decision: no session-scoped state; plans are request-local and consumed by the first model call.
- [x] Wire reset hooks for `/clear`, `/compact`, and session transition boundaries. Not needed because no resettable cache-editing state exists.
- [ ] Keep app-server and TUI behavior aligned through shared request projection rather than UI-specific wiring.

### Validation

- [ ] `bun run test -- packages/core/src/features/repl/controller/send packages/core/src/features/repl/controller/session`
- [ ] `bun run test -- packages/core/src/sdk/query.test.ts packages/core/src/sdk/sessions.test.ts`

## Batch 4: Usage Accounting And Diagnostics

目的：让 cache editing 的效果可观察，避免只发送 request body 但 usage/debug 信息缺失。

### Tests First

- [x] Add SSE parser test for `cache_deleted_input_tokens`.
- [x] Add accumulated usage test if stream deltas report cache-deleted tokens in multiple events.
- [ ] Add diagnostics test showing cache editing applied/skipped reason when available.

### Implementation

- [x] Parse `cache_deleted_input_tokens` from Anthropic usage payloads.
- [ ] Extend usage display/diagnostics surfaces without folding `cache_deleted_input_tokens` into consumed-token totals.
- [x] Add a learning note documenting the final cache editing boundary and fallback behavior.

### Validation

- [x] `bun run test -- packages/core/src/streaming/anthropic/sseParser.test.ts packages/core/src/features/repl/controller/shared/utils.test.ts packages/core/src/chat/context/contextDiagnostics.test.ts`

## Batch 5: End-To-End Guard And Review

目的：收口完整链路，保证旧路径不回归，新路径只在明确能力范围内启用。

### Validation

- [x] `bun run test -- packages/core/src/chat/context packages/core/src/streaming/anthropic`
- [x] `bun run test -- packages/core/src/features/repl/controller/send packages/core/src/features/repl/controller/session`
- [ ] `bun run test -- packages/core/src/sdk/query.test.ts packages/core/src/sdk/sessions.test.ts packages/core/src/sdk/v2.test.ts`
- [x] `bun run test:repl-semantic-gate`
- [x] `mkdir -p .tmp/codex-review-result`
- [x] `codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high" > .tmp/codex-review-result/review-latest.txt 2>&1`
- [x] Inspect `.tmp/codex-review-result/review-latest.txt` and fix all high/medium findings.

## Open Questions

- [ ] 是否要第一版就切到 Claude Code 的 wall-clock assistant-gap time-aware 策略，还是先只接 cache editing side-channel，保留当前 user-turn stale 策略？
- [x] Anthropic cache editing beta header 名称按 Claude Code 对齐为 `CACHE_EDITING_BETA_HEADER`；真实 API smoke 只作为后续可选验证，不阻塞客户端 parity 实现。
- [ ] app-server main-thread 是否在第一版跟 TUI 同步启用，还是先只启用 TUI REPL 主线程？
- [ ] 是否需要新增用户可见 config，还是先通过 env/internal capability gate 控制？

## Commit Strategy

建议拆成 4-5 个小 commit：

1. `test(context): define cache editing microcompact contract`
2. `feat(context): plan anthropic cache edit deletes`
3. `feat(anthropic): project cache edits into request payload`
4. `fix(session): scope cache editing state to turn lifecycle`
5. `feat(context): surface cache deleted usage diagnostics`
