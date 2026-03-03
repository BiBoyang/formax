# TODO-INDEX：sdk-contract-alignment-loop（Rolling）

更新时间：2026-03-03
任务来源（唯一）：
- `plans/sdk-contract-alignment-loop/README.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- [ ] `QRY-12`：增加 `maxTurns` 对齐入口（仅支持 `1`；大于 `1` 显式报当前不支持），并补充校验与测试。
- [ ] `QRY-13`：增加 `maxBudgetUsd` 对齐入口（输入契约 + 显式不支持错误），并补充校验与测试。

## 再生规则（当“当前待办”为空时）

1. 仅从 `plans/sdk-contract-alignment-loop/README.md` 派生下一批任务。
2. 按“小切片可提交”拆分（每项尽量 2-8 文件改动）。
3. 每项固定流程：实现 -> 定向测试 -> `codex review` -> 提交。
4. 每次提交前后都要更新 `plans/sdk-contract-alignment-loop/COMMIT-LOG.md`（至少包含日期、hash、message、切片 ID）。
5. 新任务写入本文件后，旧的已完成项不回填。
