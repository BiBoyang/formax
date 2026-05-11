# 2026-05-11 - Compact boundary client surface

- `thread/read` / `thread/messages` 与 Web parser 早就已经能传 `latestCompactBoundary`，但在 `CCA-132` 之前，Web runtime 并没有把这份 compact boundary state 像 `latestRequestCollapse` 一样缓存到 thread-scoped state。
- 这次的最小切片不是再扩协议，而是把现有 `latestCompactBoundary` 接进 client-side cache、display selector 和真实 UI surface。
- 当前 active thread header 已会在 `transcriptSource === 'history'` 时显示最新 compact 摘要：
  - `trigger`
  - `summaryKind`
  - `preTokens`
- 这样 compact protocol 现在不只在 `/context` 或 thread RPC payload 里可见，而是开始进入真实 client surface。
