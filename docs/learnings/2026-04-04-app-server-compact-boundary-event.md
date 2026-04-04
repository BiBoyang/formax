# 2026-04-04 App-Server Compact Boundary Event

## 背景

在 `CCA-070` 之前，Formax 的 compact boundary 只存在于：

- persisted prompt history
- `/context` diagnostics payload

这意味着 app-server / Web 路径虽然最终能在 session/history 里“看到” boundary，
但 live turn 期间并没有一个明确的 compact-boundary 协议事件。

结果就是：

- compact boundary 对跨端来说更像“事后从 history 推出来的状态”
- 而不是一个正在发生的协议事件

## 这轮做了什么

这轮把最小 compact boundary 事件接进了 app-server `turn/event`：

- `event.type = "compact_boundary"`
- `event.boundary = compactBoundary metadata`

同时 canonical adapter 现在会把它映射成：

- `system_message`
- `uiKind = "compact_boundary"`

这样 app-server / Web 路径在 live turn 期间就已经能识别 compact boundary 语义。

## 为什么这轮只做 boundary event，不顺手做完整 compact UI

因为 `CCA-070` 的目标是先把**协议语言**补齐，不是立刻把所有 compact transcript UI 一次性搬到 app-server。

这轮刻意不做：

- 完整 compact summary / compact banner 的全协议化重放
- Web 端专门的 compact 面板
- resume / session restore 的 boundary-aware 恢复

这些会分别落到后续：

- `CCA-071`
- 更后面的 cross-surface / UI parity 切片

## 一句话总结

这一步把 compact boundary 从“只存在于历史和 diagnostics 里的 metadata”推进到了“app-server live event protocol”。
