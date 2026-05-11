# 2026-05-11 - Middle-layer control-plane diagnostics

## Context

`CCA-145` 已经让 `middleLayerStrategyStack` 暴露了 canonical `strategyCoordination` facts。  
但这些 facts 仍然更像逐 stage 明细，而不是一个真正可消费的 stack control plane。

## Decision

在 `nextTurnFixed` diagnostics 上新增 `strategyControlPlane`，并让 text report 先展示 control-plane summary，再展示逐 stage coordination rows。

当前 `strategyControlPlane` 的稳定摘要字段包括：

- `stageOrder`
- `appliedStages`
- `skippedStages`
- `terminalStage`
- `terminalDisposition`
- `dominantSavingStage`
- `dominantSavingTokens`

Web strict parser 也同步支持该 payload，避免 core / app-server / Web 对 control-plane 再各自定义一套摘要语义。

## Why

这一步的目标不是再加一个压缩策略，而是让现有 stack 真正变成“可消费的控制面”：

1. 先看 stack summary，再下钻逐 stage facts
2. 明确 terminal fallback 当前是谁、是否触发
3. 明确本轮哪个 stage 是主要节省来源
4. 避免客户端再用 scattered `impact` 字段拼自己的 stack 面板

## Consequences

- `strategyCoordination` 继续保留为逐 stage canonical facts
- `strategyControlPlane` 则作为 stack-level summary surface
- 未来若继续做 richer client control plane 或 `snip`，应该先扩 canonical stage facts，再扩 control-plane summary
