# Harness 文档索引

本目录是 Formax Harness 治理规则的系统事实来源（system of record）。

## 合同（Contracts）

- 分层依赖与允许边：`docs/harness/contracts/layer-contract.md`
- 不变量与所有权规则：`docs/harness/contracts/invariants.md`
- Golden Principles 护栏：`docs/harness/contracts/golden-principles.md`
- 交互输入语义唯一事实源（approval / ask）：`docs/harness/contracts/interactive-input-contract.md`

## 操作手册（Runbooks）

- 本地与 CI 失败修复路径：`docs/harness/runbooks/runbook.md`

## 盘点（Inventories）

- TUI 交互输入形态盘点（informative）：`docs/harness/inventories/interactive-input-inventory.md`

## 当前检查项

- `bun run type-check`
- `bun run test:repl-semantic-gate`
- `bun run check:layer-contracts`
- `bun run check:golden-principles`
- `bun run check:presenter-parity`（告警型漂移观察）
- `bun run check:plan-traceability`（任务来源可追溯性）

## 执行模型

- 新约束先以 CI 软门禁上线（`continue-on-error: true`）。
- 稳定后在 workflow 中取消软门禁，切换为硬阻断。
