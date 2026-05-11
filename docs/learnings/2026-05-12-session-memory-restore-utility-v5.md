# 2026-05-12 - Session-memory restore utility v5

- canonical `resolveSessionMemoryRestoreArtifacts()` 现在除了 `nextTurnInjectedBlocks` 之外，也会产出结构化 `pendingSessionMemoryRestore` 摘要；这保证 restore reminder blocks 和 restore utility surface 继续共用同一条 best-effort sidecar 读取路径。
- app-server `thread/resume` 当前会直接返回 `pendingSessionMemoryRestore`；如果 restore 后的 next-turn-only reminder 还没有被成功消费，`thread/replay` 也会在 pending 窗口内暴露同一份摘要。
- 这份摘要只携带 bounded task-state utility：`mode`、`recentFiles`、`recentUserPrompts`、`planPath`、`planExcerpt`、`todoSummary`。它不是新的 persisted authority，也不会替代 canonical session JSONL / replay。
- restore utility 的生命周期仍然和服务端缓存的 reminder blocks 绑定：下一次成功的 `turn/start` / turn-dispatch 消费掉 pending injected blocks 后，`pendingSessionMemoryRestore` 也会一起清空。
