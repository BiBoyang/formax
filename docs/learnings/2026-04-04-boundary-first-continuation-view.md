# 2026-04-04 Boundary-First Continuation View

## 背景

Formax 已经有 explicit compact boundary，但主路径里真实送给模型的消息视图仍然只是“把 boundary message 过滤掉”，还没有真正切到“最近 compact boundary 后的 continuation view”。

这会带来两个问题：

1. 如果历史里已经出现多次 compact，旧 summary + 旧 tail 仍可能继续参与 prompt 估算与模型调用。
2. `/context` 和真实 prompt 视图可能对“当前有效历史”给出不同直觉，不利于后续 partial compact / resume 对齐。

## 这轮调整

这轮把共享 continuation-view helper 收敛到 `packages/core/src/chat/context/compact.ts`：

- `findLatestCompactBoundaryIndex(...)`
- `getContinuationMessagesAfterLatestCompactBoundary(...)`

然后统一接到：

- `packages/core/src/chat/engine.ts`
- `packages/core/src/chat/context/estimate.ts`
- `packages/core/src/chat/context/contextDiagnostics.ts`

## 结果

当前如果 history 中存在 compact boundary：

- 真实 prompt 视图只会使用“最近 boundary 后”的 continuation messages
- boundary 自身不会进入模型可见消息
- `/context` snapshot 与 token estimate 也会沿用同一 continuation view

如果不存在 boundary，则继续退化为全 persisted history。

## 为什么这一步重要

这是 partial compact 之前的必要地基。

如果没有 boundary-first continuation view：

- compact boundary 只是 metadata 标记
- partial compact 很难真正改变主路径 prompt 视图
- resume / diagnostics / app-server 也更难共享同一语义

所以这一步虽然改动不大，但它把 compact boundary 从“记录事件”推进到了“真实参与 prompt 视图选择的协议锚点”。
