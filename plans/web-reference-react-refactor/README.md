# Web Reference React Refactor Blueprint (Active)

目标：在不改变现有语义和交互的前提下，完成一轮“不过度”的前端稳态优化，优先降低渲染开销与维护负担。

最后更新时间：2026-03-05

## 执行状态（Active）

- 进行中：运行时状态更新去抖回合（Slice A/B/C/D/E/F/G 已完成，已再生 Slice H/I）
- 当前待办：以 `plans/web-reference-react-refactor/TODO-INDEX.md` 为准

## 范围约束（严格）

- 不做产品化 UI 改版，不改文案和交互语义。
- 只做低风险、可回归验证的优化；禁止“为了优化而优化”。
- 每项都要有对应测试或回归验证。

## 当前任务清单（唯一来源）

- Slice H：`useThreadSelection` 派生结果结构复用（降低 sidebar 线程列表 props 变化频率）
- Slice I：`TranscriptPane` 错误详情字符串缓存进一步收敛（避免重复 JSON stringify）

## 执行循环（固定）

- 每个切片：实现 -> 定向测试 -> `codex review` -> 提交。
- 切片粒度：尽量 2-6 文件。
- 阶段门禁（在 `apps/web-reference-react/` 下）：
  - `npm run type-check`
  - `npm run test -- <targeted files>`
