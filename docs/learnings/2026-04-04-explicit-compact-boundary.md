# 2026-04-04 Explicit Compact Boundary

## What changed

- compact 后的 persisted history 不再只有 summary user message。
- `rebuildHistoryAfterCompaction(...)` 现在会在 summary 之前插入一个 metadata-only compact boundary message。
- boundary 当前不带业务 metadata，只表达一件事：`这里是一次 compact 的边界点`。
- `ChatEngine` 与 token estimation 会在真实 prompt 组装时忽略这类 boundary message。

## Why this shape

- 这是把 compact 从“消息技巧”往“协议事件”推进的第一步。
- 如果 boundary 直接靠 summary user message 文本语义识别，后续加 metadata、resume slicing、partial compact 都会越来越别扭。
- 如果 boundary 直接作为文本消息发送给模型，又会污染 prompt。
- 所以第一步选择 metadata-only event：
  - session / replay 看得见
  - 后续协议升级有锚点
  - 对现有 transcript 和模型上下文影响最小

## Follow-ups

- 下一步是 `CCA-021`：给 boundary 补 metadata，例如 trigger、preTokens、summaryKind、keepStrategy。
- 之后再做 `CCA-022`：让 prompt 视图逐步基于最近 boundary 构建，而不是继续把 summary user message 当唯一语义锚点。
