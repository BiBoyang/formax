# system-reminder（TodoWrite）— 产品化 TODO（不追求 100% Claude Code）

这份 TODO 以两个事实为依据：

- Claude Code 抓包事实表：`plans/system-reminder/claude-code-todowrite-reminders.md`
- `UserPromptSubmit` 触发时机抓包验证：`plans/system-reminder/claude-user-prompt-submit-hook-findings.md`

原则：

- `<system-reminder>` 只给模型看，UI 不展示这个标签本身。
- 我们不做 “tool_result.content 拼接”（Claude Code 的一种注入形态），默认采用更可控的 **策略 A**：
  - **只在发给 LLM 的 `messages[]` 里追加一个新的 `text` content block**（本轮生效，不写入长期 history）。
- 目标是**减少 token**：区分场景、加冷却/去重/裁剪。

## 0. 本阶段范围（只做 TodoWrite reminders）

不包含：

- Read/malware 安全提醒
- 其它 tool 的 `<system-reminder>` 研究（后续另起）

## 0.1 Hook 视角（本 TODO 的承载方式）

我们会把 **TodoWrite reminder 的触发**承载到一个“用户发送消息时”的 hook 上（文档里常称 `UserPromptSubmitHook`）：

- **更契合语义**：todo 提醒是“会话/工作流提醒”，自然发生在用户发起下一步之前。
- **更省 token**：不会在每次 tool loop 里都注入；触发频率更可控。

同时明确：

- Read/malware 那类安全提醒更契合 `PostToolUse`（但本 TODO 不做）。

## 1. 定义三类 TodoWrite reminder（拆分是为省 token）

- [x] `TODO_EMPTY`
  - 触发：todo 列表为空（或不存在/读取失败时的策略：先不提醒）
  - 输出：短提醒（不带 list）
- [x] `TODO_UNUSED`
  - 触发：todo 列表存在，但“最近没用 TodoWrite”到达阈值
  - 输出：短提醒（不带 list）
- [x] `TODO_UNUSED_WITH_LIST`
  - 触发：满足 `TODO_UNUSED` 且进入“再次提醒/更强提醒”窗口（例如连续多次 stale）
  - 输出：提醒 + **裁剪后的 todo list 片段**

> 说明：拆成三类，是为了把“默认提醒”做短，只有必要时才带 list（最吃 token）。

## 2. 冷却/去重/裁剪（token 控制三件套）

- [x] 冷却（cooldown）：同一类 reminder 在 N 轮（或 N 次 tool_use）内最多注入一次（当前只对 `TODO_UNUSED*` 生效）
- [x] 去重（dedupe）：如果“本轮文本”与“上次注入的文本”一致，则不注入（当前只对 `TODO_UNUSED*` 生效）
- [x] 裁剪（trim）：对 `TODO_UNUSED_WITH_LIST` 的 list 片段做强约束
  - [x] 最多 N 条（默认 3）
  - [x] 每条最多 M 字符（默认 80）
  - [x] 总字符预算上限（默认 800 chars）

## 3. 注入点与形态（策略 A，符合抓包“last user 判定”）

抓包事实表的关键点是：**判定“当轮注入”要看请求 messages 里最后一个 `role:"user"` message**。

- [x] 注入点：patch 本轮请求的 messages（不改长期 history）
  - [x] **用户发消息时（推荐）**：在 last-user message 的 `content` **追加一个 `type:"text"` block**
  - [ ] （可选/后续）tool loop 中间注入：更像 `PostToolUse` 的职责（本 TODO 暂不做，以免增加 token 与复杂度）
- [x] 文本形态：`<system-reminder>\n...\n</system-reminder>`
- [x] 保证：不把 reminder 写进 `loopMessages` / history（避免污染与 token 累积）

## 4. 状态信号（“最近没用 TodoWrite”的定义）

我们采用“会话内信号”，不做复杂任务分类（先简单可控）：

- [x] `nonTodoToolUsesSinceLastTodoWrite`（只统计主会话 tool loop）
- [x] `lastTodoWriteAt`（用于重置窗口/清理记录）
- [x] `remindersSentAt` + `remindersSentText`（用于去重/冷却）

## 5. 与现有代码的合并/去重（避免两套提醒同时跑）

当前 repo 里 TodoWrite reminder 相关入口至少有：

- `src/chat/engine.ts`（tool loop 阈值 + 注入）
- `src/features/repl/reminders/ReminderService.ts`（会话态提醒）
- `src/features/repl/injectedBlocks.ts`（提示文案片段）

本阶段目标：收敛为“单一注入路径”，避免重复提醒与重复 token。

- [x] 保留一个权威入口：`src/features/repl/reminders/ReminderService.ts`
- [x] 移除 `src/chat/engine.ts` 内的 todo reminder 注入（避免 tool loop 重复 token）
- [ ] 盘点/清理其它遗留入口：
  - [x] `src/features/repl/injectedBlocks.ts` 的 `buildTodoInjectedBlocks()`（已删除，避免重复注入路径）

## 5.1 Hook 接线（让 todo reminder 真正由 hook 驱动）

> 目标：TodoWrite reminder 不再是 engine 里“临时逻辑”，而是一个可开关、可测试、可审计的 hook。

- [ ] （后续）如果要把 todo reminder 也纳入 hooks 系统：再引入 `UserPromptSubmit` 事件
  - 当前阶段已满足“UserPromptSubmit 语义”（在用户发消息时注入、且不会写入长期 history），所以不强依赖 hooks 系统接线。

## 6. 测试（必须先锁行为，防回归）

### 6.1 单元测试（纯函数/状态机）

- [x] 空 todo → 注入 `TODO_EMPTY`
- [x] 有 todo + 未到阈值 → 不注入
- [x] 到阈值首次 → 注入 `TODO_UNUSED`（不带 list）
- [x] 多次 stale → 注入 `TODO_UNUSED_WITH_LIST`（带裁剪 list）
- [x] 去重：相同文案不重复注入（`TODO_UNUSED_WITH_LIST`）

### 6.2 集成测试（engine / request patch 语义）

- [x] 断言：reminder 只出现在“本轮 messages 的 last user message”里
- [x] 断言：reminder **不写入**长期 history（下一轮历史里不应该自带 reminder）

## 7. 手动验收剧本（不抓包也能验证）

- [ ] Case A：没有 todos，聊天两轮，观察提醒出现频率与冷却
- [ ] Case B：建 3 条 todo，但故意不再用 TodoWrite，连续触发 5 次非 TodoWrite tool，观察 reminder 从 UNUSED → UNUSED_WITH_LIST 的升级
- [ ] Case C：触发一次 TodoWrite 更新，再触发 tool，观察 stale 计数清零

## 8. 待抓包确认（不阻塞实现）

- [ ] Claude Code 的 `TODO_UNUSED_WITH_LIST` 升级阈值（是 step 计数还是时间）
- [ ] Claude Code 对“用户明确拒绝维护 todo”的处理（我们可更产品化：用户拒绝时暂停注入或延长冷却）
