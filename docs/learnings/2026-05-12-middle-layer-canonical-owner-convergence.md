# 2026-05-12 - Middle-layer canonical-owner convergence

## 背景

`CCA-143 ~ 146` 完成后，Formax 已经有了 canonical query-time middle-layer stack，但 `contextCompressionService.ts` 周边仍保留几条 stack 外的历史正规化路径：

1. post-compact 后的 persisted baseline materialization
2. reactive retry 前的 compacted-history normalization
3. manual compact 返回值的 post-processing
4. post-turn finalization

这些路径会各自手工串联 `microcompact` / `prune` helper，导致两个问题：

1. stack 不是 surrounding flow 的唯一 owner
2. terminal `prune` 容易被误写回 future-turn persisted history

## 决策

`CCA-152` 之后，`contextCompressionService` 里的 surrounding flow 改为优先复用 canonical middle-layer stack 来 materialize persisted baseline：

1. `runReactiveCompact()` 直接在 compacted history 上运行 canonical stack，并同时拿到：
   - persisted `history`
   - request-only `requestHistory`
   - prepared trailing user
2. `runManualCompact()` 返回 canonical stack 的 persisted-history candidate，而不是 terminal-pruned request payload
3. `finalizeHistoryAfterTurn()` 也改为取 canonical stack 的 persisted-history candidate
4. `prepareHistoryForTurn()` 仍保留 auto-threshold 前的轻量 microcompact 预处理，但 auto-compact 之后的 persisted baseline materialization 已切回 canonical stack

## 结果

这样做之后，terminal `prune` 的角色重新收敛为：

- 只负责 `assembled_request_envelope` 的 request-time hard cutoff
- 不再负责 future-turn persisted baseline 的 materialization

这让 persisted/request-only 边界更清楚，也为后续 `CCA-153` 的 compact protocol remote / restore alignment 留下更干净的 owner 结构。
