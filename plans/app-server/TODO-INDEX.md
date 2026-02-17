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

- [ ] N51 replayThreadEvents 分页循环复杂度继续下沉
  - 目标：继续减少 `replayThreadEvents` 主循环中的分支密度，将 page fetch + hasGap 判定拆成可组合步骤。
  - 验收：
    - 主函数只保留编排逻辑，副作用落在命名清晰的 helper。
    - 现有 replay 定向测试全部通过。

- [ ] N52 replay fixture 覆盖 tool row 幂等终局
  - 目标：补齐 replay 场景下 toolUseId 终局幂等用例（重复通知/重放后无重复完成行）。
  - 验收：
    - 新增/扩展 web runtime 定向测试并通过。
