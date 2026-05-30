# CCA-180 Deferred-Task Restore Utility Continuation / v8 Todo

日期：2026-05-30

当前执行入口只看这个文件。旧 WebGPT bugfix todolist 已完成并进入 Git 历史；本文件接续
`CCA-180-DEFERRED-TASK-RESTORE-UTILITY-TODO-2026-05-21.md`，只推进 restore continuity hints 的下一段。

## 0. Context and Boundary

### 0.1 Confirmed Facts

- [x] `CCA-180` v7 Batch 1 / Batch 2 已完成，提交为 `a7a399ad feat(context): add deferred restore hints`。
- [x] WebGPT/cache-editing/context-compression architecture parity 主线已收口，可以恢复 `CCA-180` 方向。
- [x] 两轮 WebGPT 复核都收敛到同一结论：下一条稍长主线应是 `CCA-180 continuation / v8`。
- [x] v8 的核心问题不是 runtime resume，而是 restore continuity hints 的可靠性、结构化、diagnostics 和跨端兼容。
- [x] 当前 `recentDeferredToolNames` 仍需要强化：优先从 structured `tool_reference` blocks 提取，保留 legacy text fallback。
- [x] 当前 `recentTaskHints: string[]` 仍需要强化：新增 additive structured task hints，同时保留 legacy 字符串数组。
- [x] `pendingSessionMemoryRestore` 需要可观察 diagnostics，但不能变成 persisted authority。

### 0.2 Goals

- [x] 将 deferred tool restore hints 从文本 section 解析推进到 structured `tool_reference` first。
- [x] 为 delegated/background task continuity 增加 bounded structured hints。
- [x] 为 pending restore utility 增加 source/confidence/status 级别 diagnostics。
- [x] 保持 Web/RPC 对 v7 flat payload 和 v8 optional structured payload 的兼容。
- [x] 改善 next-turn system reminder 文案，让 hints 不被误读为 restored state。
- [x] 增加 no-new-authority regression guards，防止 restore hints 反向变成 runtime rehydration。

### 0.3 Non-goals

- [x] 不 rehydrate `DeferredToolExposureStore.loadedNames`。
- [x] 不自动恢复 background tasks / delegated tasks。
- [x] 不启动 polling、task registry、remote session reconnect 或 local async agent resume。
- [x] 不改写 persisted transcript。
- [x] 不新增 compact / replay / projection authority。
- [x] 不把 request-only hints 升级为 durable state。
- [x] 不让 Web/app-server/parser 自行扫描 transcript 组装第二套 restore utility。
- [x] 不在 v8 处理 `CCA-181` preserved-segment relink parity。
- [x] 不在 v8 处理 `CCA-182` reactive compact shaping / media overflow classification / telemetry。
- [x] 不在 v8 处理 durable tool-result replacement summary surface；该项保留为独立 projection-surface follow-up。
- [x] 不实现 Claude Code-style full background task resume。

## 1. Definitions First

### 1.1 Canonical Docs

- [x] 检查 `docs/contracts/session-persistence-contract.md` 是否需要补充 v8 structured restore hint 语义。
- [x] 检查 `docs/contracts/prompt-tool-exposure-contract.md` 是否需要补充 `tool_reference` restore hints 不等于 loaded tools。
- [x] 检查 `docs/contracts/app-server-interaction-contract.md` 是否需要补充 pending restore diagnostics。
- [x] 检查 `docs/contracts/web-parity-adapter-contract.md` 是否需要补充 v7/v8 parser compatibility。
- [x] 若 v8 只改变既有字段的 additive optional shape，优先更新现有 canonical docs，不新增平行设计文档。

### 1.2 Data Model

- [x] 保留 `recentDeferredToolNames: string[]` public shape。
- [x] 新增 bounded structured task hint field，同时保留 `recentTaskHints: string[]`。
- [x] structured task hint field is additive and transcript-derived only。
- [x] 结构化 task hint 使用弱 runtime 语义字段名，至少表达：
  - [x] `subagentType`
  - [x] `description`
  - [x] `runInBackgroundRequested`
  - [x] `resumeHint` / `resumeSignal` / `resumeReference`，仅表示 prior Task input 中出现过 resume signal，不表示 runtime resume。
  - [x] `lastObservedStatus` / `outcome`，仅表示 transcript-derived observation，不表示 task registry 当前状态。
  - [x] `lastSummary` if derivable from bounded transcript content
  - [x] `evidenceSource`
  - [x] `evidenceConfidence`
