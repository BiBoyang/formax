# 2026-04-07 - thread/messages collapse summary parity

## Context

`thread/read` 已经开始暴露 `latestRequestCollapse`，但 `thread/messages` 仍然只有 timeline items。本轮需要把最近一次 request-time collapse 摘要带到 timeline surface，同时保持现有 `data[]` item 协议不变。

## Decision

- 在 `thread/messages` 顶层结果增加可选 `latestRequestCollapse`
- 继续沿用与 `thread/read` 相同的最小字段集合：
  - `phase`
  - `collapsedHeadMessageCount`
  - `estimatedTokensSaved`
  - `recapFingerprint?`
- 不新增新的 timeline item kind，不改 `message` / `tool` item 语义
- Web 端同步补 parser parity：
  - `parseThreadReadResponse(...)`
  - `parseThreadMessagesResponse(...)` 读取同一 summary 字段

## Why

- 让客户端可以在不改 timeline item 协议的前提下，感知最近一次 request-time collapse
- 保持 `thread/read` / `thread/messages` / Web parser 的 collapse summary 形状一致
- 降低后面 richer UI 或 inspection surface 再次手写“最近一次 collapse 摘要”逻辑的概率

## Guardrails

- `latestRequestCollapse` 只是摘要事实，不能被解释为 persisted history 已被 rewrite
- `thread/messages` 的现有 `data[]` item shape 必须保持兼容
- 客户端忽略该字段时，旧行为不变
