# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-04-04

## Slice Group B: Diagnostics Phase 2

- `CCA-010` 增加 per-system-section diagnostics
  - 目标：把 system prompt 拆成更细 section 贡献视图
  - 验收：`/context` top contributors 不再只把 system 看成单个黑盒块

- `CCA-011` 增加 diagnostics 中的 pre/post compact lifecycle markers
  - 目标：至少能看到 snapshot、post-microcompact、post-prune、post-compact 四个阶段的估算差异
  - 验收：JSON diagnostics 可比较这些阶段的 token 变化

- `CCA-012` 增加 compact / prune 触发原因诊断
  - 目标：告诉我们“为什么本轮触发了 auto-compact / 为什么仍然落到 prune”
  - 验收：report 或 JSON 中可读出 trigger reason / skipped reason

- `CCA-013` 增加 message/tool contributor drill-down
  - 目标：比当前 top contributors 更精确，至少支持 tool_use 级 label 与 message ordinal 稳定定位
  - 验收：JSON diagnostics 中有更稳定的 contributor identity

## Slice Group C: Compact Protocol Upgrade

## Slice Group D: Post-Compact Recovery

## Slice Group E: Keep Strategy Upgrade

## Slice Group G: Higher-Order Compression

- `CCA-062` 实现 reactive compact
  - 目标：在 provider 侧真正超限或特定错误时，有受控 fallback compact 路径
  - 验收：出错后不是直接失败，而是尝试 compact/retry

- `CCA-063` 评估 context collapse / cache-aware layer
  - 目标：研究是否需要位于 microcompact 与 full compact 之间的中间层
  - 验收：给出采用/不采用的技术判断，而不是无限搁置

## Slice Group H: Cross-Surface / Protocol Parity

- `CCA-072` 为 diagnostics payload 提供正式客户端消费契约
  - 目标：让 Web/TUI 以后做 richer panel 时不再依赖隐式字段约定
  - 验收：contract 文档明确 `local.diagnostics` schema 与兼容规则

## 当前推荐执行顺序

1. `CCA-062`
2. `CCA-072`
