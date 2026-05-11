# 2026-05-11 - Middle-layer stage contract

## 背景

在 `CCA-140 ~ 142` 之后，Formax 已经有了共享的 query-time middle-layer stack、独立的 tool-result budget strategy，以及 cache-aware `microcompact`。但 stage 的角色、顺序和 envelope 边界仍然主要隐含在实现里，不属于 canonical contract。

这会带来两个问题：

1. `/context`、runtime、以及后续 app-server / Web surface 容易再次漂移
2. 后续引入 `snip` 或更深的 stage coordination 时，容易重新退化成“先找地方插逻辑”

## 调整

新增 `docs/contracts/context-strategy-stack-contract.md`，把以下内容正式提升为唯一事实源：

1. 当前 middle-layer stages：
   - `microcompact`
   - `tool_result_budget`
   - `collapse`
   - `prune`
2. stage 角色：
   - `budget_reducer`
   - `semantic_projection`
   - `terminal_fallback`
3. 规范顺序：
   - `microcompact -> tool_result_budget -> collapse -> prune`
4. request-time projection 与 persisted-history 的作用域边界
5. `prune` 的 terminal fallback 身份

## 结果

这次还没有改 runtime 行为；它先解决的是“contract 缺位”问题。后续 `CCA-144` 的实现不再需要边改代码边发明 stage 语义，而是直接收敛到 canonical contract。
