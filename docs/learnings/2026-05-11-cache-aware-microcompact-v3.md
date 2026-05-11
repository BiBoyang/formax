# 2026-05-11 cache-aware microcompact v3

## Summary

`CCA-142` 把 `microcompact` 从 family-aware / threshold-aware 推进到了 cache-aware path：

- 运行时现在会识别重复的 cache-like lookup 结果
- 较老、重复、且达到最小 cache-aware 体量阈值的结果，可以在 request-time 更早被 stub 掉
- `/context` 与 runtime 复用同一套 policy/facts，不再各自推导

## What changed

1. `microCompactHistory()` 新增 cache-aware duplicate path
   - 当前覆盖 `Read` / `Grep` / `Glob` / `WebFetch`
   - 命中条件是：同 lookup key + 同原始结果文本 + 达到 cache-aware 最小字符阈值
2. `AdaptiveMicroCompactPolicy` 新增：
   - `cacheAwareEligibleToolNames`
   - `cacheAwareMinResultChars`
3. `MicroCompactImpact` 新增：
   - `cacheAwareEligibleToolNames`
   - `cacheAwareMinResultChars`
   - `cacheAwareCompactedBlocks`
   - `cacheAwareToolNames`
4. shared `middleLayerStrategyStack`、`/context` diagnostics、Web strict parser 全部透传这组事实

## Why it matters

之前 `microcompact` 虽然已经有 tool family 和 per-tool threshold，但它仍然主要按“单块结果是否够大”做判断。

这次之后，系统开始能回答另一类问题：

> 这条工具结果本身不算特别大，但它和前面已经看过的同类结果完全重复，是否值得更早 request-time 清掉？

这让 `microcompact` 开始具备更成熟的 query-time 中间层特征，而不是只做统一阈值的旧结果 stub。

## Guardrail

这次改动仍然严格保持：

- 只作用于 request-time projection
- 不改 persisted `history`
- 不替代 `CCA-141` 的独立 tool-result budget strategy

也就是说：

- tool-result budget 继续负责“tool-result group 预算”
- cache-aware microcompact 继续负责“较老重复 lookup 结果的更早 stub”

两层语义不重叠。
