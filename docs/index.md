# Docs 文档索引（Canonical Map）

`docs/` 目录是 Formax 仓库长期文档知识的系统事实来源（system of record）。

本文件只做 `docs/` 内部总索引，不承载完整运行手册、检查命令清单或实现细节正文。

## 使用方式

- 先按任务类型选择文档类别（`contracts` / `runbooks` / `references` / `design`）。
- 若同一主题同时存在多份文档，以 `contracts/*` 为规范性事实源。
- `learnings/`、`inventories/`、`pitfalls/` 主要提供背景、盘点与排障，不默认视为唯一真值。

## 类别边界

- `contracts/*`：长期成立的规则、语义与边界。
- `runbooks/*`：验证、恢复、失败修复路径。
- `references/*`：字段、模板、对接与辅助说明。
- `design/*`：架构蓝图与设计模式。
- `learnings/*`：决策史与经验沉淀。
- `pitfalls/*`：深度排障与反模式。

## 合同（Contracts）

- 分层依赖与允许边：`docs/contracts/layer-contract.md`
- Root package scripts 治理合同：`docs/contracts/root-script-governance-contract.md`
- 不变量与所有权规则：`docs/contracts/invariants.md`
- Golden Principles 护栏：`docs/contracts/golden-principles.md`
- 项目语义唯一事实源（跨端 semantics）：`docs/contracts/semantics-contract.md`
- 交互输入语义唯一事实源（approval / ask / plan-mode 映射 / preflight 入口矩阵）：`docs/contracts/interactive-input-contract.md`
- Permissions / policy 唯一事实源（allow / ask / deny / remember / workspace）：`docs/contracts/permissions-policy-contract.md`
- Transcript surface 唯一事实源（reset / remount / clear / resume）：`docs/contracts/transcript-surface-contract.md`
- Prompt / tool exposure 唯一事实源（deferred tools / skills reminder / request preview）：`docs/contracts/prompt-tool-exposure-contract.md`
- Tool runtime / ToolSearch / ToolResult 边界唯一事实源：`docs/contracts/tool-runtime-contract.md`
- Hooks 唯一事实源（events / matcher / additionalContext）：`docs/contracts/hooks-contract.md`
- Session persistence / resume / stale-input 唯一事实源：`docs/contracts/session-persistence-contract.md`
- Web parity adapter / reducer / cursor 唯一事实源：`docs/contracts/web-parity-adapter-contract.md`
- Skills 目录与调用行为唯一事实源：`docs/contracts/skills-contract.md`
- Slash command 发现 / dispatch / subline / injection 唯一事实源：`docs/contracts/slash-command-contract.md`
- 模型设置唯一事实源（tier / active model / context window / `/model`）：`docs/contracts/model-settings-contract.md`
- app-server 行为合同（protocol behavior）：`docs/contracts/app-server-interaction-contract.md`
- Web 窗口透明构造合同（整窗透明 / 右侧白底 / 左上左下圆角）：`docs/contracts/web/window-transparency-construct.md`

## 配置（Configuration）

- runtime config / `/config` 合同（merge / sources / sparse write / injection）：`docs/contracts/config-settings-contract.md`
- 环境变量与分类唯一事实源：`docs/environment-variables.md`

## 操作手册（Runbooks）

- 本地与 CI 失败修复路径：`docs/runbooks/runbook.md`
- permissions / policy 排障：`docs/runbooks/permissions-troubleshooting.md`
- REPL transcript surface 排障：`docs/runbooks/repl-surface-debugging.md`
- npm beta 发布手册：`docs/runbooks/npm-beta-release.md`
- app-server 人工验收 runbook：`docs/runbooks/app-server-manual-runbook.md`
- Web 截图证据工作流（A/B/C 分级）：`docs/runbooks/web-evidence-workflow.md`

## 前端（Frontend）

- 前端改动治理与回归门禁：`docs/FRONTEND.md`
- app-server Web UI 行为规范：`docs/frontend/app-server-ui-spec.md`

## 参考（References）

- app-server 接口对接手册：`docs/references/app-server-api-reference.md`
- hooks payload / stdout 参考：`docs/references/hooks-payload-reference.md`
- Claude Code 上下文压缩调研与 Formax 对照：`docs/references/claude-code-context-compression-research.md`

## 设计（Design）

- 语义架构蓝图：`docs/design/semantics-architecture-blueprint.md`

## 审计（Audits）

- REPL single-writer 审计：`docs/audits/repl-single-writer-audit.md`

## 基线（Baselines）

- 语义流式性能基线：`docs/baselines/semantic-streaming-perf.md`

## 学习记录（Learnings）

- Learning 总索引：`docs/learnings/index.md`

## 盘点（Inventories）

- TUI 交互输入形态盘点（informative，规范以 `contracts/interactive-input-contract.md` 为准）：`docs/inventories/interactive-input-inventory.md`

## 陷阱库（Pitfalls）

- 深度排障记录索引：`docs/pitfalls/index.md`
- 长期 pitfall 摘要日志：`docs/pitfalls/summary.md`

## 验证与恢复入口

- Harness 检查项与失败修复路径：`docs/runbooks/runbook.md`
- app-server 人工验收路径：`docs/runbooks/app-server-manual-runbook.md`
