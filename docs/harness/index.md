# Harness 文档索引

本目录是 Formax Harness 治理规则的系统事实来源（system of record）。

## 合同（Contracts）

- 分层依赖与允许边：`docs/harness/contracts/layer-contract.md`
- 不变量与所有权规则：`docs/harness/contracts/invariants.md`
- Golden Principles 护栏：`docs/harness/contracts/golden-principles.md`
- 项目语义唯一事实源（跨端 semantics）：`docs/harness/contracts/semantics-contract.md`
- 交互输入语义唯一事实源（approval / ask）：`docs/harness/contracts/interactive-input-contract.md`
- app-server 行为合同（protocol behavior）：`docs/harness/contracts/app-server-interaction-contract.md`

## 操作手册（Runbooks）

- 本地与 CI 失败修复路径：`docs/harness/runbooks/runbook.md`
- app-server 人工验收 runbook：`docs/harness/runbooks/app-server-manual-runbook.md`

## 前端（Frontend）

- 前端改动治理与回归门禁：`docs/harness/FRONTEND.md`
- app-server Web UI 行为规范：`docs/harness/frontend/app-server-ui-spec.md`

## 参考（References）

- app-server 接口对接手册：`docs/harness/references/app-server-api-reference.md`

## 设计（Design）

- 语义架构蓝图：`docs/harness/design/semantics-architecture-blueprint.md`

## 审计（Audits）

- REPL single-writer 审计：`docs/harness/audits/repl-single-writer-audit.md`

## 基线（Baselines）

- 语义流式性能基线：`docs/harness/baselines/semantic-streaming-perf.md`

## 学习记录（Learnings）

- Harness Governance（2026-02-23）：`docs/harness/learnings/2026-02-23-harness-governance.md`
- App-server Session Grouping 与 Hidden CWDs（2026-02-25）：`docs/harness/learnings/2026-02-25-app-server-session-grouping-and-hidden-cwds.md`
- Web User Message Canonical（2026-02-26）：`docs/harness/learnings/2026-02-26-web-user-message-canonical.md`

## 盘点（Inventories）

- TUI 交互输入形态盘点（informative）：`docs/harness/inventories/interactive-input-inventory.md`

## 陷阱库（Pitfalls）

- 深度排障记录索引：`docs/harness/pitfalls/index.md`
- 长期 pitfall 摘要日志：`pitfalls.md`

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
