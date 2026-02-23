# Harness Runbook

## 本地提交前顺序

1. `bun run check:partial-stage`
2. `bun run check:layer-contracts`
3. `bun run test:repl-semantic-gate`
4. `bun run type-check`

与暂存文件相关的定向测试可用：`bun run test:changed`。

## CI 门禁

当前门禁集合：
- `type-check`
- `test:coverage`
- `harness-checks`（软门禁）

Harness 软门禁执行：
- `bun run type-check`
- `bun run test:repl-semantic-gate`
- `bun run check:layer-contracts`

## 失败排障手册

### Layer Contract 失败

- 先从 CI 输出读取“新增违规”。
- 优先修复导入方向。
- 仅在架构决策已记录后再更新 baseline。

### Semantic Gate 失败

- 本地按 `scripts/repl-semantic-pre-review.mjs` 逐步复现失败步骤。
- 先修复不变量破坏，再考虑任何 baseline 调整。

### Trace/Audit 原则失败

- 确保有上下文时审计事件包含 `trace`。
- 优先从 runtime/executor 上下文贯通 trace，避免临时硬编码。
