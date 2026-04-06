# Request History Projection Seed

日期：2026-04-06

## 背景

此前 Formax 已经有：

- persisted history / replay / resume
- boundary-first continuation view
- session memory
- partial compact
- reactive compact

但 `context collapse` 仍然被判定为 runtime NO-GO，核心原因是：

> `ChatEngine.runTurn(history, ...)` 这条链会把“本轮发给模型的历史”和“后续持久 loop history”绑在一起。

这样一来，只要把 collapse 接在主 history 路径上，原本想做的 request-time projection，就很容易退化成 persisted history 改写。

## 本次调整

`ChatEngine.runTurn(...)` 现在新增了可选参数：

- `requestHistory?: ChatHistory`

语义变成：

- `history`：持久 loop 的基线；最终返回值仍然以它为基础继续追加 assistant / tool 结果
- `requestHistory`：仅作为本轮模型请求的投影视图种子

内部现在维护两套并行消息数组：

1. `loopMessages`
   - 负责 persisted history / return value
2. `requestLoopMessages`
   - 负责本轮 prompt assembly

当前如果没有显式传 `requestHistory`，行为与旧实现完全一致，会退化为：

- `requestHistory ?? history`

## 为什么这一步重要

这不是 collapse 本身，但它补上了一个非常关键的前置条件：

> 我们终于可以只改变“这轮发给模型看的历史”，而不必同步改写后续持久 history。

这意味着后续如果要接 context collapse MVP，就有了更安全的挂载方式：

- collapse 作用于 `requestHistory`
- persisted history 继续保持原样

## 当前边界

这次还没有真正启用 collapse，也没有引入 collapse store。

目前只是：

1. engine 支持 request projection seed
2. REPL send 主链开始显式透传 `requestHistory`
3. `contextCompressionService` 也开始在返回值上区分 `history` / `requestHistory`

也就是说：

- **现在可以开始安全设计 context collapse MVP**
- 但 **还没有真正把 collapse 接进 runtime**
