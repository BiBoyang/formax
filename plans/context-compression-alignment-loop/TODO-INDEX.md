# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-05-11

## 当前主线

- 下一阶段执行清单：
  - [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)

## 当前推荐顺序

1. `CCA-140` middle-layer strategy stack scaffolding
2. `CCA-141` tool-result budget replacement v1
3. `CCA-142` cache-aware microcompact v3
4. `CCA-143` snip layer v1（待 `CCA-140 ~ 142` 收口后再开）

## 说明

- `CCA-080` ~ `CCA-085` 与 `CCA-090` 这一波已经完成。
- `CCA-100` / `CCA-110` / `CCA-111` / `CCA-112` 已完成。
- `CCA-120` / `CCA-121` / `CCA-122` / `CCA-123` 这一波也已经完成，当前主线已切换。
- `CCA-130` / `CCA-131` / `CCA-132` 已完成，post-132 重排也已完成。
- 当前重点已经从“继续打磨 collapse 的最小消费面”转向：
  - 把 query-time 减压步骤收敛成真正独立的中间层策略栈
  - 先补 tool-result budget replacement，而不是继续把所有减压都堆进 `microcompact`
  - 在统一策略栈承载下再推进 cache-aware microcompact / snip
- 仍然不建议直接进入完整 collapse store / archived span 设计。
