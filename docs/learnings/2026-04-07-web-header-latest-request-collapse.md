# 2026-04-07 - Web header consumes latest request collapse

## Context

`thread/read` / `thread/messages` 和 Web parser 已经都能提供 `latestRequestCollapse`，但真实 Web surface 还没有消费这份状态。这样会导致 collapse 虽然已经是 runtime/session/app-server 可见事实，但客户端仍然只在 diagnostics 里间接知道它。

## Decision

- 复用现有 `thread/messages` 加载链，不新增 `thread/read` 请求
- 在 Web thread cache 中新增 `latestRequestCollapseByThreadId`
- `useTranscriptDisplayState(...)` 选择 active thread 的 collapse summary
- `AppShellHeader` 在标题下方渲染一行轻量 summary：
  - `estimatedTokensSaved`
  - `collapsedHeadMessageCount`
  - `phase`

## Why

- 让最近一次 request-time collapse 真正进入一个已存在的客户端 surface
- 避免为了展示 collapse summary 再引入一条新的 thread metadata 请求链
- 保持改动范围小：
  - 不改 timeline item 协议
  - 不改 thread list 协议
  - 不改 persisted history 语义

## Guardrails

- header summary 只展示最近一次 collapse 摘要，不能被解释为当前 thread history 已被 rewrite
- 仍然以 `thread/messages` 顶层 `latestRequestCollapse` 为准，不从 timeline item 反推
- 如果没有 collapse summary，header 保持原状
