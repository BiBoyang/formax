# TODO-INDEX：harness-refactor-loop（Rolling）

更新时间：2026-02-23
任务来源（唯一）：
- `plans/harness-refactor-loop/TASK-SOURCE.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。
> 每条待办必须包含 `source=<source_id>` 与 `acceptance=<command>`。

## 当前待办

- [ ] `HRL-KNOW-01` | source=`HRS-06-REPO-KNOWLEDGE` | acceptance=`test -f plans/app-server/HARNESS-CONFIRMMENU-DECISION-2026-02-23.md && bun run check:plan-traceability`
  说明：新增 `ConfirmMenu` 分叉决策记录（保留或收敛的理由、测试矩阵、baseline 策略）到 `plans/app-server/`，确保后续改动可追溯。

## 再生规则（当“当前待办”为空时）

1. 仅从 `plans/harness-refactor-loop/TASK-SOURCE.md` 派生下一批任务。
2. 按“小切片可提交”拆分（每项尽量 2-8 文件改动）。
3. 每项固定流程：实现 -> 定向测试 -> `codex review` -> 提交。
4. 新任务写入本文件后，旧的已完成项不回填。
