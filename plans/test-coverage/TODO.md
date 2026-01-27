# 测试覆盖率提升 TODO（Vitest）

> 基线（2026-01-27，本机 `npm test -- --coverage`）：
> - Statements: 73.01% (8041 / 11013)
> - Branches: 59.76% (5433 / 9091)
> - Functions: 78.81% (1395 / 1770)

## 环境/配置（可选，但建议）

- [ ] 添加覆盖率门槛：先从 **关键模块** 做 file-level threshold（例如 approvals/policy/handlers），避免“一刀切”导致 CI 噪音
- [ ] 补充 `coverage` include/exclude：确保把纯 demo/示例屏幕与脚手架产物排除在门槛之外（例如 ToolExamplesScreen 这类）

## 验收（建议）

- [ ] P0 完成后：至少保证 approvals/policy/plan mode 相关文件达到 **>90% statements** 且分支覆盖有明显提升
- [ ] 每做完一个模块：跑一次单文件 coverage + 全量 coverage，确认没有把 UI 文案/交互键位改掉
