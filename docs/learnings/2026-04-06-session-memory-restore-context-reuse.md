# Session Memory Restore Context Reuse

日期：2026-04-06

## 背景

此前 rolling session memory sidecar 已经会在这些恢复入口成功后做 best-effort 刷新：

- REPL `/resume`
- CLI `resumeLast`
- SDK file-backed `resume`
- SDK file-backed `continue`
- app-server `thread/resume`

但非 REPL 恢复链在刷新 sidecar 时，默认会把 `mode` 写成 `normal`、`planPath` 写成 `null`。  
这意味着只要恢复入口自己拿不到更丰富的上下文，刷新后的 sidecar 就可能把先前 session memory 中已经存在的工作态降级掉。

## 本次调整

新增共享 restore-context helper：

- `packages/core/src/features/repl/sessionSave/sessionMemoryRefresh.ts`

恢复路径现在会：

1. 先 best-effort 读取已有 `.memory.json`
2. 尝试提取其中的 `activeTask.mode` 与 `activeTask.planPath`
3. 当恢复入口自身只提供默认值时，优先沿用 sidecar 中已有的 `mode` / `planPath`
4. 若 sidecar 缺失、不可读或 shape 不合法，再回退到入口提供的默认值

当前接线范围：

- `packages/core/src/runtime/bootstrap/session.ts`
- `packages/core/src/sdk/query/resume.ts`
- `packages/core/src/app-server/threadStore.ts`

REPL `/resume` 仍然优先使用实时 REPL 状态，本次没有改这条链的优先级。

## 为什么这样更稳

这次调整不是把 sidecar 提升为权威历史来源。  
JSONL replay 仍然是唯一权威历史来源。

它解决的是另一类问题：

- 恢复后我们会立即刷新 sidecar，方便下一轮继续复用 memory-first auto compact
- 但刷新本身不应该把已有 session memory 中的工作态“抹平”

所以这里更像是：

- 用 replay 恢复 active history
- 用 sidecar 补回恢复入口缺失的最小工作态

这使得 restore-side refresh 更接近“延续当前 session memory”，而不是“用默认值重写它”。
