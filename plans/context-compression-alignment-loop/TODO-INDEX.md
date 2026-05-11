# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-05-11

## 当前主线

- 下一阶段执行清单：
  - [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)

## 当前推荐顺序

1. `CCA-144` middle-layer stage contract / terminal prune fallback v1
2. `CCA-145` strategy coordination facts v1
3. `CCA-146` middle-layer control-plane diagnostics v1
4. `CCA-143` snip boundary + MVP v1

## 说明

- `CCA-080` ~ `CCA-085` 与 `CCA-090` 这一波已经完成。
- `CCA-100` / `CCA-110` / `CCA-111` / `CCA-112` 已完成。
- `CCA-120` / `CCA-121` / `CCA-122` / `CCA-123` 这一波也已经完成，当前主线已切换。
- `CCA-130` / `CCA-131` / `CCA-132` 已完成，post-132 重排也已完成。
- `CCA-140` / `CCA-141` / `CCA-142` 已完成。
- 当前重点已经从“继续打磨 collapse 的最小消费面”转向：
  - 把 query-time 减压步骤收敛成真正独立的中间层策略栈
  - 已补 tool-result budget replacement 与 cache-aware microcompact
  - 当前剩余的核心结构性差距已经切到：
    - stage contract / execution-order contract
    - strategy coordination facts
    - control-plane diagnostics
  - `snip` 仍然值得做，但应后置到 stack coordination 更明确之后
- 仍然不建议直接进入完整 collapse store / archived span 设计。
