# Harness Governance（单一事实源）

本目录定义 Formax 的可执行工程治理规则。

## 覆盖范围

- Layer Contract 与依赖方向检查
- 语义不变量与 single-writer 护栏
- CI 与本地校验的操作手册
- 由脚本执行的 Golden Principles

## 当前检查项

- `bun run type-check`
- `bun run test:repl-semantic-gate`
- `bun run check:layer-contracts`
- `bun run check:golden-principles`
- `bun run check:presenter-parity`（告警型漂移观察）
- `bun run check:plan-traceability`（任务来源可追溯性）

## 建议阅读顺序

- Layer Contract 规则：`docs/harness/layer-contract.md`
- 不变量与所有权规则：`docs/harness/invariants.md`
- 失败排障与命令顺序：`docs/harness/runbook.md`
- Golden Principles 护栏：`docs/harness/golden-principles.md`
- TUI 交互输入盘点（approval / ask）：`docs/harness/interactive-input-inventory.md`

## 执行模型

- 新约束先以 CI 软门禁上线（`continue-on-error: true`）。
- 稳定后在 workflow 中取消软门禁，切换为硬阻断。
