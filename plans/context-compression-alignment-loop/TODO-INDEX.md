# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-05-11

## 当前主线

- 下一阶段执行清单：
  - [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)

## 当前推荐顺序

1. post-`CCA-143` mainline re-rank

## 说明

- `CCA-080` ~ `CCA-085` 与 `CCA-090` 这一波已经完成。
- `CCA-100` / `CCA-110` / `CCA-111` / `CCA-112` 已完成。
- `CCA-120` / `CCA-121` / `CCA-122` / `CCA-123` 这一波也已经完成，当前主线已切换。
- `CCA-130` / `CCA-131` / `CCA-132` 已完成，post-132 重排也已完成。
- `CCA-140` / `CCA-141` / `CCA-142` 已完成。
- `CCA-143` / `CCA-144` / `CCA-145` / `CCA-146` 已完成，当前 14x wave 已收口。
- 当前重点已经从“继续打磨 collapse 的最小消费面”转向：
  - 把 query-time 减压步骤收敛成真正独立的中间层策略栈
  - 已补 tool-result budget replacement 与 cache-aware microcompact
  - 当前这条结构性差距的第一阶段已经完成：
    - stage contract / execution-order contract
    - strategy coordination facts
    - control-plane diagnostics
    - request-time snip MVP
- 仍然不建议直接进入完整 collapse store / archived span 设计。
