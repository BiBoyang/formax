# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-04-03

## Slice Group A: Microcompact Phase 2

- `CCA-006` 评估并实现附加 text block 的安全压缩
  - 目标：处理 tool_result 后跟随的大块 text，而不误伤正常对话
  - 验收：只命中明确的大输出伴随块，普通消息不受影响
  - 备注：当前需先明确“哪些 text block 算 machine-generated companion block”，否则容易误伤正常对话文本

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

- `CCA-022` 让 prompt 视图基于最近 boundary 构建
  - 目标：主路径从“全 history + summary message”演进到“最近 boundary 后 continuation view”
  - 验收：有针对 boundary slicing 的测试

- `CCA-023` 引入 preserved segment metadata
  - 目标：为未来 resume / partial compact / relink 做准备
  - 验收：metadata 结构与恢复路径最小可测

## Slice Group D: Post-Compact Recovery

- `CCA-030` 设计轻量 post-compact rehydration contract
  - 目标：明确 compact 后哪些状态必须补回
  - 验收：README/contract 明确列出恢复项与优先级

- `CCA-031` 实现最近文件 rehydrate
  - 目标：compact 后补回最近 2-3 个高价值 `Read` 文件上下文
  - 验收：compact 后第一轮继续工作时文件上下文恢复更稳

- `CCA-032` 实现 plan/todos/mode rehydrate
  - 目标：compact 后补回当前计划、todos、mode reminder 的稳定表示
  - 验收：plan mode / todos 驱动的任务在 compact 后不明显掉状态

- `CCA-033` 让 `/context` 能显示 compact 后 rehydration 成本
  - 目标：让恢复层本身也可见，不再是隐形 token 成本
  - 验收：diagnostics 中可读出 rehydration block/token

## Slice Group E: Keep Strategy Upgrade

- `CCA-040` 从固定 `keepLastTurns` 升级为组合 keep 策略
  - 目标：支持 `keepLastTurns + keepMinTokens + keepMinUserTurns`
  - 验收：compact tail 选择不再只由固定 turn 数驱动

- `CCA-041` 引入最小工作集选择器
  - 目标：tail 选择更接近“继续工作所需最小上下文”
  - 验收：对长会话和短会话都更稳定，不会无意义保留或过早丢失关键上下文

## Slice Group F: Session Memory / Rolling Memory

- `CCA-050` 设计 session memory 数据模型
  - 目标：定义长期事实层、活动任务层、当前策略层的最小 schema
  - 验收：有 schema / builder / merge 规则草案

- `CCA-051` 引入后台维护的 rolling memory
  - 目标：不等到 full compact 时才总结历史
  - 验收：每轮或定期更新 memory，且不显著拖慢主路径

- `CCA-052` 实现 memory-first auto compact
  - 目标：auto compact 先尝试 session memory compact，再 fallback full summary compact
  - 验收：存在 clear fallback chain 与测试

## Slice Group G: Higher-Order Compression

- `CCA-060` 设计 partial compact 前置依赖检查
  - 目标：先确认 boundary / relink / session restore 是否足够稳定
  - 验收：有 go/no-go 清单，避免过早上 partial compact

- `CCA-061` 实现 partial compact 最小版
  - 目标：只替换某个 boundary 之前的旧段，而不是整段重压
  - 验收：history 重构后 UI、session、resume 语义仍稳定

- `CCA-062` 实现 reactive compact
  - 目标：在 provider 侧真正超限或特定错误时，有受控 fallback compact 路径
  - 验收：出错后不是直接失败，而是尝试 compact/retry

- `CCA-063` 评估 context collapse / cache-aware layer
  - 目标：研究是否需要位于 microcompact 与 full compact 之间的中间层
  - 验收：给出采用/不采用的技术判断，而不是无限搁置

## Slice Group H: Cross-Surface / Protocol Parity

- `CCA-070` 把 compact boundary 纳入 app-server 协议
  - 目标：不是只有 `/context` 有结构化 payload，compact 事件本身也能被跨端识别
  - 验收：app-server / Web 能识别 compact boundary 语义

- `CCA-071` 把 compact boundary 纳入 session persistence / resume
  - 目标：resume 后 continuation view 和 compact 语义一致
  - 验收：session restore 有针对 boundary 的回归测试

- `CCA-072` 为 diagnostics payload 提供正式客户端消费契约
  - 目标：让 Web/TUI 以后做 richer panel 时不再依赖隐式字段约定
  - 验收：contract 文档明确 `local.diagnostics` schema 与兼容规则

## 当前推荐执行顺序

1. `CCA-030`
2. `CCA-006`
3. `CCA-040`
4. `CCA-050`
5. `CCA-060`
