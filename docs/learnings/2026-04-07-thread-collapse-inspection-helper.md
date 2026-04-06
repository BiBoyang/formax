# 2026-04-07 - thread-level collapse inspection helper

## Context

`request_collapse_applied` 已经会写入 session JSONL，`thread/read` / `thread/messages` 也已经能暴露最近一次 collapse 摘要。但 future debugging 和 tooling 仍然缺少一个官方入口，来回答“这个 thread 一共 collapse 过几次、哪种 phase 更多、累计省了多少 token”。

## Decision

- 在 `ThreadStore` 增加 `inspectThreadRequestCollapse(threadId)`
- 返回最小 inspection 结果：
  - `totalCount`
  - `initialCount`
  - `reactiveRetryCount`
  - `totalEstimatedTokensSaved`
  - `latest`
- 对 provisional / 无 session file 的 thread，返回全零和 `latest: null`
- 继续复用 shared session-event helper，而不是在 `ThreadStore` 里重新扫描 JSONL

## Why

- 给 future replay tooling / inspection surface 一个稳定入口
- 避免 UI、debug 脚本、app-server 以后各自手写 collapse event 聚合逻辑
- 保持 replay 的权威事件语义不变，只增加 inspection 能力

## Guardrails

- 该 helper 不改 persisted history、不改 replay buffer、不新增新的 app-server 协议面
- `latest` 继续沿用和 `thread/read` / `thread/messages` 相同的最小 collapse summary 形状
