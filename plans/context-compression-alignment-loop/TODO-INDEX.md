# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-04-07

## 当前主线

- 下一阶段执行清单：
  - [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)

## 当前推荐顺序

1. `CCA-100` collapse summary 真正进入 Web / client surface
2. `CCA-110` working-set / keep strategy v2
3. `CCA-111` session memory deeper restore consumption
4. `CCA-112` remote / cross-surface compact restore parity

## 说明

- `CCA-080` ~ `CCA-085` 与 `CCA-090` 这一波已经完成，当前主线已切换。
- 当前重点已经从“让 collapse 能工作”转向：
  - 让已存在的 collapse state 被真实 surface 消费
  - 继续补 Working Set / Session Memory / Restore 这些和 Claude Code 仍有明显差距的能力
- 仍然不建议直接进入完整 collapse store / archived span 设计。
