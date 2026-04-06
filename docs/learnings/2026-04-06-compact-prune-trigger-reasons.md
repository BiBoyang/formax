# 2026-04-06 compact / prune trigger reasons

`CCA-012` 这轮把 `/context` diagnostics 从“只看结果数字”推进到了“也能解释为什么”。

## 这轮补了什么

1. `latestCompactBoundary` 现在可以携带结构化 `triggerReason`
   - `auto_threshold`
   - `manual`
   - `reactive_error`
2. `nextTurnFixed` 现在会额外给出：
   - `autoCompactSkipReason`
   - `pruneSkipReason`

## 这轮最关键的对齐点

这些 reason 字段如果不按真实运行时顺序推导，很容易“看起来完整，但其实误导”。

这轮专门修了两个语义坑：

1. `autoCompactSkipReason` 必须基于 **pre-prune** 的判断输入推导
   - 因为 runtime 是先判断 auto compact，再进入 prune
   - 如果拿 post-prune total 来解释 auto compact，会把“其实会 compact”的情况误报成 `below threshold`

2. `pruneSkipReason` 不能只看最终 post-prune total
   - 因为 prune 成功后，最终 total 往往已经回到 effective limit 以内
   - 这时如果直接说 `within effective limit`，会误把“prune 已经生效”解释成“prune 被跳过了”

所以这轮最终的语义是：

- `autoCompactSkipReason`：解释为什么当前可见前置条件下没有进入 auto compact
- `pruneSkipReason`：解释为什么 prune 被跳过；若 prune 已经发生，则该字段为 `null`

## 跨端契约

这轮还补齐了 Web 严格 parser：

- `triggerReason`
- `autoCompactSkipReason`
- `pruneSkipReason`

这样 diagnostics 不会出现 TUI text 能看到、Web 结构化 payload 却 silently 丢掉的分叉。
