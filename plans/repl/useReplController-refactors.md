# useReplController 后续重构计划

Status: `in_progress`
前置条件: semantic-single-writer 计划已完成（见 `semantic-single-writer-todo.md`）。
目标: 在保持行为不变的前提下，将 `useReplController.ts` 从「巨型协调器」收窄为「薄壳 + 调用 controller 纯函数」，提升可读性与可测性。

## 执行看板（当前）

- [x] Slice A（1 + 4）: turn-finalization append 计算 + merge 下沉到 `canonicalTurnMessages.ts`
- [x] Slice B（2）: abort transcript 计算抽出
- [x] Slice C（3）: `tailSegmentsForTurn` 迁移
- [x] Slice D（5 + 6，按需）: send/bash 路由减负
- [x] Slice E（streaming）: canonical bridge 策略/转发下沉

当前进行中: `none`（后续按需开新 slice）

## 原则

- 每次改动至多触及 1–3 个核心文件（不含测试）。
- 单次提交单一意图，不混入无关改动。
- 每步需有针对性测试，必要时加一次确定性 surface smoke。
- 重构前可先加强/补充测试以锁定当前行为。

---

## 一、小重构（单次 1–3 文件、风险低）

### 1. 抽出 turn-finalization 的 merge 为纯函数
Status: `completed`

**位置**: `useReplController.ts` 中 `send()` 的 `finally` 块（约 1097–1244 行）。

**现状**: 大段 `setMessages(prev => { ... })` 内联了：head/tail 切分、legacyToolByUseId、canonicalRows 与 legacy 的 id/timestamp/content 对齐、mergedTail、`resolveCanonicalTurnTailInsertIndex`、时间戳对齐、最终合并与 normalize。

**做法**:
- 在 `controller/canonicalTurnMessages.ts` 中新增纯函数，例如：
  - `mergeCanonicalTurnIntoMessages(prev, turnUserMessageId, canonicalRowsForAppend, turnOutcome, isFailureSubline): Msg[]`
- 将上述逻辑整体移入该函数；hook 内仅保留：
  - 计算 `turnSegments` / `canonicalFinalMessages` / `canonicalRowsForAppend` / `shouldAppendCanonicalFinal`
  - `setMessages(prev => mergeCanonicalTurnIntoMessages(prev, ...))`

**验收**: `send` 明显变短；merge 逻辑可单测；与 Slice 11 的 `resolveCanonicalTurnTailInsertIndex` 同属一模块。

**注意**: 现有 `replaceTurnTailWithCanonicalMessages` 与当前 hook 内 merge 语义不完全一致，不直接替换；将当前这段内联逻辑原样搬进新函数更安全。

**结果**:
- 新增 `mergeCanonicalTurnIntoMessages(...)`，将 `useReplController.ts` finally 中的内联 tail merge 迁入 `canonicalTurnMessages.ts`。
- `useReplController.ts` 仅保留计算 + 调用，移除大段 `setMessages(prev => { ... })` 内联拼接逻辑。

---

### 2. 抽出 abort 时的 messages 计算
Status: `completed`

**位置**: `useReplController.ts` 中 `abort` 的 `setMessages(prev => { ... })`（约 575–627 行）。

**现状**: `markAborted`、`isAskRunning`、补全未出现在 UI 的 running tool 行、以及 AskUser 时追加 “User declined…” 的规则均写在 hook 内。

**做法**:
- 在 `controller/` 下新增小模块（如 `abortTranscript.ts`），导出纯函数，例如：
  - `applyAbortToMessages(prev, trackedRunningToolsSnapshot, hadInFlightRequest): Msg[]`
- hook 内只做：清 ref、调 `resetStreamingBuffers` 等，然后 `setMessages(prev => applyAbortToMessages(prev, ...))`。

**验收**: abort 的 transcript 规则可单测；hook 更短、更易读。

**结果**:
- 新增 `controller/abortTranscript.ts`，提供纯函数 `applyAbortToMessages(...)`。
- `useReplController.abort()` 内联 `setMessages` 逻辑已替换为 pure helper 调用。
- 新增 `abortTranscript.test.ts`，覆盖 running tool 标记/补齐与 AskUser declined 规则。

---

### 3. 将 `tailSegmentsForTurn` 挪到语义层
Status: `completed`

**位置**: `useReplController.ts` 顶部（约 70–86 行）；在 `onCanonicalEvent` 与 `send` 的 finally 中均有使用。

**做法**: 将该函数移至 `semantics/transcriptProjection.ts` 或 `controller/canonicalTurnMessages.ts`（按「是否与 canonical 强相关」择一）；hook 改为从该处 import。

**验收**: hook 少一段纯逻辑；语义层更内聚。

**结果**:
- `tailSegmentsForTurn(...)` 已迁移到 `controller/canonicalTurnMessages.ts` 并导出复用。
- `useReplController.ts` 移除本地实现，改为导入调用。
- 新增 helper 回归测试，锁定“仅提取目标 turn 的连续尾段”语义。

---

