# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-05-12

## 当前主线

- 下一阶段执行清单：
  - [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)

## 当前推荐顺序

1. `CCA-152` middle-layer canonical-owner convergence
2. `CCA-153` compact protocol remote / restore alignment

## 说明

- `CCA-080` ~ `CCA-085` 与 `CCA-090` 这一波已经完成。
- `CCA-100` / `CCA-110` / `CCA-111` / `CCA-112` 已完成。
- `CCA-120` / `CCA-121` / `CCA-122` / `CCA-123` 这一波也已经完成，当前主线已切换。
- `CCA-130` / `CCA-131` / `CCA-132` 已完成，post-132 重排也已完成。
- `CCA-140` / `CCA-141` / `CCA-142` 已完成。
- `CCA-143` / `CCA-144` / `CCA-145` / `CCA-146` 已完成，当前 14x wave 已收口。
- `CCA-150` 已完成，working-set selector 现已按 anchor kind 区分 backtrack window，并把 `anchorMaxBacktrackTurns` 暴露到 diagnostics。
- `CCA-151` 已完成，app-server `thread/resume` 现在也会复用 canonical restore artifacts，并把 session-memory reminder 作为 next-turn-only injected blocks 在服务端消费一次。
- 当前重点已经从“继续打磨 collapse 的最小消费面”转向：
  - middle-layer stack 周边 flow 的 canonical-owner convergence
  - compact protocol 的 remote / restore ecosystem 对齐
- 仍然不建议直接进入完整 collapse store / archived span 设计。
