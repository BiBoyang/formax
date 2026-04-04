# Partial Compact No-Go Checkpoint

日期：2026-04-04

## 结论

当前 Formax **还不适合直接进入 partial compact runtime 实现**。

这不是因为压缩能力不够多，而是因为 partial compact 依赖的协议层还没成熟。

## 为什么现在先做 go/no-go，而不是直接写代码

partial compact 的真实难点不是“再做一个更聪明的 summary”，而是：

- prompt 真实视图是否已经 boundary-first
- compact 后保留段是否有 preserved segment metadata
- session restore / resume 是否能正确恢复 compact 语义
- app-server / Web 是否能识别 compact boundary 事件

如果这些前置条件没补齐，partial compact 很容易把问题从“压缩策略”升级成：

- history relink 错乱
- resume 后 continuation view 不一致
- 跨端 replay 分叉
- diagnostics 看得到 boundary，但解释不了结构

## 当前 blocker

当前确认的 blockers 是：

1. `CCA-022`：boundary-first prompt view
2. `CCA-023`：preserved segment metadata
3. `CCA-070`：app-server compact boundary protocol
4. `CCA-071`：session persistence / resume boundary-aware restore

## 这次学到的原则

> partial compact 不是“压缩更细一点”这么简单。  
> 它本质上是 compact 协议、history relink、resume restore、cross-surface parity 的综合题。

所以正确顺序应该是：

1. 先把 boundary 变成真正可恢复、可跨端理解的协议
2. 再做 partial compact 的最小 runtime

## 落地结果

这次没有引入 runtime 代码；产出的是一份正式 checklist：

- `plans/context-compression-alignment-loop/CCA-060-partial-compact-go-no-go.md`

它的作用是让后面的 `CCA-061` 不再靠“感觉差不多可以做了”，
而是按 blocker 清单逐项解锁。
