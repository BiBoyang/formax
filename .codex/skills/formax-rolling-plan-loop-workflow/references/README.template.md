# <Topic> Loop Blueprint (Active)

目标：<一句话目标，强调稳定性与可验证性>。

最后更新时间：<YYYY-MM-DD>

## 执行状态（Active）

- 进行中：<当前阶段>
- 当前待办：以 `plans/<topic-slug>/TODO-INDEX.md` 为准

## 范围约束（严格）

- 不改用户可见语义（除非需求明确）。
- 只做低风险、可回归验证的改动。
- 每项都要有测试或回归验证。

## 当前任务清单（唯一来源）

- 见 `plans/<topic-slug>/TODO-INDEX.md`

## 执行循环（固定）

- 每个切片：实现 -> 定向测试 -> `codex review` -> 提交。
- 切片粒度：尽量 2-8 文件。
- 阶段门禁：
  - `bun run type-check`
  - `bun run test -- <targeted files>`
