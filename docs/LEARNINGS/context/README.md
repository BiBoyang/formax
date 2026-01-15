# Context 管理（Codex/Claude Code 观察 → Formax 落地）

这篇文档回答一个核心问题：

> **UI 里显示的对话越来越长，但发给模型的 messages 不能无限长**。我们如何做到“UI 全保留、prompt 自动控长”？

目标读者：中等技术水平（甚至小白也能跟上）。

---

## TL;DR

- ✅ Codex/Claude Code 的 CLI 看起来“历史很长”，但实际给模型的 prompt 会被控长（否则一定会爆上下文）。
- ✅ Formax 把**UI messages**（展示用）与**prompt history**（发给模型用）拆开管理：UI 不删，prompt 可剪裁/压缩。
- ✅ 剪裁时必须维护一个关键不变量：`tool_use ↔ tool_result` 必须成对，否则会引发连锁失败（例如 Edit 找不到 old_string）。
- 🛠 Formax 通过三层兜底保证不爆：
  1) **硬截断**（truncate long blocks）
  2) **丢弃最老 turns**（仍超限）
  3) **/compact 与自动 compact**（用 summary 替代大段历史）

---

## 1) 你在命令行看到什么（现象）

常见现象（✅）：

- 对话越聊越长，UI 仍然能滚动看到完整历史。
- 同时 UI 会显示一个 “context meter”（百分比/已用 tokens），提示上下文占用。
- 运行工具（Read/Bash/Grep/Task…）时，工具输出可能非常长，但不会无限把 prompt 撑爆。

---

## 2) 为什么必须做“UI transcript ≠ Prompt transcript”

如果 UI 和 prompt 用同一个列表，会出现两个问题：

1) **prompt 爆上下文（致命）**
   - 长对话 + 长工具输出，会导致模型请求失败（超上下文窗口）。
2) **工具链可能被破坏（隐蔽但更糟）**
   - 如果你剪裁时把 `tool_use` 或 `tool_result` 单独剪掉，就会出现“孤儿 tool_result / tool_use”，导致模型对上下文理解错位。

✅ Formax 的不变量写在：`plans/ctx-manage/TODO.md`（事实约束 / 不变量）。

---

## 3) Formax 的落地（代码在哪）

### 3.1 REPL 侧（UI 与 prompt 的分离）

**主入口**：`src/features/repl/useReplController.ts`

- UI：`messages` state（用于渲染）
- prompt：`historyRef.current`（用于发给模型）

### 3.2 预算 / 估算 / context window

- `src/chat/context/modelWindow.ts`：当前已知模型的 context window（可被 config 覆盖）
- `src/chat/context/estimate.ts`：估算兜底（bytes/4）
- `src/chat/context/budget.ts`：effective/autoCompact 阈值换算 + stats

### 3.3 硬截断（必需兜底）

- `src/chat/context/prune.ts`：`pruneForPromptBudget()`
  - 先截断容易爆的块（tool_result / injected reminders / stdout）
  - 仍超限：丢弃最老 turns
  - 始终维护 `tool_use ↔ tool_result` 成对不变量

### 3.4 /compact（手动压缩）

- `/compact` 由 `useReplController` 特判实现（不是走 registry kind）
- 行为：
  - 额外发起一次“summary 回合”（tools: []）
  - 把 summary 写入 prompt history
  - UI 插入提示行（UI 历史不删除）
- Tail 保留策略：`src/chat/context/compact.ts`（keep last N user turns）

### 3.5 tool loop 里的控长（最容易踩坑）

工具循环（stopReason=tool_use）会在同一 turn 内多次调用模型：

- ✅ 如果只在 turn 结束后 prune，**中间某一轮**也可能因为工具输出太长直接爆上下文。
- 🛠 Formax 在 tool loop 里也做了 budget pruning：
  - `src/chat/engine.ts`：`promptBudget` 存在时，每次 `streamOnce()` 前先 `pruneForPromptBudget()`

---

## 4) 怎么验证（建议 5 步）

1) 运行：`bun run dev`
2) 连续对话 10+ 轮，观察 UI 仍保留历史，context meter 会变化
3) 运行一个“长输出工具”（例如 Grep/Bash 输出多行），确认不会把 prompt 撑爆
4) 执行 `/compact`，再发一句普通消息，确认仍能继续工具调用/对话
5) 观察 `tool_use ↔ tool_result` 是否仍成对（可用 `bun run test -- src/chat/context/prune.test.ts`）

---

## 5) 还没完全对齐的点（❓）

- ❓ “真正的 prompt tokens 使用量”：provider usage 只能提供“本次请求”的 input tokens；对“当前 history 在下一轮会占用多少”仍然需要估算兜底。
- ❓ 更像 Codex 的“自动 compact 触发策略”（节流/提示文案/保留最近 N 的具体默认值）仍可继续调参。

