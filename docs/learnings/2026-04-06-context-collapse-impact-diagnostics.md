# 2026-04-06 context collapse impact diagnostics

## What changed

- `/context` 的 `nextTurnFixed` diagnostics 现在会显式暴露 `collapseImpact`
- 这层 impact 说明的是 **request-time context collapse** 是否生效，而不是 persisted history 是否被改写
- text diagnostics 也同步新增了 collapse impact 小节，方便在 TUI / local stdout 里直接判断：
  - 是否发生 collapse
  - 折叠了多少条较老消息
  - collapse 后 projected history 还剩多少
  - 估算节省了多少 token

## Why this was needed

- request-time `context collapse MVP` 已经接入了主发送链，但如果 `/context` 仍然只展示 microcompact / prune，就会继续高估下一轮 request 体积
- diagnostics 必须开始反映 **真实 request projection**，否则：
  - token 数字和真正发给模型的 payload 不一致
  - top contributors 仍会指向已经被 collapse 掉的旧 head
  - 很难判断 collapse 到底有没有价值

## Key design choice

- `analyzeNextTurnFixedContext(...)` 现在仍然保留：
  - `projectedHistoryTokens`：microcompact/prune 后、collapse 前的历史体积
- 同时新增：
  - `collapseImpact.projectedHistoryTokensAfterCollapse`
  - `collapseImpact.projectedHistoryDeltaTokens`
- `nextTurnFixed.totalTokens` 和 `topAssembledContributors` 现在基于 **collapse 后的 request projection** 计算

这样可以同时回答两个问题：

1. collapse 之前有多大
2. collapse 之后真实请求有多大

## Important nuance

- diagnostics 里传给 collapse helper 的是 **latest compact boundary 之后的 continuation view**
- 这和主发送链里仍然携带 compact boundary 的 `preparedHistory` 不同
- 因此 collapse helper 新增了一个显式模式：
  - `allowBoundarylessContinuation`

只有当调用方明确知道自己传入的是 boundary-first continuation view 时，才允许在没有 boundary marker 的情况下继续 collapse。

## Contract impact

- `slash-command-contract.md`
- `app-server-interaction-contract.md`

都已补充 `nextTurnFixed.collapseImpact` 的字段说明。
