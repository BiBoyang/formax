# 2026-04-04 boundary-aware session restore

## 背景

Formax 已经把真实 prompt 视图切到了“最近 compact boundary 后的 continuation view”。  
但在这之前，几条恢复路径仍然会直接把 `replay.history` 原样当作下一轮 active history：

- REPL `/resume`
- CLI `resumeLast`
- SDK `query(..., { resume })`
- SDK `query(..., { continue: true })`

这会带来一个语义分叉：

1. live turn 时，模型看到的是 boundary-first continuation view
2. restore 后第一轮，模型看到的却可能是完整 replay.history

这会让 compact 语义在恢复链路上失真，也会让后续 partial compact 更难成立。

## 这次收敛了什么

这次把“从 persisted replay 恢复 active history”的逻辑统一到了同一个 helper：

- `buildActiveHistoryFromSessionReplay(...)`

当前语义很明确：

1. session JSONL replay 仍然原样权威
2. compact boundary 本身不会进入恢复后的 active history
3. 最新 boundary 之后的 compact summary + preserved tail 会继续保留
4. 没有 boundary 时，退化为“去掉 boundary message 后的完整 history”

## 为什么这样更稳

这样做的好处是：

1. live prompt、resume、continue 的 active baseline 终于统一
2. compact boundary 不再只是“写进持久化但恢复时不认”的半协议
3. preserved segment / partial compact 之后有了更稳定的恢复前提

## 仍然没做的部分

这次没有把 rolling session memory sidecar 接进 resume / continue。  
也就是说：

- 现在是 **boundary-aware restore**
- 还不是 **memory-first restore**

这是刻意留给后续切片处理的，避免把 session replay 权威性和 sidecar 消费一次混在一起改。
