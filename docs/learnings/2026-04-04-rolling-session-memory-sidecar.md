# 2026-04-04 Rolling Session Memory Sidecar

## 背景

`CCA-050` 已经把 session memory 的 draft schema 定下来了，但它还只是一个 builder / merge 规则集合。
如果没有持续更新路径，它仍然更像一个“将来可能会用到的对象模型”，而不是 rolling memory layer。

## 这次做了什么

这次新增了一条最小、低风险的 rolling memory 刷新路径：

1. turn 完成（loading -> idle）后
2. 在后台异步调度 `persistRollingSessionMemory(...)`
3. 基于当前 `history`、`mode`、`planPath` 构建最新 `SessionMemoryDraft`
4. 把结果写到与 session JSONL 相邻的 `.memory.json` sidecar

当前相关实现：

- `packages/core/src/features/repl/controller/session/sessionTurnCompletion.ts`
- `packages/core/src/features/repl/controller/session/sessionRollingMemory.ts`
- `packages/core/src/features/repl/sessionSave/sessionMemorySidecar.ts`

## 为什么用 sidecar，而不是直接塞进 JSONL

这一轮的目标是先建立 rolling memory 的“持续更新能力”，不是马上重构 session replay 格式。

用 sidecar 的好处：

1. 不影响现有 JSONL replay / resume 权威路径
2. 不需要修改 reader 才能先把 memory 刷新起来
3. 后续如果要接入 auto compact / resume，可以逐步消费 sidecar，而不是一次性改 session 文件语义

## 当前刻意没做

- 没有把 `.memory.json` 读入 resume / continue
- 没有让 auto compact 优先消费 rolling memory
- 没有把 sidecar 暴露到 app-server 协议
- 没有做 sidecar 缺失 / 损坏时的高级恢复策略

这些属于后续 `CCA-052` 以及更后的 session persistence / protocol parity 工作。
