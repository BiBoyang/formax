# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-05-12

## 当前主线

- 下一阶段执行清单：
  - [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)

## 当前推荐顺序

1. post-`CCA-163` mainline re-rank

## 说明

- `CCA-080` ~ `CCA-085` 与 `CCA-090` 这一波已经完成。
- `CCA-100` / `CCA-110` / `CCA-111` / `CCA-112` 已完成。
- `CCA-120` / `CCA-121` / `CCA-122` / `CCA-123` 这一波也已经完成，当前主线已切换。
- `CCA-130` / `CCA-131` / `CCA-132` 已完成，post-132 重排也已完成。
- `CCA-140` / `CCA-141` / `CCA-142` 已完成。
- `CCA-143` / `CCA-144` / `CCA-145` / `CCA-146` 已完成，当前 14x wave 已收口。
- `CCA-150` 已完成，working-set selector 现已按 anchor kind 区分 backtrack window，并把 `anchorMaxBacktrackTurns` 暴露到 diagnostics。
- `CCA-151` 已完成，app-server `thread/resume` 现在也会复用 canonical restore artifacts，并把 session-memory reminder 作为 next-turn-only injected blocks 在服务端消费一次。
- `CCA-152` 已完成，post-compact/manual/reactive/finalize 这些 surrounding flow 现在会复用 canonical middle-layer stack materialize persisted baseline；terminal prune 不再写回 future-turn history。
- `CCA-153` 已完成，app-server `thread/resume` 现在也会暴露 canonical `latestCompactBoundary`，Web runtime 会在 restore path 直接消费这份 compact protocol fact。
- post-`CCA-153` mainline re-rank 已完成。
- `CCA-160` 已完成，working-set selector 已从 filesystem-cluster-aware 推进到 task-minimal v5：当前会把 recent task planning/todo state 与 `task_execution_cluster`（例如 `Read + Edit + TodoWrite`）一起纳入 keep strategy，并把 `taskStateKinds` / `selectionReasons` 暴露到 diagnostics。
- `CCA-161` 已完成，session-memory restore utility 现在会通过 canonical restore-artifacts 路径生成结构化 `pendingSessionMemoryRestore` 摘要，并让 `thread/resume` / `thread/replay` 在 next-turn-only pending 窗口内共用这份 utility surface。
- `CCA-162` 已完成，`thread/replay` 现在会直接返回 canonical `latestCompactBoundary`，Web replay runtime 也会消费这份 compact protocol fact，并在 replay source 下继续显示 compact header。
- `CCA-163` 已完成，`microcompact` 现在已有基于 stale user-turn age 的 time-aware path：较旧且达到更低 time-aware 阈值的结果会更早进入 request-time stub，同时通过 `timeAware*` facts 暴露到 `/context` / app-server / Web strict parser。
- 当前 16x 波段已经完成，下一步先做 post-`CCA-163` mainline re-rank。
- 仍然不建议直接进入完整 collapse store / archived span 设计。
