# Harness Runbook

## 本地提交前顺序

1. `bun run check:partial-stage`
2. `bun run check:plan-traceability`
3. `bun run check:root-script-governance`
4. `bun run check:layer-contracts`
5. `bun run check:layer-coverage`
6. `bun run check:shared-types`
7. `bun run check:doc-paths`
8. `bun run check:docs-artifact-placement`
9. `bun run check:golden-principles`
10. `bun run test:repl-semantic-gate`
11. `bun run type-check`

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
- `bun run check:layer-coverage`
- `bun run check:shared-types`
- `bun run check:root-script-governance`
- `bun run check:doc-paths`
- `bun run check:docs-artifact-placement`（当 `code` 或 `docs_policy` 变更时）
- `bun run check:golden-principles`
- `bun run check:presenter-parity`（告警步骤，`continue-on-error: true`）
- `bun run check:plan-traceability`（当 `code` 或 `harness_governance` 变更时）

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
2. 若违规属于有意设计，先补充架构说明（`plans/app-server/`）与规则文档（`docs/contracts/layer-contract.md`）。
3. 仅在说明完成后更新 baseline：`node ./scripts/check-layer-contracts.mjs --write-baseline`。
4. 再次执行 `bun run check:layer-contracts`。

### 2.0 `check:root-script-governance` 失败

触发信号：
- 输出包含 `[root-script-governance] check failed`。
- 违规码常见为：`disallowed_script_name`、`disallowed_package_delegation`、`unfrozen_new_script`。

修复路径：
1. 对 feature/package 专属命令，迁回 owning package 的 `package.json`。
2. 若确需临时例外，在 `scripts/baselines/root-script-governance.json` 注册完整 `owner/reason/replacement/expiresOn`。
3. 同步更新契约文档：`docs/contracts/root-script-governance-contract.md`。
4. 重跑 `bun run check:root-script-governance` 直到通过。

备注：`staleBaseline>0` 不会阻断，但应在同一 PR 清理，避免基线漂移。

### 2.1 `check:layer-coverage` 失败

触发信号：
- 输出包含 `Layer coverage: ... unmapped=... (failed)`。
- 输出包含 `Unmapped source files by directory:`。

修复路径：
1. 按目录聚合结果定位未映射文件。
2. 在 `scripts/layer-contract.config.json` 中补齐对应路径映射（目录或单文件）。
3. 重新执行 `bun run check:layer-coverage` 直到 `unmapped=0`。
4. 再执行 `bun run check:layer-contracts`，确认补映射后没有引入新导入方向违规。

### 2.2 `check:shared-types` 失败

触发信号：
- 输出包含 `Shared-types check failed`。
- 某个 `packages/core/src/platform/types/shared/**` 文件提示 `single feature consumer`。

修复路径：
1. 若该类型仅服务单一 feature，优先下沉到 `packages/core/src/features/<feature>/types`。
2. 若确实是跨 feature 共享，补齐第二个 feature 的真实消费点，并保持语义一致。
3. 重新执行 `bun run check:shared-types` 直到无违规。
4. 再执行相关 feature 的定向测试，避免仅靠门禁通过而行为漂移。

### 2.3 `check:layer-contracts` 出现 `staleAllowedImports`

触发信号：
- `check:layer-contracts` 输出包含 `staleAllowedImports=` 且大于 0。
- 或输出 `Stale allowedImports entries (can be cleaned up):` 明细。

修复路径：
1. 在 `scripts/layer-contract.config.json` 的 `allowedImports` 中删除失效条目。
2. 重新执行 `bun run check:layer-contracts`，确认 `staleAllowedImports=0`。
3. 若该跨层依赖仍存在且确属入口装配，补回精确白名单并填写 `reason`。

### 2.4 `check:layer-coverage` 或 `check:layer-contracts` 命中 presenter 归属问题

触发信号：
- 新增 `packages/core/src/tools/modules/*/presenter.tsx` 后出现 `LAYER_ORDER` 违规。
- 或 `layer-coverage` 显示该 presenter 文件未映射。

修复路径：
1. 在 `scripts/layer-contract.config.json` 的 `UI` 层补齐该 presenter 文件映射。
2. 若对应 `index.ts` 绑定 presenter 出现跨层告警，先确认是否已有对应 `allowedImports` 条目。
3. 重新执行 `bun run check:layer-contracts` 与 `bun run check:layer-coverage`。

### 2.5 `check:doc-paths` 失败

触发信号：
- 输出包含 `[doc-paths] check failed`。
- 输出包含 `Missing local doc refs:`，并列出 `file:line -> path`。

修复路径：
1. 按报错定位到具体文档行，确认引用路径是否已迁移。
2. 将旧路径改为当前 canonical 路径（重点范围：`AGENTS.md`、`.codex/skills/**`、`docs/**`、`plans/**`、目录内 `README.md`）。
3. 若文档中的路径是模板占位符（如 `packages/core/src/features/<name>/...`），保持占位符写法并避免被误写成不存在的具体路径。
4. 重新执行 `bun run check:doc-paths` 直到无缺失。

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
1. 先检查 `scripts/check-duplicate-presenters-parity.mjs` 的 `PAIRS` 配置是否符合当前结构（默认可能为空）。
2. 若当前引入了新的“并行实现”文件，先对比并收敛，再补齐两侧测试与迁移说明。
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