- [x] `restoreDiagnostics.source/confidence/status` 只描述 whole pending restore artifact；per-task evidence 使用 `evidenceSource/evidenceConfidence`。
- [x] v8 public task continuity hints 默认只采集 successful Task calls。
- [x] failed/error Task calls 只做 characterization 和 excluded guard，不进入 reminder-rendered task continuity hints；未来若需要暴露失败任务，另开 diagnostics-only 字段。
- [x] 新增 restore diagnostics optional field，表达 pending/source/confidence/status。
- [x] 明确 consumed state 仍通过 `pendingSessionMemoryRestore: null` 表达，不新增 persisted consumed event。
- [x] 对所有新字符串字段设置 list length / per-field length / delimiter sanitization bounds。

### 1.3 Types / Interfaces

- [x] 更新 core restore summary / session-memory draft types。
- [x] 更新 app-server response types，只增加 optional v8 fields。
- [x] 更新 Web RPC contracts/parsers，old v7 payload 必须继续 parse。
- [x] 对 malformed optional v8 fields 使用 unavailable/omit/null 的既有三态策略，不 reject 整个 response。
- [x] 保持 explicit `null` 与 omitted 的语义差异。

## 2. Runtime / Platform

### 2.1 Session Memory Restore Assembly

- [x] 优先从 successful ToolSearch result 的 structured `tool_reference` blocks 派生 `recentDeferredToolNames`。
- [x] 保留 old sessions 的 legacy text-section fallback。
- [x] 忽略 failed ToolSearch result。
- [x] 保持 bounded / dedupe / newest-first 语义。
- [x] 从 successful Task calls 派生 bounded structured task hints。
- [x] Characterize failed Task calls and exclude them from public v8 continuity hints。
- [x] 不得把 failed/error Task calls 渲染成可恢复任务。

### 2.2 Restore Reminder Rendering

- [x] 将 structured task hints 渲染为 next-turn-only restore continuity hints。
- [x] deferred tool wording 必须明确：这是 prior successful ToolSearch hints，不是 loaded tools。
- [x] background task wording 必须明确：没有自动恢复、没有启动 polling。
- [x] 保留 delimiter sanitization 和 text size bounds。
- [x] 保持 reminder injected blocks ephemeral，不写回 persisted history。

### 2.3 App-Server Restore Surface

- [x] `thread/resume` 暴露 pending restore diagnostics。
- [x] pre-consumption `thread/replay` 与 `thread/resume` 看到同一 pending restore facts。
- [x] successful dispatch 消费 pending restore 后，后续 replay/resume 返回 `pendingSessionMemoryRestore: null`。
- [x] pre-dispatch failure 后仍保留 pending restore。
- [x] diagnostics 不成为 replay authority，不写入 raw transcript rows。

### 2.4 No-New-Authority Guardrails

- [x] restore hints 不 mutate `DeferredToolExposureStore.loadedNames`。
- [x] restore hints 不 register/resume background tasks。
- [x] restore hints 不触发 task polling。
- [x] restore hints 不进入 durable projection state。
- [x] restore reminder injected block 不写回 persisted history。

## 3. Frontend Boundary

- [x] Web RPC parser 接受 old v7 flat restore payload。
- [x] Web RPC parser 接受 new v8 structured task hints 和 diagnostics。
- [x] malformed optional v8 objects 不清空既有 authoritative cache。
- [x] unknown extra fields 不破坏 parser。
- [x] Web 不自行重建 reminder text。
- [x] Web 不从 transcript rows 推断第二套 restore utility。

## 4. Tests

### 4.1 Core Restore Tests

- [x] `packages/core/src/chat/context/sessionMemory.test.ts`: structured-only `tool_reference` ToolSearch result。
- [x] `packages/core/src/chat/context/sessionMemory.test.ts`: mixed structured + text ToolSearch result。
- [x] `packages/core/src/chat/context/sessionMemory.test.ts`: legacy text-only ToolSearch result。
- [x] `packages/core/src/chat/context/sessionMemory.test.ts`: failed ToolSearch ignored。
- [x] `packages/core/src/chat/context/sessionMemory.test.ts`: Task `run_in_background` / resume signal / success / error characterization。
- [x] `packages/core/src/chat/context/sessionMemory.test.ts`: structured task hints bounded, deduped, sanitized。
- [x] `packages/core/src/chat/context/sessionMemory.test.ts`: reminder text says hints are best-effort and not recovered runtime state。

### 4.2 App-Server Tests

