# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-04-06

## Slice Group B: Diagnostics Phase 2

- `CCA-012` 增加 compact / prune 触发原因诊断
  - 目标：告诉我们“为什么本轮触发了 auto-compact / 为什么仍然落到 prune”
  - 验收：report 或 JSON 中可读出 trigger reason / skipped reason

- `CCA-013` 增加 message/tool contributor drill-down
  - 目标：比当前 top contributors 更精确，至少支持 tool_use 级 label 与 message ordinal 稳定定位
  - 验收：JSON diagnostics 中有更稳定的 contributor identity

## Slice Group C: Compact Protocol Upgrade

## Slice Group D: Post-Compact Recovery

## Slice Group E: Keep Strategy Upgrade

## Slice Group H: Cross-Surface / Protocol Parity

## 当前推荐执行顺序

1. `CCA-012`
