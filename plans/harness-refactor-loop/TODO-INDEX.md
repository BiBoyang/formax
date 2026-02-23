# TODO-INDEX：harness-refactor-loop（Rolling）

更新时间：2026-02-23
任务来源（唯一）：
- `plans/harness-refactor-loop/README.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- [ ] `HRL-SU-03`：清理 `tools/presenters` 审批链路的 `Service -> UI` 依赖（`ConfirmMenu` + `ApprovalHeader`）。
- [ ] `HRL-SU-04`：清理 `WriteApprovalToolBlock` 对 `MarkdownBlock` 的 `Service -> UI` 依赖。
- [ ] `HRL-SR-01`：清理 `features/semantics/runtime` 对 `app-server/protocol/input` 的 `Service -> Runtime` 依赖。

## 再生规则（当“当前待办”为空时）

1. 仅从 `plans/harness-refactor-loop/README.md` 派生下一批任务。
2. 按“小切片可提交”拆分（每项尽量 2-8 文件改动）。
3. 每项固定流程：实现 -> 定向测试 -> `codex review` -> 提交。
4. 新任务写入本文件后，旧的已完成项不回填。