### 4. 将「是否要 append canonical final」的计算下沉到 controller
Status: `completed`

**位置**: `send()` 的 finally 中 `canonicalRowsForAppend`、`canonicalToolUseIds`、`hasStableCanonicalOutput`、`shouldAppendCanonicalFinal` 一段（约 1105–1123 行）。

**做法**: 在 `canonicalTurnMessages.ts` 中增加小函数，例如：
- `computeCanonicalTurnAppend(turnOutcome, canonicalFinalMessages) => { canonicalRowsForAppend, shouldAppend }`
或等价命名；hook 仅传 `turnOutcome` 与 `canonicalFinalMessages`，用返回值决定是否调用上面的 `mergeCanonicalTurnIntoMessages`。

**验收**: 规则集中、可测；hook 内 finally 更短、意图更清晰。可与 1 同一次改动一起做。

**结果**:
- 新增 `computeCanonicalTurnAppend(...)`，统一 aborted 过滤 + stable assistant output 判断。
- 新增 helper 单测，覆盖 aborted append 判定与 merge 插入顺序。

---

## 二、中等重构（多文件、多步，需小步提交）

### 5. Bash 模式：将「执行 + canonical 发射」从 send 中拆出
Status: `completed`（分步完成）

**位置**: `send()` 中 `if (text.startsWith('!'))` 整块（约 748–910 行），含 `emitLocalUserMessage`、`emitLocalToolEvent`、`emitLocalFooter`、对 `runBashModeCommand` 的调用及 UI 更新。

**做法**:
- 在 `controller/bashMode.ts` 或新文件 `controller/bashModeCanonical.ts` 中增加协调函数，例如：
  - `runBashModeWithCanonical(args: { command, cwd, env, signal, runtimeFlags, nextReplaySeq, onCanonicalEvent, ... })`
- 该函数内部：调用现有 `runBashModeCommand`，按当前逻辑发射 user_message / tool_event / turn_footer；可返回 `{ result, msgId }` 等，由调用方负责 `setMessages` 的更新（或再包一层把 setMessages 传入，视边界偏好而定）。

**验收**: `send` 少一大块；bash 与 canonical 的契约集中在一处，便于测试。
**注意**: 需保留当前对 `pendingInjectedBlocksRef`、`setMessages` 的更新顺序与语义；拆时小步提交并用现有测试/手动 smoke 验证。

**阶段结果（D.1）**:
- 已在 `controller/bashMode.ts` 新增 `createLocalBashCanonicalEmitter(...)`，封装 LocalBash 的 canonical user/tool/footer 事件发射。
- `useReplController.send()` 的 bash 分支已复用该发射器，移除内联事件构造逻辑。
- 新增 `isBashModeResultError(...)` 与 `applyLocalBashCompletionToMessages(...)`，将 bash 完成态判断与 tool 行更新从 `useReplController` 下沉到 `bashMode.ts`。

---

### 6. 将「send 入口路由」从 send 中拆成独立函数
Status: `completed`（先做 pre-main 路由聚合）

**位置**: `send()` 开头到 `runMainSendTurn` 之前：provider、ensureSessionWriter、bash 分支、sessionSave 的 claude_md、`resolveCommandRouting`、clear/compact/slash 分支等。

**做法**: 在 `controller/send.ts` 中增加 `routeSendInput(text, opts, deps, refs)` 或类似，返回 `{ handled: true }` 或 `{ handled: false, text, ... }`；hook 的 `send` 内先 `const routed = routeSendInput(...)`，若 `routed.handled` 则 return，否则用 `routed` 中的信息调用 `runMainSendTurn`。

**验收**: `send` 从「一长串 if/return」变为「路由 + 一次 runMainSendTurn + finally」，可读性更好。

**阶段结果（D.2）**:
- `controller/send.ts` 新增 `resolvePreMainSendRouting(...)`，统一 pre-main 的 clear/compact/slash 入口路由。
- `useReplController.send()` 已改为调用该 helper，移除对应内联路由分支。
- slash local / local_async 的 session writer 记录回调保持原语义（只移动调用位置，不改行为）。

---

## 三、大重构（架构级，适合单独排期）

### 7. 用「单一 turn 状态机」替代 send 内分散分支

**思路**: 将「bash / clear / compact / slash / 普通 LLM turn」统一成显式状态机（如 idle → routing → bash | local_command | main_turn → finalize），每状态对应一小段逻辑与可选副作用（setMessages、onCanonicalEvent、session writer 等）。

**验收**: 行为顺序与错误路径更清晰；后续加新命令或新 turn 类型更容易。
**成本**: 需将当前 `send` 内全部分支梳理成状态与迁移，并保持与现有行为一致；适合在 1–6 做完、行为已收敛后再考虑。

---

### 8. 将 ref 分组（streaming / canonical / session）

**现状**: hook 内 20+ ref、10+ state 全平铺。

