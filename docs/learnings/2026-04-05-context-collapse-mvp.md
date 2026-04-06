# 2026-04-05 context collapse evaluation

## 背景

在补完：

1. `microcompact`
2. memory-first auto compact
3. partial compact
4. reactive compact

之后，Formax 在“轻量减压”和“重型 compact”之间仍然有一段明显空档。

Claude Code 这段空档不是直接靠 full compact 填上的，而是还有：

- tool-result budget replacement
- context collapse / projectView
- 更细的中间层减压

`CCA-063` 的目标就是明确：

> Formax 是否也需要一个位于 `microcompact` 与 full compact 之间的中间层。

## 结论

这次的明确结论不是“继续无限评估”，而是：

> **当前主线先不把 context collapse 接进 runtime。**

也就是说，`CCA-063` 的技术判断已经完成，但结果是：

- 现在 **NO-GO**
- 不进入主请求链
- 下一步主线前推到 diagnostics phase 2

## 为什么先选这个形态

因为 Claude Code 的完整 collapse 体系依赖：

- projectView
- collapse commit log
- persisted archive / restore
- richer `/context` 可视化

这些能力如果一次性搬进 Formax，复杂度会明显超过当前主线需要。

我们确实做过一个 MVP 方向的尝试：

1. 在 `microcompact` 与 full compact 之间插入一个 read-time `contextCollapse`
2. 只折叠较早 continuation，保留最新 working-set tail
3. 用确定性的 `<system-reminder>` recap 代替较老片段

但 review 很快暴露了一个关键问题：

> **以当前 `ChatEngine.runTurn()` / `historyRef` 写回模型来看，这层一旦挂到主 history 路径，就会从“request-time projection”退化成“持久 history 改写”。**

这不是小瑕疵，而是语义级风险：

1. 用户旧上下文会被 synthetic recap 永久替换
2. session replay / resume 会看到被改写后的 history，而不是原始 continuation
3. 这和我们原本想要的“只影响这一轮请求、不改 persisted history”相矛盾

## 当前为什么判定 NO-GO

因为要把它做成真正安全的 read-time layer，至少还需要其中一类能力：

1. **engine 级 request-view / persisted-history 分离**
2. **独立 collapse store / projectView / restore 协议**
3. **更明确的 continuation projection 生命周期**

在这些前置条件缺失时，直接把 collapse 接进 runtime，风险大于收益。

## 还没有做的部分

当前依然没有：

1. collapse store / persisted collapsed spans
2. cached collapse
3. collapse-specific diagnostics 字段
4. collapse drain / overflow recovery
5. richer client visualization
6. request-view 与 persisted-history 的正式分离

所以这次留下来的不是 runtime 功能，而是一条明确的工程判断：

> **在 Formax 当前架构下，context collapse 还不能安全地直接进入主链。**
