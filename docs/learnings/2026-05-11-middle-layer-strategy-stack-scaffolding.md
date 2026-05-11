# 2026-05-11 - Middle-layer strategy stack scaffolding

## 背景

在 `CCA-140` 之前，query-time 的 `microcompact`、`prune`、`collapse` 已经都存在，但 runtime send-path 与 `/context` next-turn diagnostics 仍然分别串联这些步骤。这样虽然行为接近，但 shared facts 并没有明确 owner，后续若继续引入新的中间层策略，发送链和 diagnostics 容易再次漂移。

## 调整

新增 `packages/core/src/chat/context/middleLayerStrategyStack.ts` 作为共享执行层，先统一三件事：

1. `microcompact`
2. `prune`
3. `collapse`

该 helper 当前负责：

- 接收 query-time prepared view 所需的上下文
- 统一计算 pressure ratio 与 adaptive microcompact policy
- 统一产出 request-time prepared history / messages
- 统一归档 `strategyFacts`（microcompact / prune / collapse）

`contextCompressionService.ts` 与 `contextDiagnostics.ts` 现在都复用这一层，而不是分别手写同一套 orchestration。

## 边界

这次只是 scaffolding，不引入新的压缩策略，也不改变 persisted history 语义。

明确不做：

- tool-result budget replacement
- snip layer
- persisted collapse store
- 新的 reactive overflow 策略

这些留给后续 `CCA-141+`。

## 结果

这次调整把 Formax 的 query-time middle layer 从“发送链里的若干步骤”推进成了“有共享 owner 的策略执行层”。这为后续增加独立策略栈打下了结构基础，也减少了 runtime 与 diagnostics 在策略执行和 fact 记账上的再次漂移风险。
