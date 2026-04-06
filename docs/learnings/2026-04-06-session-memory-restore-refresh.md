# 2026-04-06 Session Memory Restore Refresh

## 背景

rolling session memory sidecar 之前只会在 turn completion 后后台刷新，并被 auto compact 读取。
这意味着一个刚刚 `/resume` / `resumeLast` / SDK `resume` 回来的会话，如果 sidecar 缺失或过旧，下一轮仍然拿不到最新 session memory。

## 这次做了什么

这次把 sidecar 刷新接进了 restore 链，但保持为 best-effort：

1. REPL `/resume`
2. CLI `resumeLast`
3. SDK file-backed `query(..., { resume })`
4. SDK file-backed `query(..., { continue: true })`

在这些路径恢复出 boundary-aware active history 后，会立即基于这份 active history 重建 `.memory.json` sidecar。

当前相关实现：

- `packages/core/src/features/repl/sessionSave/sessionMemoryRefresh.ts`
- `packages/core/src/features/repl/controller/session/sessionTransitions.ts`
- `packages/core/src/runtime/bootstrap/session.ts`
- `packages/core/src/sdk/query/resume.ts`

## 为什么这里刷新的是 active history，而不是 replay.history

session memory 需要描述“下一轮真正继续工作的工作记忆”，不是完整原始 replay。

因此这里复用的是：

- compact boundary-aware restore 之后的 active history

而不是：

- 原样完整 replay.history

这样 sidecar 才能和后续 memory-first auto compact 保持语义一致。

## 这轮刻意保持的边界

- sidecar 仍然不是权威历史；JSONL replay 仍然是唯一权威来源
- restore 过程中 sidecar 刷新失败不会中断主流程
- 当前只把 sidecar 刷新接进恢复链，还没有把 session memory 直接注入 resume 后的 prompt 组装
- CLI / SDK 当前恢复路径默认按 `mode = normal`、`planPath = null` 刷新，这是保守最小版本；REPL `/resume` 会传当前真实 mode 与 planPath
