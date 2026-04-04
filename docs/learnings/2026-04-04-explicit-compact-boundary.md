# 2026-04-04 Explicit Compact Boundary

## What changed

- compact 后的 persisted history 不再只有 summary user message。
- `rebuildHistoryAfterCompaction(...)` 现在会在 summary 之前插入一个 metadata-only compact boundary message。
- boundary 现在会携带最小 metadata：
  - `trigger`
  - `preTokens`
  - `summaryKind`
  - `keepStrategy`
- boundary 现在还可以携带一个轻量 `rehydrationPlan`，先声明 compact 后哪些状态需要优先补回：
  - `recent_files`
  - `plan_state`
  - `mode_state`
- `ChatEngine` 与 token estimation 会在真实 prompt 组装时忽略这类 boundary message。
- `/context --json` 与 app-server `local.diagnostics` 现在会暴露 `latestCompactBoundary`，方便直接检查最近一次 compact 的边界元信息。

## Why this shape

- 这是把 compact 从“消息技巧”往“协议事件”推进的第一步。
- 如果 boundary 直接靠 summary user message 文本语义识别，后续加 metadata、resume slicing、partial compact 都会越来越别扭。
- 如果 boundary 直接作为文本消息发送给模型，又会污染 prompt。
- 所以第一步选择 metadata-only event：
  - session / replay 看得见
  - 后续协议升级有锚点
  - 对现有 transcript 和模型上下文影响最小
- 第二步补最小 metadata，是为了让 boundary 真正开始承担协议职责，而不只是“有一个占位点”。
- 第三步补最小 `rehydrationPlan`，是为了先把“compact 后要补什么”协议化，而不是等真正注入 rehydrate blocks 时再临时发明形状。

## Follow-ups

- 下一步是 `CCA-031`：先实现最近文件 rehydrate，再继续把 `/context` 扩到可见 rehydration 成本。
