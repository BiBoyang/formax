# 2026-05-11 - Tool-result budget replacement v1

## 背景

在 `CCA-140` 之后，Formax 已经有了共享的 query-time middle-layer strategy stack，但 `microcompact` 仍然同时承担“老旧大结果压缩”和“tool-result group 预算过大时先减压”两类职责。这样会继续模糊中间层边界，也会让 `/context` 很难把 tool-result budget 这层收益单独计账。

## 调整

新增 `packages/core/src/chat/context/toolResultBudget.ts`，作为第一条真正独立的新中间层策略。

当前 v1 的边界是：

1. 只作用于 request-time projection
2. 不改 persisted `history`
3. 单独对 tool-result group 计预算
4. 超预算时优先替换较老、可安全替换的 tool result，再把结果交给后续 `collapse`

这条策略当前通过 `middleLayerStrategyStack.ts` 接进 shared stack，并向 runtime / diagnostics 暴露统一的 `toolResultBudgetImpact` facts。

## diagnostics / contract

`/context` 现在会把这层收益单独表达出来：

- `nextTurnFixed.toolResultBudgetImpact`
- `nextTurnFixed.assembledLedger` 中新增：
  - `tool_result_group`
  - `tool_result_budget_savings`

这样客户端不用再把这部分收益误看成 `microcompact` 或 `collapse` 的副作用。

## 结果

`CCA-141` 的价值不在于一次性把所有 tool-result 压缩问题做完，而在于首次把“tool-result budget”从 `microcompact` 的隐含副作用提升成了独立中间层策略。这为后续 `cache-aware microcompact`、`snip layer`、以及更成熟的 request-time strategy stack 留出了清晰边界。