- [x] `packages/core/src/app-server/server.test.ts`: resume returns pending diagnostics。
- [x] `packages/core/src/app-server/server.test.ts`: replay mirrors pending diagnostics before consumption。
- [x] `packages/core/src/app-server/server.test.ts`: successful dispatch clears pending restore。
- [x] `packages/core/src/app-server/server.test.ts`: pre-dispatch failure retains pending restore。
- [x] `packages/core/src/app-server/threadStore.test.ts`: diagnostics do not persist as transcript authority。
- [x] `packages/core/src/app-server/turnRunner.test.ts`: injected restore block remains next-turn-only if turn runner owns consumption path。

### 4.3 Deferred Runtime Guard Tests

- [x] `packages/core/src/tools/runtime/deferredToolExposure.test.ts`: resume restore hints do not auto-load deferred tools。
- [x] `packages/core/src/tools/modules/toolSearch/handler.test.ts`: structured `tool_reference` output shape remains available for restore extraction。
- [x] app-server or session-memory mock test: structured background task hint does not register/resume/poll tasks。

### 4.4 Web Parser Tests

- [x] `packages/web-reference-react/src/app/core/rpcParsers.test.ts`: old v7 payload remains accepted。
- [x] `packages/web-reference-react/src/app/core/rpcParsers.test.ts`: new v8 structured fields parse。
- [x] `packages/web-reference-react/src/app/core/rpcParsers.test.ts`: malformed optional structured fields are ignored or nulled according to parser strictness。
- [x] `packages/web-reference-react/src/app/core/rpcContracts.test.ts`: contract fixture includes v8 optional fields and preserves v7 compatibility。

### 4.5 Projection Stability Tests

- [x] `packages/core/src/chat/context/contextProjection.test.ts`: v8 restore-hint work does not change durable projection facts。
- [x] Compression projection golden fixture: durable tool-result replacement / preserved segment facts remain unchanged unless separately scoped。

## 5. Recommended Execution Order

### Loop 0: Characterize and Freeze Boundaries