**做法**: 渐进式将「同一类」ref 收进对象，例如：
- `streamingRefs`: assistantBufferRef, thinkingBufferRef, toolNameByIdRef, ...
- `canonicalRefs`: canonicalProjectionRef, canonicalTurnIdRef, canonicalReplaySeqRef, ...
- 已有 `sessionWriterRefs` 可保持不变。

**验收**: 依赖关系更清晰；传参以「对象」为单位，可读性更好。
**注意**: 仅做分组、不改变生命周期与更新时机，避免引入微妙 bug；可与 1、2 等小重构穿插进行。

---

## 四、streaming 拆职责（进行中，按小步）

### E.1 抽出 canonical bridge 策略 + 转发
Status: `completed`

**位置**: `controller/streaming.ts` 事件入口（canonical turn 判定、legacy 写入开关、canonical event 转发）。

**做法**:
- 新增 `controller/streamBridge.ts`：
  - `resolveCanonicalStreamWritePolicy(...)`：统一 `canonicalOnly/canWriteLegacyTranscript/shouldForwardCanonical` 判定。
  - `forwardCanonicalStreamEvent(...)`：统一 stream event -> canonical events 转发。
- `streaming.ts` 入口改为调用上述 helper，并保留 `tool_end` 的 `patchStartLineNumber` 映射逻辑。

**结果**:
- 降低 `handleEvent` 顶部桥接分支复杂度，业务分支（tool/task/thinking）行为不变。
- 新增 `streamBridge.test.ts` 锁定策略与转发语义（含 abort-like error 不转发）。

### E.2 抽出 tool_end 完成态构建器
Status: `completed`

**位置**: `controller/streaming.ts` `tool_end` 分支内 `buildCompletedToolMessage` 内联闭包。

**做法**:
- 新增 `controller/streamingToolCompletion.ts`，导出 `buildCompletedToolMessage(...)`。
- `streaming.ts` 在 `tool_end` 分支只保留上下文收集（`toolInput/taskStats/editPatchStartLineNumber`）并调用 helper。

**结果**:
- `tool_end` 分支显著缩短，`streaming.ts` 更聚焦于事件调度。
- 新增 `streamingToolCompletion.test.ts` 锁定 Task/Skill/Edit 完成态输出格式。

### E.3 抽出 Task/Explore 状态更新 helper
Status: `completed`

**位置**: `controller/streaming.ts` 的 `tool_input/tool_update` 分支。

**做法**:
- 新增 `controller/streamingTaskState.ts`：
  - `updateTaskStateFromToolInput(...)`
  - `applyTaskStatsFromToolUpdate(...)`
  - `shouldApplyLegacyToolUpdate(...)`
- `streaming.ts` 分支改为调用 helper，移除内联 map/batch 更新细节。

**结果**:
- `tool_input/tool_update` 分支更短，职责更清晰。
- 新增 `streamingTaskState.test.ts` 锁定 batch/stats/legacy-update 判定语义。

### E.4 抽出 Explore batch 完成判定 helper
Status: `completed`

**位置**: `controller/streaming.ts` 的 `tool_end` 分支中 Explore 批次完成逻辑。

**做法**:
- 在 `streamingTaskState.ts` 新增 `finalizeExploreBatchOnTaskEnd(...)`。
- `streaming.ts` 改为消费 `{ nextBatch, summaryCount }` 返回值并决定是否追加 summary 行。

**结果**:
- `tool_end` 分支进一步聚焦于消息拼接/副作用编排。
- 批次完成判定规则可在 `streamingTaskState.test.ts` 直接单测。

### E.5 抽出 legacy tool row 构造/更新 helper
Status: `completed`

**位置**: `controller/streaming.ts` 的 `tool_start/tool_input/tool_update` 分支。

**做法**:
- 新增 `streamingLegacyToolRows.ts`：
  - `createRunningToolMessage(...)`
  - `applyLegacyToolInputToMessages(...)`
  - `applyLegacyToolUpdateToMessages(...)`
- `streaming.ts` 对应分支改为调用 helper。

**结果**:
- legacy tool row 的对象构造与 map 更新规则集中，`streaming.ts` 分支进一步减重。
- 新增 `streamingLegacyToolRows.test.ts` 直接覆盖 row 构造与更新语义。

---

## 建议执行顺序

1. **先做小重构 1 + 4**：将 turn-finalization 的「是否 append」与「merge」都迁入 `canonicalTurnMessages.ts`，并补单测。
2. **再做 2**：abort 的 messages 计算抽出。
3. **然后 3**：`tailSegmentsForTurn` 挪到语义层。
4. 若希望继续减负 `send`，再考虑 **5（Bash + canonical）** 与 **6（路由）**。
5. **7、8** 可作为后续架构/可读性优化单独排期。

---

## 相关文件

- `src/features/repl/useReplController.ts` — 主 hook
- `src/features/repl/controller/canonicalTurnMessages.ts` — canonical 转 messages、insert index、replace 等
- `src/features/repl/controller/send.ts` — 路由与 runMainSendTurn
- `src/features/repl/controller/bashMode.ts` — bash 执行与输出格式化
- `plans/repl/semantic-single-writer-todo.md` — 已完成的前置计划
