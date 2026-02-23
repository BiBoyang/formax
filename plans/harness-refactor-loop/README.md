# Harness Refactor Loop Blueprint (Active)

目标：在不改变用户可见行为的前提下，持续清理 Harness 分层债务，优先降低回归风险并稳定门禁。

最后更新时间：2026-02-23

## 执行状态（Active）

- 进行中：Harness 分层债务清理（`Service -> UI` 优先）
- 当前待办：以 `plans/harness-refactor-loop/TODO-INDEX.md` 为准

## 范围约束（严格）

- 不做产品化 UI 改版，不改文案和交互语义。
- 只做低风险、可回归验证的分层治理与依赖下沉。
- 每项都要有对应测试或回归验证。
- 每个切片必须可独立提交，不做“大包重构”。

## 当前任务清单（唯一来源）

- 见 `plans/harness-refactor-loop/TODO-INDEX.md`

## 执行循环（固定）

- 每个切片：实现 -> 定向测试 -> `codex review` -> 提交。
- 切片粒度：尽量 2-8 文件。
- 阶段门禁：
  - `bun run type-check`
  - `bun run check:layer-contracts`
  - `bun run check:golden-principles`
  - `bun run test -- <targeted files>`