- [x] Add characterization tests for current restore hint source boundaries.
- [x] Lock failed ToolSearch / failed Task exclusion behavior.
- [x] Lock next-turn-only pending restore consumption behavior.
- [x] Lock legacy schema-v1 restore summary compatibility.
- [x] Freeze v8 field names before implementation: `resumeHint` / `resumeSignal`, `lastObservedStatus` / `outcome`, `evidenceSource`, `evidenceConfidence`.
- [x] Decide and document failed/error Task public hint policy; default is exclusion from reminder-rendered task continuity hints.
- [x] Update canonical docs only where current contracts are too vague for v8.
- [x] Run targeted tests touched in this loop.
- [x] Run `bun run type-check` if public types/contracts changed.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(context): characterize restore continuity hint gaps`

### Loop 1: Structured ToolSearch Restore Hints

- [x] Prefer structured `tool_reference` blocks for `recentDeferredToolNames`.
- [x] Keep legacy text-section fallback.
- [x] Ignore failed ToolSearch results.
- [x] Preserve bounded/dedupe/newest-first semantics.
- [x] Add structured-only, mixed, text-only, malformed, and failed-result tests.
- [x] Add no-auto-load regression for deferred tool runtime state.
- [x] Run targeted core/deferred runtime tests.
- [x] Run `bun run type-check` if types changed.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `fix(context): derive deferred restore hints from tool references`

### Loop 2: Structured Delegated Task Hints

- [x] Add additive structured task hint field.
- [x] Preserve legacy `recentTaskHints: string[]`.
- [x] Bound list length and per-field text length.
- [x] Characterize success/error/background/resume cases.
- [x] Keep Loop 2 core-only unless shared public types force broader type-checks; app-server exposure happens in Loop 3 and Web parser behavior happens in Loop 4.
- [x] Render legacy reminder text unchanged through Loop 4; structured rendering starts in Loop 5.
- [x] Add no-task-runtime-resume regression.
- [x] Run targeted session-memory tests.
- [x] Run Web parser tests only if shared public payload types are introduced in this loop.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `feat(context): add structured task restore hints`

### Loop 3: Restore Diagnostics and App-Server Lifecycle

- [x] Add optional restore diagnostics surface.
- [x] Represent pending/source/confidence/status.
- [x] Keep consumed state as `pendingSessionMemoryRestore: null`.
- [x] Verify replay before consumption sees pending diagnostics.
- [x] Verify replay after successful dispatch sees null.
- [x] Verify pre-dispatch failure retains pending restore.
- [x] After consumption, public stable signal is `pendingSessionMemoryRestore: null`; do not require a durable/public `consumed` diagnostics state.
- [x] Ensure diagnostics do not persist into JSONL/raw transcript authority.
- [x] Run targeted app-server/thread-store tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `feat(app-server): expose restore utility diagnostics`

### Loop 4: Web/RPC Parser Compatibility

- [x] Extend Web RPC contracts for optional v8 structured fields.
- [x] Parse old v7 payloads unchanged.
- [x] Parse new v8 structured task hints and diagnostics.
- [x] Treat malformed optional v8 objects according to existing parser tri-state rules.
- [x] Treat malformed optional v8 fields as omitted/unavailable; they must not reject the whole response or clear existing authoritative caches.
- [x] Reserve explicit `null` for fields whose contract defines null semantics, such as `pendingSessionMemoryRestore: null`.
- [x] Drop invalid structured-array items where possible instead of rejecting the whole response.
- [x] Confirm Web does not assemble restore utility from transcript rows.
- [x] Run targeted Web parser/contract tests.
- [x] Run `npm run type-check` in `packages/web-reference-react`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `feat(web): parse structured restore continuity hints`

### Loop 5: Reminder Rendering Quality

- [x] Render structured task hints into one-turn system reminder text.
- [x] Make deferred tool wording explicitly ToolSearch-first and non-loaded.
- [x] Make background task wording explicitly not-resumed.
- [x] Preserve delimiter sanitization and text size bounds.
- [x] Verify reminder injected blocks are not persisted.
- [x] Run targeted session-memory/app-server tests.
- [x] Run `bun run type-check` if shared types changed.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `feat(context): render structured restore continuity hints`

### Loop 6: Cross-Surface Golden Guard

- [x] Extend a golden restore fixture with structured deferred tool + task hints.
- [x] Reuse or minimally extend restore-surface fixtures for assertions only.
- [x] Assert resume/replay share pending restore facts.
- [x] Assert read/messages/replay/resume compression facts remain unchanged.
- [x] Assert no deferred tool store/task runtime side effect happens during restore.
- [x] Assert Web parser output matches app-server payload.
- [x] Do not add preserved-segment relink behavior, durable tool-result replacement summary surface, or reactive compact shaping in this loop.
- [x] Split into Loop 6a core/app-server guards and Loop 6b Web fixture compatibility if this grows beyond one reviewable commit.
- [x] Run targeted core/app-server/Web tests.
- [x] Run `bun run type-check`.
- [x] Run `npm run type-check` in `packages/web-reference-react` if Web contracts changed.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(context): guard restore hints against runtime rehydration`

### Loop 7: Planning Closure and Deferrals

- [x] Update `plans/context-compression-alignment-loop/TODO-INDEX.md` after v8 lands.
- [x] Record `CCA-181` preserved-segment relink parity as next validation mainline candidate.
- [x] Record `CCA-182` reactive compact shaping as later runtime mainline candidate.
- [x] Record durable tool-result replacement summary surface as a separate projection-surface follow-up.
- [x] Record full background task resume as a separate high-risk task-runtime mainline.
- [x] Add/update a short learning note under `docs/learnings/` if v8 changes behavior-alignment mapping decisions.
- [x] Run docs/link checks if available for touched docs.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `docs(context): close CCA-180 v8 restore continuity plan`

## 6. Deferral Register

- [x] `CCA-181`: preserved-segment relink parity should focus on replay / resume / inspection validation parity, not storage rewrite.
- [x] `CCA-182`: reactive compact shaping / provider-specific overflow shaping / telemetry remain later runtime work.
- [x] Durable tool-result replacement summary surface remains a separate projection-surface follow-up.
- [x] Collapse different-id overlap policy remains deferred unless a concrete failing fixture appears.
- [x] Claude Code-style full background task resume remains a separate high-risk task-runtime mainline.

## 7. Completion Criteria

- [x] `recentDeferredToolNames` is derived from structured `tool_reference` blocks first, with legacy fallback.
- [x] structured task hints are available, bounded, and additive.
- [x] pending restore diagnostics are exposed without becoming persisted authority.
- [x] Web parses both v7 and v8 payloads safely.
- [x] reminder text clearly communicates hints, not restored runtime state.
- [x] no-new-authority guard tests cover deferred tool store, task runtime, persisted history, and durable projection state.
- [x] TODO index is updated to mark v8 complete and route follow-ups.
