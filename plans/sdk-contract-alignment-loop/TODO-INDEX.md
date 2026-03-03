# TODO-INDEX：sdk-contract-alignment-loop（Rolling）

更新时间：2026-03-04
任务来源（唯一）：
- `plans/sdk-contract-alignment-loop/README.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- [ ] `QRY-68`：增强 `canUseTool.updatedInput` 在 `approval_request` 下的语义（支持受控地回写工具入参，而非仅 decision 映射）。
- [ ] `QRY-69`：增强 `canUseTool.updatedPermissions` 映射精度（减少 `approve_remember` 简化映射，补齐更多 destination/type 语义）。
- [ ] `SDK-14`：增强 `accountInfo()` 输出契约（补齐官方常用兼容字段子集并保持现有字段兼容）。

## 再生规则（当“当前待办”为空时）

1. 仅从 `plans/sdk-contract-alignment-loop/README.md` 派生下一批任务。
2. 按“小切片可提交”拆分（每项尽量 2-8 文件改动）。
3. 每项固定流程：实现 -> 定向测试 -> `codex review` -> 提交。
4. 每次提交前后都要更新 `plans/sdk-contract-alignment-loop/COMMIT-LOG.md`（至少包含日期、hash、message、切片 ID）。
5. 新任务写入本文件后，旧的已完成项不回填。
