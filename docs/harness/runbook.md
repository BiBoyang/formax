# Harness Runbook

## 本地提交前顺序

1. `bun run check:partial-stage`
2. `bun run check:plan-traceability`
3. `bun run check:layer-contracts`
4. `bun run check:golden-principles`
5. `bun run test:repl-semantic-gate`
6. `bun run type-check`

与暂存文件相关的定向测试可用：`bun run test:changed`。
非阻断漂移观察：`bun run check:presenter-parity`（默认告警，`--strict` 才阻断）。

## CI 门禁

当前门禁集合：
- `type-check`
- `test:coverage`
- `harness-checks`（硬门禁）

`harness-checks` 执行：
- `bun run type-check`
- `bun run test:repl-semantic-gate`
- `bun run check:layer-contracts`
- `bun run check:golden-principles`
- `bun run check:presenter-parity`（告警步骤，`continue-on-error: true`）
- `node ./scripts/check-plan-traceability.mjs`（当 `code` 或 `harness_governance` 变更时）

## 失败分类与修复路径

### 1. `type-check` 失败

触发信号：
- `tsc` 报错（类型或签名不兼容）。
- `check-core-boundaries.mjs` / `check-ui-boundaries.mjs` / `check-feature-boundaries.mjs` 任一失败。

修复路径：
1. 先修复类型与签名错误。
2. 若是 boundary 失败，优先调整导入方向或模块归属，不绕过脚本。
3. 重新执行 `bun run type-check` 直到通过。

### 2. `check:layer-contracts` 失败

触发信号：
- 输出包含 `Layer contract violations (new vs baseline):`。

常见违规类型：
- `LAYER_ORDER`：导入了右侧层。
- `UI_MUST_NOT_IMPORT_REPO`：UI 直接导入 Repo。

修复路径：
1. 优先修复导入方向（移动调用入口或提取到左侧层）。
2. 若违规属于有意设计，先补充架构说明（`plans/app-server/`）与规则文档（`docs/harness/layer-contract.md`）。
3. 仅在说明完成后更新 baseline：`node ./scripts/check-layer-contracts.mjs --write-baseline`。
4. 再次执行 `bun run check:layer-contracts`。

备注：`staleBaseline>0` 不会阻断，但应在同一 PR 清理，避免基线漂移。

### 3. `check:golden-principles` 失败

触发信号：
- 输出包含 `Golden principles violations (new vs baseline):`。
- 或输出包含 `[single-writer] regression detected`。

常见违规类型：
- `NO_BUSINESS_TO_UI`：业务/运行时层反向依赖 UI。
- `AUDIT_EVENT_TRACE_REQUIRED`：`audit.append({...})` 缺失 `trace` 字段。
- single-writer 回归：`setMessages(` 计数上升或新增写入文件。

修复路径：
1. 去掉反向依赖，保持单向分层。
2. 有上下文时为审计事件补齐 `trace`。
3. 将 transcript 写入收敛回 canonical 语义路径。
4. 如确需调整 single-writer 基线：先在 `plans/app-server/` 记录架构评审，再修改 `scripts/check-repl-single-writer.mjs` 的 `SEMANTIC_BASELINE_COUNTS`。
5. 重新执行 `bun run check:golden-principles`。

### 4. `test:repl-semantic-gate` 失败

触发信号：
- 输出包含 `[repl-semantic-gate] failed at: <step>`。

修复路径：
1. 先按 `<step>` 对应命令单独复现（见 `scripts/repl-semantic-pre-review.mjs`）。
2. 若失败步骤是 single-writer，按上面的第 3 节处理。
3. 若失败步骤是 adapter contract / surface smoke，先修复 canonical event 顺序与语义映射，不做 UI 临时补丁。
4. 重新执行 `bun run test:repl-semantic-gate`。

### 5. `check:presenter-parity` 告警

触发信号：
- 输出包含 `[presenter-parity] drift detected`。

修复路径：
1. 对比并收敛双实现文件（`src/tools/presenters/*` 与 `src/components/ui/*`）。
2. 若差异是有意的，补齐两侧测试并在 `plans/app-server/` 留下原因说明。
3. 说明完成后更新 baseline：`node ./scripts/check-duplicate-presenters-parity.mjs --write-baseline`。
4. 若需要阻断式验证，执行 `node ./scripts/check-duplicate-presenters-parity.mjs --strict`。

### 6. `check:plan-traceability` 失败

触发信号：
- 输出包含 `[plan-traceability] check failed`。

常见违规类型：
- `TODO-INDEX` 未声明唯一来源 `TASK-SOURCE.md`。
- 待办缺少 `source=` 或 `acceptance=` 元信息。
- `source_id` 不存在于 `TASK-SOURCE.md`。

修复路径：
1. 先补齐 `plans/harness-refactor-loop/TASK-SOURCE.md` 的来源条目。
2. 再修复 `plans/harness-refactor-loop/TODO-INDEX.md` 的任务行格式：
   `- [ ] \`TASK-ID\` | source=\`SOURCE-ID\` | acceptance=\`command\``
3. 重新执行 `bun run check:plan-traceability`。

## Baseline 更新约束

- baseline 只用于“历史债务冻结”或“已评审的特例”，不用于绕过新回归。
- baseline 变更必须和架构说明同一个 PR：
  - `scripts/baselines/*.json` 或 `scripts/check-repl-single-writer.mjs` 变更。
  - 对应 `plans/app-server/` 评审记录。
  - 明确后续收敛条件（何时移除该基线条目）。
