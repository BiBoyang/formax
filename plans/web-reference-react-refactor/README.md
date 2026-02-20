# Web Reference React Refactor Blueprint (Active)

目标：在不改变现有语义和交互的前提下，完成一轮“不过度”的前端稳态优化，优先降低渲染开销与维护负担。

最后更新时间：2026-02-20

## 执行状态（Active）

- 进行中：Frontend 轻量优化回合（已完成，待再生）
- 当前待办：以 `plans/web-reference-react-refactor/TODO-INDEX.md` 为准

## 范围约束（严格）

- 不做产品化 UI 改版，不改文案和交互语义。
- 只做低风险、可回归验证的优化；禁止“为了优化而优化”。
- 每项都要有对应测试或回归验证。

## 当前任务清单（唯一来源）

- 当前无待办（已按 `TODO-INDEX` 完成本轮任务）

## 执行循环（固定）

- 每个切片：实现 -> 定向测试 -> `codex review` -> 提交。
- 切片粒度：尽量 2-6 文件。
- 阶段门禁（在 `apps/web-reference-react/` 下）：
  - `npm run type-check`
  - `npm run test -- <targeted files>`
