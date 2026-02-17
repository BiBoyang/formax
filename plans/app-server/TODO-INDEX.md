# TODO-INDEX：Semantics Single-Writer（Rolling）

更新时间：2026-02-17
任务来源（唯一）：
- `plans/app-server/ARCHITECTURE-ROADMAP.md`
- `plans/app-server/SEMANTICS-ARCHITECTURE-BLUEPRINT.md`

> 本清单用于下一阶段主线推进。旧 `plans/app-server/TODO.md` 视为历史执行记录，不再作为主线来源。

## 滚动维护规则（必须执行）

1. 这里始终只保留“未完成任务”；完成项从本文件删除，避免噪音累积。
2. 当本文件清空时，必须重新从 roadmap + blueprint 生成下一批任务并写回本文件。
3. 新任务按“小切片可提交”粒度拆分（每项尽量 2-6 文件改动）。
4. 每项执行顺序固定：实现 -> 定向测试 -> `codex review` -> 提交。
5. 历史完成记录以 Git commit 为准，不在 TODO-INDEX 长期保留。

## P4：Replay-First Invariants

- [ ] N55 replay 分页循环 page-limit 终止路径测试
  - 目标：补齐 `pageCount < 100` 上限终止的保护路径测试，确保异常数据流下可稳定退出。
  - 验收：
    - 新增循环上限路径测试并通过。

- [ ] N56 replay 分页推进边界（next<=after 与 next>=latest）覆盖
  - 目标：补齐分页推进两个边界条件的行为测试，确保循环按预期退出并更新 cursor。
  - 验收：
    - 新增边界条件测试并通过。
