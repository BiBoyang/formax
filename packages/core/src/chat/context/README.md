# packages/core/src/chat/context

Last verified: 2026-04-04

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
        │ microCompactHistory (P2: 轻量清理旧 tool_result)
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

- **位置**：`packages/core/src/features/repl/useReplController.ts`
- **用途**：纯展示（用户看到的历史），可以非常长。
- **组成**：`user / assistant / tool` 三类消息（tool 有 running/completed/error 等状态）。

### Prompt transcript（historyRef）

- **位置**：`packages/core/src/features/repl/useReplController.ts`
- **用途**：发送给模型的对话历史（`historyRef.current`）。
- **核心约束**：必须在预算内，并且在任何截断/压缩后保持 tool_use/tool_result 成对不变量。

### injected blocks（ephemeral）

- **位置**：`packages/core/src/features/repl/useReplController.ts`
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

- `packages/core/src/chat/context/modelWindow.ts`：按 `{provider, model}` 推断 context window（未知时返回 null）
- `packages/core/src/chat/context/budget.ts`：预算换算（effectiveLimit/autoCompactLimit）与 stats
- `packages/core/src/chat/context/estimate.ts`：token 粗估策略（目前 bytes/4）
- `packages/core/src/features/repl/useReplController.ts`：每轮发送前/后计算 meter，触发裁剪

### 想改“硬截断兜底（P3）”

- `packages/core/src/chat/context/prune.ts`：`pruneForPromptBudget()`（安全兜底，保持 tool 对）
- `packages/core/src/chat/context/prune.test.ts`：单测覆盖（预算 fit + tool 对不变量）

### 想改“轻量压缩 / microcompact（P2）”

- `packages/core/src/chat/context/microCompact.ts`：`microCompactHistory()`（当前默认会压 `Read` / `Grep` / `Glob` 的旧大结果，以及 `Skill` 的旧 machine-generated companion body；stub 会保留路径/模式/skill 名称与近似体量摘要）
- `packages/core/src/chat/context/microCompact.test.ts`：单测覆盖（保留最近结果、跳过 error/小结果、stub 可读性）
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`：当前挂载点（prepare/finalize）

### 想改“上下文诊断 / /context”

- `packages/core/src/chat/context/contextDiagnostics.ts`：`analyzeContextDiagnostics()` + `formatContextDiagnosticsReport()`
- `packages/core/src/chat/context/contextDiagnostics.test.ts`：单测覆盖（slice 估算、budget 字段、报告文案）
- `packages/core/src/features/repl/controller/send/send.ts`：`/context` 的本地命令入口

### 想改“/compact（P4）”

`/compact` 已实现。主要入口：
- pre-main 路由：`packages/core/src/features/repl/controller/send/sendPreMainRouting.ts`
- compact flow：`packages/core/src/features/repl/controller/send/compactFlow.ts`（summary 生成 + lifecycle；auto compact 现在会走 `keep_combo`）
- history 重建：`packages/core/src/chat/context/compact.ts`（tail 选择、boundary metadata、rehydration 拼装；当前最小 working-set anchor 已覆盖最近成功 `Read`，但只允许回卷最近 1 个额外 user turn）

### 想改“session memory / rolling memory（P5 起点）”

- `packages/core/src/chat/context/sessionMemory.ts`：`buildSessionMemoryDraft()` + `mergeSessionMemoryDraft()`
- `packages/core/src/chat/context/sessionMemory.test.ts`：builder / merge 规则回归
- `packages/core/src/features/repl/controller/session/sessionRollingMemory.ts`：每轮 turn 完成后的 rolling memory sidecar 刷新
- `packages/core/src/features/repl/sessionSave/sessionMemorySidecar.ts`：session `.memory.json` sidecar 路径与原子写入
- 当前定位：
  - 这是 **session-scoped working memory draft**，不是现有按 cwd 的 `MEMORY.md` 替代品
  - 当前已经接进 turn completion 的后台刷新，但还没有接进 auto compact fallback / resume 恢复

---

## 4) 常见坑（与本目录相关）

- **UI transcript ≠ Prompt transcript**：不要为了省 token 去删 UI 的 `messages[]`，应该只裁剪 `historyRef`。
- **tool 成对不变量**：任何 trim/compact 后必须保持 `tool_use ↔ tool_result` 成对，不然 Edit/Write 等会出现“找不到 old_string / 上下文错位”等连锁错误。
