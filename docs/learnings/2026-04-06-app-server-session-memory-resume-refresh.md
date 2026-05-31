# 2026-04-06 App-Server Session Memory Resume Refresh

## 背景

上一轮我们已经让 REPL `/resume`、CLI `resumeLast` 和 SDK file-backed `resume/continue` 在恢复 active history 后刷新 rolling session memory sidecar。

但 app-server `thread/resume` 仍然停留在：

- 恢复 thread summary
- 恢复 stale inputs

还没有把 `.memory.json` 一起追平。

## 这次做了什么

这次把 app-server `thread/resume` 也接进了同一条 best-effort sidecar refresh 语义：

1. `ThreadStore.resumeThread()` 在找到 session 文件后
2. 继续按原来的路径恢复 summary + stale inputs
3. 同时后台读取 replay
4. 基于 boundary-aware active history 刷新 `.memory.json`

当前相关实现：

- `packages/core/src/app-server/threadStore.ts`
- `packages/core/src/features/repl/sessionRestore/sessionMemory.ts`

## 为什么这里不阻塞 resume 返回

`thread/resume` 当前的权威职责仍然是：

- 找回 thread
- 给出 stale inputs

sidecar 刷新只是为了让后续 memory-first auto compact / diagnostics 更快得到最新 session memory。

因此这轮刻意保持为：

- fire-and-forget
- best-effort
- 失败不影响 RPC 成功返回

## 当前仍然保守的地方

- app-server `thread/resume` 刷新 sidecar 仍然使用 `mode = normal`
- 也仍然使用 `planPath = null`
- 这轮没有把 session memory 直接暴露到 `thread/resume` 响应体

也就是说，这一刀的目标只是让 app-server 恢复链不再落后于 REPL / CLI / SDK，而不是扩展 app-server 协议面。
