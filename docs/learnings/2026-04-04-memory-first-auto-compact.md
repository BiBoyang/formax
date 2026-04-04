# Memory-First Auto Compact

日期：2026-04-04

## 背景

`CCA-050` 已经把 session memory draft schema 定下来了，`CCA-051` 也已经把 rolling session memory sidecar 挂到了 turn completion 后台刷新。

但在这之前，auto compact 仍然只有一条路径：

1. 直接调用 model summary compact
2. 用 summary + tail 重建 history

这意味着 rolling session memory 虽然存在，但还没有真正参与上下文压缩主链路。

## 这次调整

本轮把 auto compact 升级为 memory-first fallback chain：

1. 先尝试读取当前 session `.memory.json` sidecar
2. 如果 sidecar 可用，就直接用 rolling session memory 生成 compact summary
3. 沿用现有的 keep strategy / rehydration / compact boundary 机制重建 history
4. 如果 sidecar 缺失、不可读或无法生成有效 summary，则静默回退到原来的 model summary compact

## 为什么这样做

这样做的核心价值不是“少调一次模型”本身，而是把 compact 体系补成更像 Claude Code 的后半段：

- session memory 不再只是离线 sidecar
- auto compact 开始优先复用持续维护的工作记忆
- compact 协议、keep 策略、rehydration 不需要再造第二套实现

换句话说，这一轮学到的是：

> session memory 应该优先改变 compact 的 summary 来源，
> 而不是先引入一条平行的 history rebuild 流程。

## 边界与取舍

这次仍然刻意保持了几个边界：

1. 手动 `/compact` 还不走 session memory
2. resume / continue 还不消费 sidecar
3. session memory compact 当前仍复用现有 compact boundary 协议，只把 `summaryKind` 标成 `session_memory`
4. 若 sidecar 不可用，不记录一次可见的 compact_failed，再去 fallback；而是直接静默回退，避免一个 auto compact 产生误导性的失败事件

## 实现上的关键点

1. `contextCompressionService` 负责选择 compact 路径：session memory first，model summary second。
2. session memory compact 不重新发模型请求，而是把 `SessionMemoryDraft` 渲染成 summary 文本。
3. rehydration 优先使用 session memory 中的 active task 字段，但会对缺失字段回退到当前实时 rehydration 结果，避免把仍然有效的 plan/todo 信息意外清空。
4. compact boundary 的 `summaryKind` 现在允许 `session_memory`，供 diagnostics / persistence / app-server 后续识别。

## 还没做的部分

这轮还没有解决这些问题：

1. resume / continue 如何消费 rolling session memory
2. memory-first auto compact 的更多策略选择（比如何时跳过 sidecar，何时强制 model summary）
3. diagnostics 中更细的 compact lifecycle 对比
4. partial compact / reactive compact

这些属于后续 `CCA-060+` 的范围。
