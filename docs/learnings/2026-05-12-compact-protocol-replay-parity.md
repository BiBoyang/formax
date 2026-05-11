# 2026-05-12 - Compact protocol replay / inspection parity

- app-server `thread/replay` 现在会直接暴露 canonical `latestCompactBoundary`。这让 replay / inspection path 不再依赖 `thread/read`、`thread/messages` 或 `thread/resume` 侧带 compact summary。
- Web replay runtime 现在会消费这份 compact boundary，并把它写回 thread-scoped compact boundary cache；因此当 active transcript source 是 `replay` 时，现有 compact header 也能继续显示最近一次 compact protocol fact。
- 这次没有引入新的 compact authority model。`thread/replay` 上的 `latestCompactBoundary` 仍然来自同一条 canonical replay-backed compact protocol 来源，且会继续保留已有 `preservedSegment` / rehydration fields。
