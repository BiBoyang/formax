# 2026-05-12 time-aware microcompact v4

> Superseded note, 2026-05-21: this was the pre-cache-editing Formax design. The active contract now follows Claude Code-style cache-editing / cold-cache wall-clock assistant-gap semantics: warm-cache microcompact uses Anthropic request/API-only `cache_edits`, cold-cache time-based clearing uses assistant wall-clock gap, and when cache editing is unavailable plus cold-cache trigger has not fired, `microcompact` is no-op. See `docs/contracts/context-strategy-stack-contract.md` and `docs/learnings/2026-05-21-anthropic-cache-editing-microcompact.md`.

`CCA-163` 把 `microcompact` 从 cache-aware duplicate path 继续推进到 time-aware / stale-aware path。

这次没有引入真实时间戳，也没有新 reducer。实现选择的是更稳定的会话内代理信号：`stale user-turn age`。

## 这次做了什么

1. `microCompactHistory()` 现在会计算每个 eligible tool result 之后又经过了多少个非 tool-result 的 user turns。
2. 当结果满足更低的 time-aware 最小字符阈值，并且 stale user-turn age 达到当前 pressure tier 的门槛时，会更早被 stub。
3. cache-aware duplicate path 仍然优先；time-aware path 只在没有命中 duplicate cache key 时接管。
4. `/context`、app-server local diagnostics、以及 Web strict parser 现在都会稳定暴露：
   - `timeAwareEligibleToolNames`
   - `timeAwareMinResultChars`
   - `timeAwareMinStaleUserTurns`
   - `timeAwareCompactedBlocks`
   - `timeAwareToolNames`

## 为什么这样做

Claude Code 的成熟点之一，不只是“重复结果更早清理”，而是“当 cache 已冷、当前任务也已经走远时，旧结果应该更早退出工作集”。

当时 Formax 还没有 API cache-editing 这层能力，所以 v4 先采用最稳的本地判据：

- 不看 wall-clock time
- 不引入 persisted state
- 只看会话里已经稳定存在的 stale user-turn age

这样能把 `microcompact` 做得更像 task-aware / time-aware reducer，同时不改 persisted history 语义。

## 当前边界

1. 仍然只作用于 request-time projection。
2. 仍然保持 `microcompact` 的 reducer 角色，不改 compact protocol 或 persisted baseline。
3. 还没有引入真实时间衰减、cross-session age、或 provider cache state。

所以它是 `time-aware microcompact v4`，不是最终形态。
