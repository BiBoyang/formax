# 2026-05-11 - Middle-layer terminal prune fallback

## 背景

`CCA-140 ~ 142` 之后，Formax 已经有了 middle-layer strategy stack、独立的 tool-result budget replacement、以及 cache-aware `microcompact`。但 runtime 里的实际执行顺序仍然把 `prune` 放在中途，这会模糊它和 reducers / projection stages 的边界。

## 调整

`CCA-144` 的 runtime 第一刀没有新增策略，而是先把现有 stages 收敛到 canonical contract：

1. `microcompact`
2. `tool_result_budget`
3. `collapse`
4. `prune`

同时把两条 envelope 语义收紧：

1. `collapse` 继续保持 request-only
2. `prune` 改成最后的 terminal fallback，只作用于最终 request envelope
3. `prepareHistoryForTurn()` 返回的 persisted baseline 不再吃 request-only `prune`

## 结果

这次改动的价值不在于增加新的压缩技巧，而在于把现有 middle-layer stack 从“有几个步骤”推进成“有明确阶段语义的系统”：

1. reducers 先运行
2. projection 再运行
3. terminal fallback 最后兜底

这样后续再加 `CCA-145` coordination facts 或更晚的 `snip`，不会重新退化成 send-path 里的隐含分支。
