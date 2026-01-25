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

> 说明：TodoWrite reminders 是“给模型看的 `<system-reminder>`”，UI 不会展示这个标签。
>
> - **最可靠验证**：用本地 proxy 抓包，在请求的 **last user message content** 中检索 `<system-reminder>`。
> - **不抓包的验证**：只能做“黑盒启发式”（观察模型是否更倾向于使用 TodoWrite），不保证稳定复现。

### 7.0 预备：让实验可重复（一次性）

1) 启动 Formax 前设定环境（建议用独立 todo 文件，避免污染你的真实 todo）：

```bash
export FORMAX_PROMPT_PROFILE=full
export FORMAX_TODOS_PATH=.formax/_manual/todos.json
mkdir -p .formax/_manual
rm -f .formax/_manual/todos.json
```

2) 运行：

```bash
bun run dev
```

3) （可选，但强烈推荐）确保本次对话的 LLM 请求会落到你在本地的抓包目录（例如 `proxy/traffic-logs-*`），否则只能做黑盒验证。

### 7.1 Case A：TODO_EMPTY（空 todo）

- [x] **目标**：todo 为空时，每轮用户消息都会注入一个“todo list is currently empty”的 `<system-reminder>`。

步骤：
1) 在 REPL 里发送一条普通消息，例如：`你好`
2) 继续再发一条普通消息，例如：`继续`

抓包验收（推荐）：
- 在对应的请求 JSON（`REQ__v1_messages*.json`）里，找到 **最后一个 `role:"user"`** 的 `content`：
  - 应出现一个 `type:"text"` block，文本包含 `<system-reminder>` 且包含 `todo list is currently empty`。

黑盒验收（不抓包）：
- 模型更容易主动建议你使用 TodoWrite（但可能受模型随机性影响）。

### 7.2 Case B：TODO_UNUSED → TODO_UNUSED_WITH_LIST（“没用 TodoWrite”升级）

- [x] **目标**：当 todo 存在但“近期没用 TodoWrite”到阈值时：
  - 先注入 `TODO_UNUSED`（短提醒，不带 list）
  - 再升级到 `TODO_UNUSED_WITH_LIST`（带裁剪后的 list）

步骤：
1) 先让 todo 列表非空：对模型说  
   `请用 TodoWrite 创建 3 条 todo：['a','b','c']`
2) 接下来 **不要再用 TodoWrite**，而是触发若干“非 TodoWrite tool”来累计 `nonTodoToolUsesSinceLastTodoWrite`。
   - 最简单的方法：连续要求模型执行 3 次 Bash（例如 `echo 1` / `echo 2` / `echo 3`）
3) 再发送一条普通消息，例如：`继续`

抓包验收（推荐）：
- 在“步骤 3”的请求里，last user message content 应出现 `<system-reminder>`，包含：
  - `The TodoWrite tool hasn't been used recently`
  - 若处于升级阶段，还应包含 `Here are the existing contents of your todo list:` + 被裁剪后的 `[...]` 列表

黑盒验收（不抓包）：
- 模型开始更倾向于“建议使用 TodoWrite”或“建议清理 todo”，但依旧不保证稳定复现。

### 7.3 Case C：TodoWrite 后重置窗口（清零 stale 计数）

- [x] **目标**：成功的 TodoWrite 会清空 `nonTodoToolUsesSinceLastTodoWrite`，并清理 UNUSED 系列的冷却/去重状态，使提醒窗口重新计算。

步骤：
1) 先复现 Case B 的“UNUSED / UNUSED_WITH_LIST”至少一次（建议抓包确认已出现）
2) 现在让模型执行一次 TodoWrite 更新，例如：  
   `请用 TodoWrite 把第 1 条标记为 completed，其他不变`
3) 再触发 1～2 次非 TodoWrite tool（例如 Bash `echo ok`）
4) 再发送一条普通消息，例如：`继续`

抓包验收（推荐）：
- “步骤 4”的请求里 **不应该立刻**出现 `The TodoWrite tool hasn't been used recently`（除非你又触发到了阈值）。

## 8. 待抓包确认（不阻塞实现）

- [ ] Claude Code 的 `TODO_UNUSED_WITH_LIST` 升级阈值（是 step 计数还是时间）
- [ ] Claude Code 对“用户明确拒绝维护 todo”的处理（我们可更产品化：用户拒绝时暂停注入或延长冷却）

## 验证记录（Formax）

- 对话记录：`plans/_archive/system-reminder/conv.txt`
- 抓包：`proxy/traffic-formax-test/0001_...`（TODO_EMPTY），`proxy/traffic-formax-test/0011_...`（TODO_UNUSED），`proxy/traffic-formax-test/0026_...`（TODO_UNUSED_WITH_LIST），`proxy/traffic-formax-test/0013_...`/`proxy/traffic-formax-test/0027_...`（确认不粘连/不污染后续请求）
- 备注：本轮手测未设置独立 `FORMAX_TODOS_PATH`，使用了默认 todo 路径；不影响“注入时机/形态/不落 history”的结论
