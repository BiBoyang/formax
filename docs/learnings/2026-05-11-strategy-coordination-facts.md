# 2026-05-11 - Strategy coordination facts

## Context

`CCA-140` 把 middle-layer stack 收敛成 shared owner，`CCA-141/142` 又分别补了 `tool_result_budget` 和 cache-aware `microcompact`。  
到这一步，runtime 已经有多条 middle-layer strategy，但 `/context` 仍然主要依赖分散的 impact 字段来解释 stack。

## Decision

为 `middleLayerStrategyStack` 增加 canonical `strategyCoordination` facts，并把它接入 `nextTurnFixed` diagnostics：

- 每个 stage 统一暴露：
  - `stage`
  - `role`
  - `scope`
  - `disposition`
  - `terminal`
  - `advisory`
  - `reason`
  - `estimatedTokensSaved`
  - `inputTokens`
  - `outputTokens`
- `/context` text report 新增 `Middle-layer coordination` 小节
- Web strict parser 同步支持 `nextTurnFixed.strategyCoordination`

## Why

这样做解决的是结构性问题，不是再加一个新压缩技巧：

1. `/context` 不再需要从 `microCompactImpact`、`toolResultBudgetImpact`、`collapseImpact` 反推 stack 顺序
2. `prune` 的 terminal fallback 角色能以统一事实表达，而不是只靠文档说明
3. 后续 `CCA-146` 若要做 control-plane diagnostics，可以直接建立在 runtime facts 上，而不是重新定义另一套 stage 语义

## Consequences

- `CCA-145` 之后，middle-layer stack 的阶段顺序、角色与理由已经同时有：
  - canonical contract
  - runtime owner
  - diagnostics payload
  - Web typed parser
- 后续若新增 `snip` 或更深的 stage coordination，必须先扩 `context-strategy-stack-contract.md`，再扩 `strategyCoordination` shape
