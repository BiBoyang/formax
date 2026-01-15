# src/chat/context

Last verified: 2026-01-15

Formax 的“上下文管理”分两条线：

1. **UI transcript（完整保留）**：你在终端看到的 `messages[]`。
2. **Prompt transcript（可控长度）**：实际发给 LLM 的 `historyRef`（会被截断/压缩）。

这两者的目标不同，所以必须**解耦**：UI 不丢历史，但 prompt 必须有预算上限，避免被长工具输出撑爆。

---

## 1) 数据流（关键链路图）

```
┌──────────────────────────────┐
│ Ink UI (REPL.tsx)            │
│ - 渲染 Header + messages[]   │
│ - 仅展示，不参与控长         │
└───────────────┬──────────────┘
                │ user input
                v
┌──────────────────────────────┐
│ useReplController.send()     │
│ - UI: setMessages(...)       │
│ - Prompt: historyRef.current │
└───────┬──────────────────────┘
        │ build injected blocks (ephemeral)
        v
┌──────────────────────────────┐
│ buildSystemPrompt + user msg │
│ - system: buildSystemPrompt  │
│ - user: buildUserContent     │
│ - injected: reminders/plan   │
└───────┬──────────────────────┘
        │ pruneForPromptBudget (P3: 硬截断兜底)
        v
┌──────────────────────────────┐
│ ChatEngine.runTurn()         │
│ - streaming + tool loop      │
└───────┬──────────────────────┘
        │ nextHistory
        v
┌──────────────────────────────┐
│ stripInjectedBlocksFromHistory│
│ - injected 仅用于“本轮发送”   │
└───────┬──────────────────────┘
        │ pruneForPromptBudget (post-turn)
        v
┌──────────────────────────────┐
│ historyRef.current 更新       │
│ (下轮 prompt history)         │
└──────────────────────────────┘
```

---

## 2) 关键概念

### UI transcript（messages）

- **位置**：`src/features/repl/useReplController.ts`
- **用途**：纯展示（用户看到的历史），可以非常长。
- **组成**：`user / assistant / tool` 三类消息（tool 有 running/completed/error 等状态）。

### Prompt transcript（historyRef）

- **位置**：`src/features/repl/useReplController.ts`
- **用途**：发送给模型的对话历史（`historyRef.current`）。
- **核心约束**：必须在预算内，并且在任何截断/压缩后保持 tool_use/tool_result 成对不变量。

### injected blocks（ephemeral）

- **位置**：`src/features/repl/useReplController.ts`
- **用途**：只影响“这一轮发给模型”的 user content（例如 plan mode reminder、todos reminder、本地命令输出等）。
- **关键点**：
  - injected blocks 会带 `cache_control: { type: 'ephemeral' }`
  - 发送完成后，会从 `nextHistory` 里剥离（避免把 ephemeral 永久写进 prompt history）
  - 但在预算极紧时，它们仍可能参与裁剪（`pruneForPromptBudget` 有 “ephemeral text 截断”）

### token usage vs context usage

- streaming 返回的 `usage` 通常是 **本轮消耗/计费**（prompt + completion），不是“当前历史占用”。
- Formax 目前 meter 用 `estimatePromptTokens()` 做粗估（bytes/4），并通过 `computeContextStats()` 显示 percent/tokens。

---

## 3) “改哪儿”（最常用入口）

### 想改“预算 / meter / 阈值”

- `src/chat/context/modelWindow.ts`：按 `{provider, model}` 推断 context window（未知时返回 null）
- `src/chat/context/budget.ts`：预算换算（effectiveLimit/autoCompactLimit）与 stats
- `src/chat/context/estimate.ts`：token 粗估策略（目前 bytes/4）
- `src/features/repl/useReplController.ts`：每轮发送前/后计算 meter，触发裁剪

### 想改“硬截断兜底（P3）”

- `src/chat/context/prune.ts`：`pruneForPromptBudget()`（安全兜底，保持 tool 对）
- `src/chat/context/prune.test.ts`：单测覆盖（预算 fit + tool 对不变量）

### 想改“/compact（P4）”

尚未实现（参见 `plans/ctx-manage/TODO.md`）。
建议未来入口：
- slash command：`src/features/commands/registry.ts`
- 行为落点：`src/features/repl/useReplController.ts`（重写 historyRef + 插入 UI 提示）

---

## 4) 常见坑（与本目录相关）

- **UI transcript ≠ Prompt transcript**：不要为了省 token 去删 UI 的 `messages[]`，应该只裁剪 `historyRef`。
- **tool 成对不变量**：任何 trim/compact 后必须保持 `tool_use ↔ tool_result` 成对，不然 Edit/Write 等会出现“找不到 old_string / 上下文错位”等连锁错误。

