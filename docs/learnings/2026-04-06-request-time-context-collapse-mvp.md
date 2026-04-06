# 2026-04-06 request-time context collapse MVP

## 背景

在补完 `requestHistory` 与 persisted `history` 的显式分层后，Formax 终于具备了一个安全的 request-only 投影挂载点。

之前 `context collapse` 一直不能进 runtime，不是因为 recap 逻辑写不出来，而是因为它一旦直接挂进主 history 路径，就会从“本轮请求视图优化”退化成“持久 history 改写”。

## 这次做了什么

这次上线的是一个**非常保守的 MVP**：

- 只在 `prepareHistoryForTurn()` 里生成更短的 `requestHistory`
- persisted `history` 保持原样
- 只在存在 latest compact boundary 时尝试 collapse
- 只折叠 continuation 的较老 head，保留最近 user turns 对应的 tail
- recap 使用 deterministic `<system-reminder>`，不引入模型总结或新的持久状态

## 当前形态

实现入口：

- `packages/core/src/chat/context/contextCollapse.ts`
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`

当前 collapse helper 的职责是：

1. 找到 latest compact boundary 后的 continuation
2. 保留最近两个 non-tool user turns 对应的 tail
3. 把更早的 continuation head 改写成一条 request-only recap message
4. 只有在 recap 真能省下一定 token 时才启用

## 为什么没有复用 full compact 的 tail 选择器

我们一开始尝试直接复用 `selectTailForCompaction()`，但它带有 full compact 的 working-set anchor 语义，尤其会因为最近成功 `Read` 回卷更多 turn。

对 full compact 这是合理的；但对 request-time collapse 来说，这会让整个 continuation 都被保留下来，collapse 事实上永远触发不了。

所以这次 MVP 改成了更窄的 collapse-specific tail 规则：

- 仅按“最近两个 non-tool user turns”截 tail
- 不复用 full compact 的 read-anchor 回卷

## 当前刻意不做的事

这次没有引入：

1. collapse store / archived span metadata
2. persisted collapsed spans
3. replay / resume 专门的 collapse 恢复协议
4. diagnostics 上的 collapse-specific payload 字段
5. reactive/manual 路径的独立 collapse 策略

所以它仍然只是一个 **request-time projection MVP**，不是完整的 Claude Code 式 collapse 系统。

## 结果

这次真正落下来的工程结论是：

> Formax 现在已经可以安全做 request-time context collapse，
> 但它仍然是“只影响本轮 prompt 视图”的中间层，
> 还不是一个带 persisted store 的完整 collapse 协议。
