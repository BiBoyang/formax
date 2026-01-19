# TODO：稳定性 / 可预测性基座（仅保留未完成项）

目标：优先修复“会导致连锁失败/难排查/输出契约不稳定”的问题，让主流程更可控。

约束：
- 不做大搬家/大重构（避免 churn）
- 不新增 provider 适配（仅修稳定性）
- 优先保持行为可回滚：每个小项完成就独立 commit

---

## S1 — Todo reminder 注入不要污染 tool_result（也不要破坏 JSON 工具输出）

- [x] 不再把 `<system-reminder>` 拼进任何 `tool_result.content`
- [x] 改为“仅对下一次模型调用注入一次性提醒”（作为 `system` 的 `cache_control: { type: 'ephemeral' }` block）
- [x] 触发阈值与“TodoWrite 重置计数”行为保持不变
- [x] 测试：`src/chat/engine.test.ts` 更新为验证
  - [x] 第二次 `streamOnce` 的 `system` 包含 reminder
  - [x] `tool_result.content` 不包含 reminder（避免 JSON 变脏）

## S2 — Plan snippet（`→` 行号前缀）与 Edit 匹配逻辑对齐

- [x] `src/tools/modules/edit/handler.ts`：`stripCatNPrefixes()` 同时支持 `cat -n`（`\\t`）与 plan snippet（`→`）
- [x] 测试：`src/tools/modules/edit/handler.test.ts` 增加“`→` 前缀也能 edit 成功”

## S3 — Abort / Esc 取消要完整清理 pending 输入与 running 工具状态

- [x] `src/tools/runtime/userInputManager.ts`
  - [x] 增加 `rejectAllPending(error)`：一次 reject 所有 pending，并移除 abort listener
  - [x] 增加 `clearBufferedAnswers()`：清空 buffered（可选：加 TTL 防止增长）
- [x] `src/features/repl/useReplController.ts`
  - [x] `abort()` 调用上述清理（避免“卡在 loading / prompt 还在”）
  - [x] 将所有 `toolInfo.status === 'running'` 的 tool message 标记为 aborted/error（避免 UI 悬挂）
- [x] 测试：`src/tools/runtime/userInputManager.test.ts` 覆盖 rejectAll/clearBuffered

## S4 — `<system-reminder>` strip 逻辑去重（单一事实来源）

- [x] 只保留一份 `stripTrailingSystemReminderBlock()` 实现（放 `src/utils/toolFormatting.ts` 并导出）
- [x] `src/features/repl/useReplController.ts` 使用同一实现（移除重复代码）

## S5 — JSON 工具“成功 JSON / 失败纯文本”契约对齐（先从 TaskOutput 做起）

- [ ] `src/tools/modules/taskOutput/handler.ts`：错误分支也返回 JSON（保持可解析）
  - [ ] missing task_id / task not found / timeout 非法等
- [ ] 测试：`src/tools/modules/taskOutput/handler.test.ts` 更新断言为 JSON 结构（不再仅 string contains）

---

## Backlog（需要更多证据/更大改动，暂不做）

- [ ] 统一错误输出格式（ErrorCode/Hint/结构化字段）到所有 preflight/handler（范围大）
- [ ] Plan mode 限制逻辑多处重复（policyPreflight + handler）统一（可能牵扯面大）
- [ ] streaming/tool_update setState 频繁导致闪烁：需要基准与更明确复现
